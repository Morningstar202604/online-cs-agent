"""Agent core: ReAct-style reasoning with tool calling, long-term memory,
multimodal placeholder, injection guardrails, and OpenAI-compatible LLM.

Without LLM credentials the agent degrades to a rule + retrieval responder
that still performs tool dispatch and guardrail checks.
"""
import json
import os
import re
from dataclasses import dataclass, field

import storage

KB_PATH = os.path.join(os.path.dirname(__file__), "data", "kb.json")

USER_LLM_API_KEY = os.environ.get("USER_LLM_API_KEY", "")
USER_LLM_BASE_URL = os.environ.get("USER_LLM_BASE_URL", "https://api.openai.com/v1")
USER_LLM_MODEL = os.environ.get("USER_LLM_MODEL", "gpt-4o-mini")
USER_KB_TOP_K = int(os.environ.get("USER_KB_TOP_K", "4"))
USER_ESCALATE_THRESHOLD = float(os.environ.get("USER_ESCALATE_THRESHOLD", "0.6"))
USER_MAX_MESSAGE_LEN = int(os.environ.get("USER_MAX_MESSAGE_LEN", "1000"))
USER_REACT_STEPS = int(os.environ.get("USER_REACT_STEPS", "3"))

LLM_READY = bool(USER_LLM_API_KEY and USER_LLM_API_KEY != "your-api-key-here")


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


# ---------------------------------------------------------------------------
# Knowledge base retrieval (bigram scoring, no external dependency)
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


def _retrieve_scored(query: str, top_k: int) -> list[tuple[float, dict]]:
    kb = _load_kb()
    q_big = _bigrams(query)
    scored = []
    for entry in kb:
        doc_text = f"{entry['text']} {entry['title']} {' '.join(entry.get('tags', []))}"
        doc_big = _bigrams(doc_text)
        overlap = len(q_big & doc_big)
        if overlap == 0:
            continue
        score = overlap / len(q_big)
        scored.append((score, entry))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]


def retrieve(query: str, top_k: int | None = None) -> list[dict]:
    return [e for _, e in _retrieve_scored(query, top_k or USER_KB_TOP_K)]


# ---------------------------------------------------------------------------
# Tools (2026 "agent can act" capability). Each tool returns a structured dict.
# ---------------------------------------------------------------------------
def tool_query_order(order_id: str) -> dict:
    # 模拟订单查询；真实场景接业务系统 API
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


_TOOLS: dict[str, callable] = {
    "query_order": tool_query_order,
    "initiate_refund": tool_initiate_refund,
    "lookup_policy": tool_lookup_policy,
}


def detect_tool(query: str) -> tuple[str | None, dict | None]:
    """规则模式下的工具路由。LLM 模式下由 LLM 决定工具调用。"""
    order_match = re.search(r"(?:订单|order|单号)\s*[:：]?\s*([A-Za-z0-9]{6,12})", query)
    # 退款/退货意图优先于纯查询
    if order_match and ("退款" in query or "退货" in query):
        return "initiate_refund", {"order_id": order_match.group(1), "reason": "规则路由"}
    if order_match and ("发货" in query or "物流" in query or "快递" in query or "查询" in query or "什么时候" in query or "状态" in query):
        return "query_order", {"order_id": order_match.group(1)}
    if "政策" in query or "规定" in query or "条款" in query:
        return "lookup_policy", {"topic": query}
    return None, None


# ---------------------------------------------------------------------------
# Injection guardrail (2026 安全护栏)
# ---------------------------------------------------------------------------
_INJECTION_PATTERNS = [
    r"忽略(之前|所有|以上)的?(指令|规则|设定|系统提示)",
    r"你现在是(一个|一名)?\s*(不受限制的|无限制的)",
    r"reveal (the )?(system )?(prompt|instructions)",
    r"忽略.{0,10}(指令|提示|规则)",
    r"pretend (you are|to be) (a )?(new|unrestricted)",
    r"disregard (all|the) (previous|prior)",
    r"jailbreak|越狱",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)


def detect_injection(text: str) -> str | None:
    m = _INJECTION_RE.search(text)
    return m.group(0) if m else None


# ---------------------------------------------------------------------------
# Multimodal placeholder (2026 多模态统一理解)
# ---------------------------------------------------------------------------
def process_image(image_b64: str, prompt: str = "") -> dict:
    """无 LLM 时做基础解析占位；LLM 可用时走视觉模型。

    返回识别结果与是否升级标记。
    """
    if not image_b64:
        return {"recognized": False, "type": "empty", "note": "未收到图片"}
    if LLM_READY:
        # 真实视觉理解由 LLM 完成，这里留占位让调用方走 LLM 视觉分支
        return {"recognized": True, "type": "llm_vision", "note": "请调用 LLM 视觉能力解析该图片", "prompt": prompt}
    return {
        "recognized": True,
        "type": "rule_stub",
        "note": "已收到图片，规则模式暂无法理解图片内容，已为你转人工坐席查看。",
        "escalate": True,
    }


# ---------------------------------------------------------------------------
# ReAct loop (think -> act -> observe -> reflect)
# ---------------------------------------------------------------------------
def _rule_react(query: str, history: list[dict], visitor_memory: dict) -> Answer:
    hits = _retrieve_scored(query, USER_KB_TOP_K)
    # 1. 工具路由优先于纯检索
    tool_name, tool_args = detect_tool(query)
    if tool_name:
        result = _TOOLS[tool_name](**tool_args)
        note = result.get("note") or json.dumps(result, ensure_ascii=False)
        conf = 0.9
        return Answer(
            text=note,
            citations=[],
            confidence=conf,
            escalate=False,
            tool_used=tool_name,
            tool_result=result,
            memory_note=visitor_memory.get("greeting", ""),
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
            escalate=False,
            memory_note=visitor_memory.get("greeting", ""),
            mode="rule_react",
        )
    # 3. 未命中 -> 升级
    return Answer(
        text="这个问题我需要人工坐席进一步为您处理，正在为您转接…",
        citations=[],
        confidence=0.2,
        escalate=True,
        escalate_reason="knowledge_miss",
        memory_note=visitor_memory.get("greeting", ""),
        mode="rule_react",
    )


