"""Agent core: ReAct 推理 + 工具调用 + 上下文工程 + 分层记忆 + 多模态 + 注入护栏。

无 LLM 凭据时降级为「规则 + 检索」响应器，仍执行工具分发与护栏。
所有可调参数来自 config_store，运行时可改、即时生效。
"""
import json
import os
import re
from dataclasses import dataclass, field

import storage
import config_store

KB_PATH = os.path.join(os.path.dirname(__file__), "data", "kb.json")


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------
@dataclass
class Answer:
    text: str
    citations: list[str] = field(default_factory=list)
    confidence: float = 0.0
    escalate: bool = False
    escalate_reason: str = ""
    mode: str = "rule"
    tool_used: str | None = None
    tool_result: dict | None = None
    memory_note: str | None = None
    ctx_used: dict | None = None  # 上下文工程透明化：注入了哪些模块


# ---------------------------------------------------------------------------
# 知识库检索（bigram 打分，零外部依赖）
# ---------------------------------------------------------------------------
def _load_kb() -> list[dict]:
    with open(KB_PATH, encoding="utf-8") as f:
        return json.load(f)["kb"]


def _bigrams(text: str) -> set[str]:
    cjk = [ch for ch in text.lower() if "\u4e00" <= ch <= "\u9fff"]
    cjk_set = set()
    for i in range(len(cjk) - 1):
        cjk_set.add(cjk[i] + cjk[i + 1])
    return cjk_set | set(re.findall(r"[a-z0-9]{2,}", text.lower()))


def _retrieve_scored(query: str, top_k: int, min_overlap: float) -> list[tuple[float, dict]]:
    kb = _load_kb()
    q_big = _bigrams(query)
    scored = []
    for entry in kb:
        doc_text = f"{entry['text']} {entry['title']} {' '.join(entry.get('tags', []))}"
        doc_big = _bigrams(doc_text)
        overlap = len(q_big & doc_big)
        if overlap == 0:
            continue
        score = overlap / max(len(q_big), 1)
        if score < min_overlap:
            continue
        scored.append((score, entry))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]


def retrieve(query: str, top_k: int | None = None, min_overlap: float = 0.0) -> list[dict]:
    return [e for _, e in _retrieve_scored(query, top_k or 4, min_overlap)]


# ---------------------------------------------------------------------------
# 工具（2026「agent 能行动」能力）。每个工具返回结构化 dict。
# ---------------------------------------------------------------------------
def tool_query_order(order_id: str) -> dict:
    return {
        "order_id": order_id,
        "status": "shipped",
        "carrier": "SF Express",
        "tracking_no": "SF" + order_id[-10:],
        "eta": "2 天内送达",
        "note": f"订单 {order_id} 已发货，快递 {order_id[-6:]}，预计 2 天内送达。",
    }


def tool_initiate_refund(order_id: str, reason: str = "") -> dict:
    return {
        "order_id": order_id,
        "refund_id": f"R-{order_id[-8:]}",
        "status": "pending_review",
        "reason": reason or "未说明",
        "note": f"退款申请 R-{order_id[-8:]} 已提交，坐席将在 1 个工作日内审核。",
    }


def tool_lookup_policy(topic: str) -> dict:
    hits = retrieve(topic, top_k=2)
    return {
        "topic": topic,
        "found": bool(hits),
        "entries": [
            {"id": h["id"], "title": h["title"], "answer": h["answer"]} for h in hits
        ],
    }


def _all_tool_impls() -> dict:
    return {
        "query_order": tool_query_order,
        "initiate_refund": tool_initiate_refund,
        "lookup_policy": tool_lookup_policy,
    }


