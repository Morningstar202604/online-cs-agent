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
        """
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
        helpful = rows and next((r["c"] for r in rows if r["rating"] == "helpful"), 0)
    return {
        "total": total,
        "helpful": helpful,
        "not_helpful": total - helpful,
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
