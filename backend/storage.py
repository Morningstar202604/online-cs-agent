import os
import sqlite3
import json
from contextlib import contextmanager
from datetime import datetime, timezone

DB_PATH = os.environ.get("CS_AGENT_DB", "cs_agent.db")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    # 幂等：确保表存在，即使运行时数据库被移除也能自愈
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            visitor_id TEXT,
            status TEXT DEFAULT 'ongoing',
            escalated INTEGER DEFAULT 0,
            escalate_reason TEXT,
            assignee TEXT,
            started_at TEXT,
            ended_at TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            role TEXT,
            content TEXT,
            refs TEXT,
            tool_used TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            priority TEXT DEFAULT 'normal',
            status TEXT DEFAULT 'pending',
            assignee TEXT,
            created_at TEXT,
            resolved_at TEXT,
            duration_s INTEGER
        );
        CREATE TABLE IF NOT EXISTS memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_id TEXT,
            key TEXT,
            value TEXT,
            updated_at TEXT,
            UNIQUE(visitor_id, key)
        );
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            message_id INTEGER,
            rating TEXT,
            comment TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS injection_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            visitor_id TEXT,
            raw_input TEXT,
            detected TEXT,
            action TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tools (
            id TEXT PRIMARY KEY,
            name TEXT,
            desc TEXT,
            args_json TEXT,
            enabled INTEGER DEFAULT 1,
            builtin INTEGER DEFAULT 0,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS injection_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expr TEXT,
            action TEXT CHECK(action IN ('block','log_only')) DEFAULT 'block',
            enabled INTEGER DEFAULT 1,
            created_at TEXT
        );
        """
    )
    _seed_builtins(conn)


def _seed_builtins(conn: sqlite3.Connection) -> None:
    """首次初始化内置工具与内置注入规则（兜底，保证全删仍可运行）。"""
    existing_tools = conn.execute("SELECT COUNT(*) AS c FROM tools").fetchone()["c"]
    if existing_tools == 0:
        builtin_tools = [
            {"id": "query_order", "name": "查订单物流", "desc": "按订单号查询发货状态与物流单号",
             "args_json": json.dumps({"order_id": "string"}, ensure_ascii=False), "builtin": 1},
            {"id": "initiate_refund", "name": "申请退款", "desc": "按订单号发起退款并返回处理状态",
             "args_json": json.dumps({"order_id": "string", "reason": "string"}, ensure_ascii=False), "builtin": 1},
            {"id": "lookup_policy", "name": "查退改政策", "desc": "按主题检索退改签政策",
             "args_json": json.dumps({"topic": "string"}, ensure_ascii=False), "builtin": 1},
        ]
        for t in builtin_tools:
            conn.execute(
                "INSERT INTO tools (id, name, desc, args_json, enabled, builtin, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
                (t["id"], t["name"], t["desc"], t["args_json"], t["builtin"], _now()),
            )
    existing_rules = conn.execute("SELECT COUNT(*) AS c FROM injection_rules").fetchone()["c"]
    if existing_rules == 0:
        default_exprs = [
            r"(?i)(ignore|disregard)\s+all\s+(previous|prior)\s+instructions",
            r"忽略.{0,12}(指令|指示|规则|提示)",
            r"(you are now|pretend to be|act as)\s*(a\s+)?(unrestricted|new|an unrestricted)",
            r"(unrestricted|无限制|解除限制)\s*(模式)?",
            r"(reveal|show|print|输出|显示)\s*(your\s+)?(system\s+prompt|系统提示|内部指令)",
            r"(act as|扮演)\s*(a\s+)?(new|unrestricted|无限制)",
            r"(jailbreak|越狱)",
            r"(pretend|假装|现在你)",
        ]
        for expr in default_exprs:
            conn.execute(
                "INSERT INTO injection_rules (expr, action, enabled, created_at) VALUES (?, 'block', 1, ?)",
                (expr, _now()),
            )


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        _ensure_schema(conn)


def create_session(session_id: str, visitor_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (id, visitor_id, status, started_at) VALUES (?, ?, 'ongoing', ?)",
            (session_id, visitor_id, _now()),
        )


def add_message(session_id: str, role: str, content: str, refs: list | None = None,
                tool_used: str | None = None, image_b64_placeholder: str | None = None) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO messages (session_id, role, content, refs, tool_used, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, role, content, json.dumps(refs or []), tool_used, _now()),
        )
        return cur.lastrowid or 0


def get_messages(session_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, role, content, refs, tool_used, created_at "
            "FROM messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "refs": json.loads(r["refs"] or "[]"),
            "tool_used": r["tool_used"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_session(session_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    return dict(row) if row else None


def mark_escalated(session_id: str, reason: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE sessions SET escalated = 1, status = 'pending_agent', escalate_reason = ? WHERE id = ?",
            (reason, session_id),
        )


def set_status(session_id: str, status: str, assignee: str | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE sessions SET status = ?, assignee = COALESCE(?, assignee) WHERE id = ?",
            (status, assignee, session_id),
        )


def close_session(session_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE sessions SET status = 'closed', ended_at = ? WHERE id = ?",
            (_now(), session_id),
        )


def create_ticket(session_id: str, priority: str = "normal") -> str:
    ticket_id = f"T-{session_id[-8:]}"
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO tickets (id, session_id, priority, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
            (ticket_id, session_id, priority, _now()),
        )
    return ticket_id


def pending_queues() -> dict:
    with get_conn() as conn:
        pending_sessions = conn.execute(
            "SELECT id, visitor_id, escalate_reason, started_at FROM sessions WHERE status = 'pending_agent'"
        ).fetchall()
        tickets = conn.execute(
            "SELECT id, session_id, priority, status, assignee, created_at FROM tickets ORDER BY created_at"
        ).fetchall()
    return {
        "sessions": [dict(r) for r in pending_sessions],
        "tickets": [dict(r) for r in tickets],
    }


# ---- 长期记忆（跨会话） ----
def set_memory(visitor_id: str, key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO memory (visitor_id, key, value, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(visitor_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (visitor_id, key, value, _now()),
        )


def get_memory(visitor_id: str) -> dict:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT key, value FROM memory WHERE visitor_id = ?", (visitor_id,)
        ).fetchall()
    return {r["key"]: r["value"] for r in rows}


def all_memory() -> list[dict]:
    """所有访客的长期记忆（管理面板用）。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT visitor_id, key, value, updated_at FROM memory ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def session_count(visitor_id: str) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM sessions WHERE visitor_id = ?", (visitor_id,)
        ).fetchone()
    return row["c"] if row else 0