def active_tools(cfg: dict) -> dict:
    """数据驱动：从工具注册表（DB）取启用工具，映射到内置实现；
    未知/非内置工具走 kb_search 占位执行器。cfg['tools'] 开关作为额外过滤。"""
    tools_cfg = cfg.get("tools", {})
    out = {}
    for t in storage.active_tools():
        tid = t["id"]
        if not tools_cfg.get(tid, True):
            continue
        if tid in _all_tool_impls():
            out[tid] = _all_tool_impls()[tid]
        elif t.get("kind") == "kb_search" or "kb_search" in json.dumps(t.get("args_json", {})):
            out[tid] = _make_kb_search_tool(t)
        else:
            out[tid] = _make_stub_tool(t)
    return out


def _make_kb_search_tool(t: dict):
    """非内置工具：按参数值在知识库做检索（kind=kb_search 的轻量执行器）。"""
    args_schema = t.get("args_json", {})
    search_arg = next(iter(args_schema.keys()), "topic")

    def run(**kw):
        term = str(kw.get(search_arg, ""))
        return tool_lookup_policy(term)
    return run


def _make_stub_tool(t: dict):
    """占位执行器：返回结构化「待接入」结果，不报错。"""
    def run(**kw):
        return {
            "tool": t["id"],
            "status": "stub",
            "note": f"工具「{t.get('name') or t['id']}」已注册但尚未接入真实后端，返回占位结果。",
            "args": kw,
        }
    return run


def tool_schema_block(cfg: dict) -> list[dict]:
    """给 LLM 用的工具 schema（数据驱动，来自注册表 + 内置参数）。"""
    out = []
    for t in storage.active_tools():
        tid = t["id"]
        if not cfg.get("tools", {}).get(tid, True):
            continue
        args = _tool_args(tid) or list(t.get("args_json", {}).keys())
        out.append({"name": tid, "args": args, "desc": t.get("desc") or t.get("name") or tid})
    return out


def detect_tool(query: str, tools: dict | None = None) -> tuple[str | None, dict | None]:
    """规则模式下的工具路由。仅路由到已启用的工具；tools 缺省为全开。"""
    enabled = tools if tools is not None else _all_tools()
    order_match = re.search(r"(?:订单|order|单号)\s*[:：]?\s*([A-Za-z0-9]{6,12})", query)
    if order_match and ("退款" in query or "退货" in query) and "initiate_refund" in enabled:
        return "initiate_refund", {"order_id": order_match.group(1), "reason": "规则路由"}
    if order_match and ("发货" in query or "物流" in query or "快递" in query or "查询" in query or "什么时候" in query or "状态" in query) and "query_order" in enabled:
        return "query_order", {"order_id": order_match.group(1)}
    if ("政策" in query or "规定" in query or "条款" in query) and "lookup_policy" in enabled:
        return "lookup_policy", {"topic": query}
    return None, None


# ---------------------------------------------------------------------------
# 注入护栏（2026 安全护栏）
# ---------------------------------------------------------------------------
def _active_injection_rules() -> list[tuple[re.Pattern, str]]:
    """启用中的注入规则（DB）。全部停用时回退内置 7 条，护栏不失效。"""
    rules = storage.list_injection_rules(enabled_only=True)
    patterns = []
    for r in rules:
        try:
            patterns.append((re.compile(r["expr"], re.IGNORECASE), r["action"]))
        except re.error:
            continue
    if not patterns:
        for expr in _BUILTIN_INJECTION_PATTERNS:
            patterns.append((re.compile(expr, re.IGNORECASE), "block"))
    return patterns


# 内置兜底模式（DB 规则全停用时使用）
_BUILTIN_INJECTION_PATTERNS = [
    r"忽略(之前|所有|以上)的?(指令|规则|设定|系统提示)",
    r"你现在是(一个|一名)?\s*(不受限制的|无限制的)",
    r"reveal (the )?(system )?(prompt|instructions)",
    r"忽略.{0,10}(指令|提示|规则)",
    r"pretend (you are|to be) (a )?(new|unrestricted)",
    r"disregard (all|the) (previous|prior)",
    r"jailbreak|越狱",
]