def _llm_react(query: str, history: list[dict], visitor_memory: dict, image_b64: str = "") -> Answer | None:
    if not LLM_READY:
        return None
    try:
        from openai import OpenAI
    except Exception:
        return None

    client = OpenAI(api_key=USER_LLM_API_KEY, base_url=USER_LLM_BASE_URL)
    hits = _retrieve_scored(query, USER_KB_TOP_K)
    kb_block = "\n".join(f"- [{h['id']}] {h['title']}: {h['answer']}" for _, h in hits) or "（无相关条目）"

    tools_schema = [
        {"name": "query_order", "args": ["order_id"], "desc": "查询订单物流状态"},
        {"name": "initiate_refund", "args": ["order_id", "reason"], "desc": "发起退款申请"},
        {"name": "lookup_policy", "args": ["topic"], "desc": "查询政策/规定"},
    ]
    system = (
        "你是专业的在线客服 Agent，具备思考-行动-观察循环（ReAct）。你可以调用工具。\n"
        "知识库条目：\n" + kb_block + "\n\n"
        "可用工具：\n" + json.dumps(tools_schema, ensure_ascii=False) + "\n\n"
        "访客长期记忆：\n" + json.dumps(visitor_memory, ensure_ascii=False) + "\n\n"
        "请输出 JSON：\n"
        '{"thought": str, "tool": name或null, "tool_args": {..}或null, '
        '"answer": str, "citations": [id], "confidence": 0-1, '
        '"escalate": bool, "escalate_reason": str}'
    )

    messages = [{"role": "system", "content": system}]
    for m in history[-10:]:
        role = "assistant" if m["role"] in ("agent", "operator") else "user"
        content: list | str
        if image_b64 and m.get("image"):
            content = [
                {"type": "text", "text": m["content"]},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
            ]
        else:
            content = m["content"]
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": query})

    try:
        resp = client.chat.completions.create(
            model=USER_LLM_MODEL,
            messages=messages,
            temperature=0.2,
        )
        raw = (resp.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw).rstrip("`")
        data = json.loads(raw)
        # 执行工具（单步 ReAct）
        tool_name = data.get("tool")
        tool_result = None
        if tool_name and tool_name in _TOOLS:
            args = data.get("tool_args") or {}
            tool_result = _TOOLS[tool_name](**args)
            data["answer"] = tool_result.get("note") or data.get("answer") or "工具已执行。"
        answer = Answer(
            text=data.get("answer", ""),
            citations=data.get("citations", []),
            confidence=float(data.get("confidence", 0.0)),
            escalate=bool(data.get("escalate", False)),
            escalate_reason=data.get("escalate_reason", ""),
            tool_used=tool_name,
            tool_result=tool_result,
            mode="llm_react",
        )
        if answer.confidence < USER_ESCALATE_THRESHOLD and not answer.escalate:
            answer.escalate = True
            answer.escalate_reason = answer.escalate_reason or "low_confidence"
        return answer
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------
def respond(query: str, history: list[dict], visitor_id: str = "anonymous",
            image_b64: str = "") -> Answer:
    if len(query) > USER_MAX_MESSAGE_LEN:
        query = query[:USER_MAX_MESSAGE_LEN]

    # 1. 注入护栏
    inj = detect_injection(query)
    if inj:
        return Answer(
            text="检测到包含越权/提示词注入的输入，本次消息已拦截并记录。请就具体问题咨询，我们会正常为您服务。",
            citations=[],
            confidence=1.0,
            escalate=False,
            tool_used="injection_guard",
            mode="guardrail",
        )

    # 2. 显式转人工
    if "转人工" in query:
        return Answer(
            text="好的，正在为您转接人工坐席，请稍候。",
            confidence=1.0,
            escalate=True,
            escalate_reason="visitor_requested",
            mode="rule_react",
        )

    # 3. 长期记忆：老访客主动问候
    mem = storage.get_memory(visitor_id) if visitor_id else {}
    first_visit = storage.session_count(visitor_id) <= 1 if visitor_id else True
    if not first_visit and mem:
        mem["greeting"] = "欢迎回来！注意到您之前咨询过：" + "、".join(list(mem.keys())[:3])

    # 4. 多模态
    if image_b64:
        img = process_image(image_b64, query)
        if img.get("escalate"):
            llm = _llm_react(query, history, mem, image_b64)
            if llm:
                return llm
            return Answer(
                text=img.get("note", "已收到图片，正在为您转接人工坐席查看。"),
                confidence=0.3,
                escalate=True,
                escalate_reason="image_needs_human",
                tool_used="vision",
                mode="rule_react",
            )

    # 5. ReAct（LLM 优先，规则兜底）
    llm = _llm_react(query, history, mem, image_b64)
    if llm:
        return llm
    return _rule_react(query, history, mem)


def health() -> dict:
    return {
        "mode": "llm_react" if LLM_READY else "rule_react",
        "llm_ready": LLM_READY,
        "model": USER_LLM_MODEL if LLM_READY else None,
        "base_url": USER_LLM_BASE_URL if LLM_READY else None,
        "kb_entries": len(_load_kb()),
        "tools": list(_TOOLS.keys()),
        "escalate_threshold": USER_ESCALATE_THRESHOLD,
        "react_steps": USER_REACT_STEPS,
    }