# ---- 满意度反馈 ----
def add_feedback(session_id: str, message_id: int, rating: str, comment: str = "") -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO feedback (session_id, message_id, rating, comment, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, message_id, rating, comment, _now()),
        )


def feedback_summary() -> dict:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT rating, COUNT(*) AS c FROM feedback GROUP BY rating"
        ).fetchall()
    total = sum(r["c"] for r in rows)
    helpful = next((r["c"] for r in rows if r["rating"] == "helpful"), 0)
    not_helpful = next((r["c"] for r in rows if r["rating"] == "not_helpful"), 0)
    return {
        "total": total,
        "helpful": helpful,
        "not_helpful": not_helpful,
        "help_rate": round(helpful / total, 3) if total else 0.0,
    }


# ---- 注入检测日志 ----
def log_injection(session_id: str, visitor_id: str, raw_input: str,
                  detected: str, action: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO injection_log (session_id, visitor_id, raw_input, detected, action, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, visitor_id, raw_input, detected, action, _now()),
        )


def injection_log(limit: int = 50) -> list[dict]:
    """最近 N 条注入拦截日志（管理面板用）。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, session_id, visitor_id, raw_input, detected, action, created_at "
            "FROM injection_log ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


# ---- 运行时配置（key 为顶层分组名，value 为 JSON 字符串） ----
def get_config() -> dict:
    """返回 {group: value} 形式的已存配置。"""
    with get_conn() as conn:
        rows = conn.execute("SELECT key, value FROM config").fetchall()
    return {r["key"]: json.loads(r["value"] or "{}") for r in rows}


def set_config(patch: dict) -> None:
    """按顶层分组覆盖配置。"""
    with get_conn() as conn:
        for group, value in (patch or {}).items():
            conn.execute(
                "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (group, json.dumps(value, ensure_ascii=False), _now()),
            )


# ---- 工具注册表（数据驱动） ----
def list_tools() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, desc, args_json, enabled, builtin FROM tools ORDER BY id"
        ).fetchall()
    return [_tool_row(r) for r in rows]


def active_tools() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, desc, args_json, enabled, builtin FROM tools WHERE enabled = 1 ORDER BY id"
        ).fetchall()
    return [_tool_row(r) for r in rows]


def _tool_row(r) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "desc": r["desc"],
        "args_json": json.loads(r["args_json"] or "{}"),
        "enabled": bool(r["enabled"]),
        "builtin": bool(r["builtin"]),
    }


def get_tool(tool_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tools WHERE id = ?", (tool_id,)).fetchone()
    return _tool_row(row) if row else None


def upsert_tool(tool_id: str, name: str, desc: str, args_json: dict,
                enabled: bool = True, builtin: bool = False) -> dict:
    if not isinstance(args_json, dict):
        raise ValueError("args_json 必须是对象（参数名 → 类型）")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO tools (id, name, desc, args_json, enabled, builtin, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name = excluded.name, desc = excluded.desc, "
            "args_json = excluded.args_json, enabled = excluded.enabled, "
            "builtin = excluded.builtin, updated_at = excluded.updated_at",
            (tool_id, name, desc, json.dumps(args_json, ensure_ascii=False),
             1 if enabled else 0, 1 if builtin else 0, _now()),
        )
    return get_tool(tool_id)


def set_tool_enabled(tool_id: str, enabled: bool) -> dict | None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE tools SET enabled = ?, updated_at = ? WHERE id = ?",
            (1 if enabled else 0, _now(), tool_id),
        )
    return get_tool(tool_id)


def delete_tool(tool_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM tools WHERE id = ?", (tool_id,))
    return cur.rowcount > 0


# ---- 注入规则（数据驱动） ----
def list_injection_rules(enabled_only: bool = False) -> list[dict]:
    q = "SELECT id, expr, action, enabled FROM injection_rules"
    if enabled_only:
        q += " WHERE enabled = 1"
    q += " ORDER BY id"
    with get_conn() as conn:
        rows = conn.execute(q).fetchall()
    return [
        {"id": r["id"], "expr": r["expr"], "action": r["action"], "enabled": bool(r["enabled"])}
        for r in rows
    ]


def get_injection_rule(rule_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM injection_rules WHERE id = ?", (rule_id,)).fetchone()
    return dict(row) if row else None


def add_injection_rule(expr: str, action: str = "block", enabled: bool = True) -> dict:
    if action not in ("block", "log_only"):
        raise ValueError("action 必须是 block 或 log_only")
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO injection_rules (expr, action, enabled, created_at) VALUES (?, ?, ?, ?)",
            (expr, action, 1 if enabled else 0, _now()),
        )
        rid = cur.lastrowid or 0
    return {"id": rid, "expr": expr, "action": action, "enabled": bool(enabled)}


def update_injection_rule(rule_id: int, expr: str | None = None,
                          action: str | None = None, enabled: bool | None = None) -> dict | None:
    sets, params = [], []
    if expr is not None:
        sets.append("expr = ?"); params.append(expr)
    if action is not None:
        if action not in ("block", "log_only"):
            raise ValueError("action 必须是 block 或 log_only")
        sets.append("action = ?"); params.append(action)
    if enabled is not None:
        sets.append("enabled = ?"); params.append(1 if enabled else 0)
    if sets:
        params.append(rule_id)
        with get_conn() as conn:
            conn.execute(f"UPDATE injection_rules SET {', '.join(sets)} WHERE id = ?", params)
    return get_injection_rule(rule_id)


def delete_injection_rule(rule_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM injection_rules WHERE id = ?", (rule_id,))
    return cur.rowcount > 0