def detect_injection(text: str) -> tuple[str | None, str | None]:
    """返回 (命中的片段, 动作 block|log_only)。无命中返回 (None, None)。"""
    for pat, action in _active_injection_rules():
        m = pat.search(text)
        if m:
            return m.group(0), action
    return None, None


# ---------------------------------------------------------------------------
# 多模态（2026 统一多模态理解）
# ---------------------------------------------------------------------------
def process_image(image_b64: str, prompt: str = "", has_llm: bool = False) -> dict:
    if not image_b64:
        return {"recognized": False, "type": "empty", "note": "未收到图片"}
    if has_llm:
        return {"recognized": True, "type": "llm_vision", "note": "请调用 LLM 视觉能力解析该图片", "prompt": prompt}
    return {
        "recognized": True,
        "type": "rule_stub",
        "note": "已收到图片，规则模式暂无法理解图片内容，已为你转人工坐席查看。",
        "escalate": True,
    }


# ---------------------------------------------------------------------------
# 上下文工程（2026 context engineering）
# ---------------------------------------------------------------------------
def _relevant_history(history: list[dict], query: str, turns: int, relevant_only: bool) -> list[dict]:
    """取最近 N 轮；若开启相关性筛选，则把与 query 有词重叠的更早轮次前置。"""
    tail = history[-turns:] if turns > 0 else []
    if not relevant_only or len(history) <= turns:
        return tail
    q_big = _bigrams(query)
    scored = []
    for m in history[:-turns] if len(history) > turns else []:
        overlap = len(q_big & _bigrams(m.get("content", "")))
        if overlap > 0:
            scored.append((overlap, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored[:3]] + tail


def _summarize_history(history: list[dict]) -> str:
    """长历史压缩为要点摘要（无 LLM 时按角色 + 主题抽取）。"""
    if not history:
        return ""
    points = []
    seen = set()
    for m in history:
        c = (m.get("content") or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        points.append(f"{m.get('role')}: {c[:40]}")
    return "历史要点：" + "；".join(points[:8])


def build_context(query: str, history: list[dict], cfg: dict, visitor_id: str,
                  image_b64: str = "") -> dict:
    """组装 system prompt 所需的全部上下文，并对每个模块做透明化记录。"""
    ret = cfg.get("retrieval", {})
    ctx = cfg.get("context", {})
    mem_cfg = cfg.get("memory", {})
    top_k = ret.get("kb_top_k", 4)
    min_overlap = ret.get("min_overlap", 0.0)

    modules_on = ctx.get("modules", {})
    used: dict = {}

    # KB 检索
    hits = _retrieve_scored(query, top_k, min_overlap) if modules_on.get("kb", True) else []
    kb_block = "\n".join(f"- [{h['id']}] {h['title']}: {h['answer']}" for _, h in hits) if hits else "（无相关条目）"
    used["kb"] = {"enabled": bool(modules_on.get("kb", True)), "hits": [e["id"] for _, e in hits]}

    # 工具（数据驱动 schema）
    tools = active_tools(cfg) if modules_on.get("tools", True) else {}
    tools_schema = tool_schema_block(cfg) if modules_on.get("tools", True) else []
    used["tools"] = {"enabled": bool(modules_on.get("tools", True)), "active": list(tools.keys())}

    # 相关记忆（按 query 召回，而非固定前 N 个 key）
    mem = {}
    if modules_on.get("memory", True) and mem_cfg.get("enable", True) and visitor_id:
        mem = storage.get_memory(visitor_id)
        mem_top = mem_cfg.get("retrieval_top_k", 3)
        mem_hits = _retrieve_memory(query, mem, mem_top)
        mem_block = "；".join(f"{k}: {v}" for k, v in mem_hits) if mem_hits else "（暂无相关记忆）"
        used["memory"] = {"enabled": bool(mem_cfg.get("enable", True)), "hits": [k for k, _ in mem_hits]}
        # 老访客问候
        if mem_cfg.get("visit_greeting", True) and storage.session_count(visitor_id) > 1 and mem:
            used["memory"]["greeting"] = "欢迎回来！注意到您之前咨询过：" + "、".join(list(mem.keys())[:3])
    else:
        mem_block = "（记忆模块关闭）"

    # 相关历史 + 摘要
    turns = ctx.get("history_turns", 10)
    rel_hist = _relevant_history(history, query, turns, ctx.get("relevant_only", True))
    summary = ""
    if ctx.get("summarize", True) and len(history) > ctx.get("compress_threshold", 6) and modules_on.get("summary", True):
        summary = _summarize_history(history)
    used["history"] = {"turns": len(rel_hist), "relevant_only": ctx.get("relevant_only", True), "summarized": bool(summary)}

    return {
        "kb_block": kb_block,
        "tools_schema": tools_schema,
        "tools": tools,
        "memory_block": mem_block,
        "memory": mem,
        "history": rel_hist,
        "summary": summary,
        "persona": ctx.get("persona", "你是专业的在线客服 Agent。"),
        "modules_on": modules_on,
        "used": used,
    }


def _tool_args(name: str) -> list[str]:
    builtin = {"query_order": ["order_id"], "initiate_refund": ["order_id", "reason"], "lookup_policy": ["topic"]}
    if name in builtin:
        return builtin[name]
    t = storage.get_tool(name)
    return list(t.get("args_json", {}).keys()) if t else []


def _tool_desc(name: str) -> str:
    builtin = {"query_order": "查询订单物流状态", "initiate_refund": "发起退款申请", "lookup_policy": "查询政策/规定"}
    if name in builtin:
        return builtin[name]
    t = storage.get_tool(name)
    return (t.get("desc") or t.get("name") or name) if t else ""


def _retrieve_memory(query: str, mem: dict, top_k: int) -> list[tuple[str, str]]:
    """按 query 与记忆 key+value 的词重叠度召回相关记忆片段。"""
    if not mem:
        return []
    q_big = _bigrams(query)
    scored = []
    for k, v in mem.items():
        doc_big = _bigrams(f"{k} {v}")
        overlap = len(q_big & doc_big)
        # 偏好/事实类记忆（非 last_topic）权重更高
        weight = 1.0 if "last_topic" not in k else 0.5
        if overlap > 0:
            scored.append((overlap * weight, k, v))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [(k, v) for _, k, v in scored[:top_k]]


def capture_memory(query: str, visitor_id: str, cfg: dict) -> list[str]:
    """自动从访客消息沉淀偏好/事实到长期记忆。返回本次新增的 key。"""
    mem_cfg = cfg.get("memory", {})
    if not mem_cfg.get("enable", True) or not mem_cfg.get("auto_capture", True) or not visitor_id:
        return []
    kws = mem_cfg.get("capture_keywords", ["喜欢", "常用", "偏好", "每次", "习惯", "总是"])
    hit_kws = [k for k in kws if k in query]
    if not hit_kws:
        return []
    key = "pref_" + (hit_kws[0])
    storage.set_memory(visitor_id, key, query[:60])
    return [key]


# ---------------------------------------------------------------------------
# ReAct 循环
# ---------------------------------------------------------------------------
def _rule_react(query: str, ctx: dict, cfg: dict) -> Answer:
    hits = _retrieve_scored(query, cfg.get("retrieval", {}).get("kb_top_k", 4),
                            cfg.get("retrieval", {}).get("min_overlap", 0.0))
    tools = ctx["tools"]
    # 1. 工具路由优先于纯检索
    tool_name, tool_args = detect_tool(query, tools)
    if tool_name:
        result = tools[tool_name](**tool_args)
        note = result.get("note") or json.dumps(result, ensure_ascii=False)
        return Answer(
            text=note,
            citations=[],
            confidence=0.9,
            tool_used=tool_name,
            tool_result=result,
            memory_note=ctx["used"].get("memory", {}).get("greeting", ""),
            ctx_used=ctx["used"],
            mode="rule_react",
        )
    # 2. 检索命中 -> 回答
    if hits:
        top_score, top = hits[0]
        conf = 0.6 + min(top_score, 0.6) + 0.05 * min(len(hits), 2)
        return Answer(
            text=f"【{top['title']}】{top['answer']}（依据 {top['id']}）",
            citations=[e["id"] for _, e in hits[:3]],
            confidence=min(conf, 0.95),
            memory_note=ctx["used"].get("memory", {}).get("greeting", ""),
            ctx_used=ctx["used"],
            mode="rule_react",
        )
    # 3. 未命中 -> 升级
    return Answer(
        text="这个问题我需要人工坐席进一步为您处理，正在为您转接…",
        citations=[],
        confidence=0.2,
        escalate=True,
        escalate_reason="knowledge_miss",
        memory_note=ctx["used"].get("memory", {}).get("greeting", ""),
        ctx_used=ctx["used"],
        mode="rule_react",
    )


def _llm_react(query: str, ctx: dict, cfg: dict, visitor_id: str, image_b64: str = "") -> Answer | None:
    llm = cfg.get("llm", {})
    if not llm.get("has_key"):
        return None
    api_key = os.environ.get("USER_LLM_API_KEY", "")
    if not api_key:
        return None
    try:
        from openai import OpenAI
    except Exception:
        return None

    client = OpenAI(api_key=api_key, base_url=llm.get("base_url"))
    modules_on = ctx["modules_on"]
    char_budget = cfg.get("context", {}).get("char_budget", 2400)
    react_steps = cfg.get("escalation", {}).get("react_steps", 3)
    system = ctx["persona"] + "\n"
    parts = []
    if modules_on.get("kb", True):
        parts.append("知识库条目：\n" + ctx["kb_block"])
    if modules_on.get("tools", True):
        parts.append("可用工具：\n" + json.dumps(ctx["tools_schema"], ensure_ascii=False))
    if modules_on.get("memory", True):
        parts.append("访客相关记忆：\n" + ctx["memory_block"])
    if ctx["summary"]:
        parts.append(ctx["summary"])
    # 按字符预算裁剪，保证拼接后 system 不超过预算
    body = ""
    for p in parts:
        if len(body) + len(p) + 2 > char_budget:
            break
        body += p + "\n\n"
    system += body
    system += (
        f"ReAct 最大步数 {react_steps}。请输出 JSON：\n"
        '{"thought": str, "tool": name或null, "tool_args": {..}或null, '
        '"answer": str, "citations": [id], "confidence": 0-1, '
        '"escalate": bool, "escalate_reason": str}'
    )

    messages = [{"role": "system", "content": system}]
    hist = ctx["history"]
    for m in hist:
        role = "assistant" if m.get("role") in ("agent", "operator") else "user"
        content = m.get("content")
        if image_b64 and m.get("image"):
            content = [
                {"type": "text", "text": m.get("content", "")},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
            ]
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": query})

    try:
        resp = client.chat.completions.create(
            model=llm.get("model", "gpt-4o-mini"),
            messages=messages,
            temperature=llm.get("temperature", 0.2),
            top_p=llm.get("top_p", 1.0),
            max_tokens=llm.get("max_tokens", 512),
        )
        raw = (resp.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw).rstrip("`")
        data = json.loads(raw)
        tools = ctx["tools"]
        tool_name = data.get("tool")
        tool_result = None
        if tool_name and tool_name in tools:
            args = data.get("tool_args") or {}
            tool_result = tools[tool_name](**args)
            data["answer"] = tool_result.get("note") or data.get("answer") or "工具已执行。"
        answer = Answer(
            text=data.get("answer", ""),
            citations=data.get("citations", []),
            confidence=float(data.get("confidence", 0.0)),
            escalate=bool(data.get("escalate", False)),
            escalate_reason=data.get("escalate_reason", ""),
            tool_used=tool_name,
            tool_result=tool_result,
            ctx_used=ctx["used"],
            mode="llm_react",
        )
        threshold = cfg.get("escalation", {}).get("confidence_threshold", 0.6)
        if answer.confidence < threshold and not answer.escalate:
            answer.escalate = True
            answer.escalate_reason = answer.escalate_reason or "low_confidence"
        return answer
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 公共入口
# ---------------------------------------------------------------------------
def respond(query: str, history: list[dict], visitor_id: str = "anonymous",
            image_b64: str = "") -> Answer:
    cfg = config_store.get_config()
    esc = cfg.get("escalation", {})
    max_len = esc.get("max_message_len", 1000)
    if len(query) > max_len:
        query = query[:max_len]

    ctx = build_context(query, history, cfg, visitor_id, image_b64)

    # 1. 注入护栏（数据驱动规则；block 拦截，log_only 记录但不阻断）
    if cfg.get("guardrail", {}).get("injection_block", True):
        inj, inj_action = detect_injection(query)
        if inj and inj_action == "block":
            return Answer(
                text="检测到包含越权/提示词注入的输入，本次消息已拦截并记录。请就具体问题咨询，我们会正常为您服务。",
                citations=[],
                confidence=1.0,
                tool_used="injection_guard",
                mode="guardrail",
                ctx_used=ctx["used"],
            )

    # 2. 显式转人工
    if "转人工" in query:
        return Answer(
            text="好的，正在为您转接人工坐席，请稍候。",
            confidence=1.0,
            escalate=True,
            escalate_reason="visitor_requested",
            ctx_used=ctx["used"],
            mode="rule_react",
        )

    # 3. 多模态
    if image_b64 and cfg.get("multimodal", {}).get("enable", True):
        img = process_image(image_b64, query, cfg.get("llm", {}).get("has_key", False))
        if img.get("escalate"):
            llm_ans = _llm_react(query, ctx, cfg, visitor_id, image_b64)
            if llm_ans:
                return llm_ans
            return Answer(
                text=img.get("note", "已收到图片，正在为您转接人工坐席查看。"),
                confidence=0.3,
                escalate=True,
                escalate_reason="image_needs_human",
                tool_used="vision",
                ctx_used=ctx["used"],
                mode="rule_react",
            )

    # 4. 按引擎模式选择 ReAct 路径
    mode = cfg.get("engine", {}).get("mode", "auto")
    llm_ans = None
    if mode in ("llm", "auto"):
        llm_ans = _llm_react(query, ctx, cfg, visitor_id, image_b64)
        if mode == "llm" and llm_ans is None:
            # llm 模式但不可用（无 Key / openai 缺失 / 调用失败）
            rule_ans = _rule_react(query, ctx, cfg)
            rule_ans.mode = "rule_fallback"
            return rule_ans
    if llm_ans:
        return llm_ans
    # auto 无 Key 或 rule 模式：走规则兜底
    return _rule_react(query, ctx, cfg)


def health() -> dict:
    cfg = config_store.get_config()
    llm = cfg.get("llm", {})
    engine_mode = cfg.get("engine", {}).get("mode", "auto")
    effective = "llm_react" if (engine_mode in ("llm", "auto") and llm.get("has_key")) else "rule_react"
    return {
        "mode": effective,
        "engine_mode": engine_mode,
        "llm_ready": bool(llm.get("has_key")),
        "model": llm.get("model"),
        "base_url": llm.get("base_url"),
        "kb_entries": len(_load_kb()),
        "tools": list(active_tools(cfg).keys()),
        "tool_count": len(active_tools(cfg)),
        "injection_rules": len(storage.list_injection_rules(enabled_only=True)),
        "kb_top_k": cfg.get("retrieval", {}).get("kb_top_k"),
        "history_turns": cfg.get("context", {}).get("history_turns"),
        "memory_enable": cfg.get("memory", {}).get("enable"),
        "escalate_threshold": cfg.get("escalation", {}).get("confidence_threshold"),
        "react_steps": cfg.get("escalation", {}).get("react_steps"),
    }
