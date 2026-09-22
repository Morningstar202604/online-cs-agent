import json
import uuid

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import storage
import agent_core

app = FastAPI(title="Online CS Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

storage.init_db()


class NewSession(BaseModel):
    visitor_id: str = "anonymous"


class MessageIn(BaseModel):
    content: str
    image: str | None = None  # base64 图片（多模态占位）


class FeedbackIn(BaseModel):
    message_id: int | None = None
    rating: str  # helpful | not_helpful
    comment: str = ""


# ---- in-memory broadcast hub for operator -> visitor real-time push ----
class Hub:
    def __init__(self):
        self.visitor_conns: dict[str, set[WebSocket]] = {}
        self.operator_conns: set[WebSocket] = set()

    async def publish(self, session_id: str, payload: dict):
        for ws in list(self.visitor_conns.get(session_id, ())):
            try:
                await ws.send_json(payload)
            except Exception:
                self.visitor_conns.get(session_id, set()).discard(ws)

    async def broadcast_to_operators(self, payload: dict):
        for ws in list(self.operator_conns):
            try:
                await ws.send_json(payload)
            except Exception:
                self.operator_conns.discard(ws)

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        self.visitor_conns.setdefault(session_id, set()).add(ws)
        try:
            while True:
                await ws.receive_text()  # keepalive / client ping
        except WebSocketDisconnect:
            self.visitor_conns.get(session_id, set()).discard(ws)

    async def connect_operator(self, ws: WebSocket):
        await ws.accept()
        self.operator_conns.add(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            self.operator_conns.discard(ws)


hub = Hub()


# ---------- Visitor API ----------
@app.post("/api/sessions")
def new_session(body: NewSession):
    sid = uuid.uuid4().hex
    storage.create_session(sid, body.visitor_id)
    return {"session_id": sid, "status": "ongoing", "visitor_id": body.visitor_id}


@app.get("/api/sessions/{sid}/messages")
def get_messages(sid: str):
    if not storage.get_messages(sid):
        # session may exist with no messages yet; that is fine
        pass
    return {"messages": storage.get_messages(sid)}


@app.post("/api/sessions/{sid}/messages")
async def post_message(sid: str, body: MessageIn):
    content = (body.content or "").strip()
    sess = storage.get_session(sid)
    visitor_id = (sess or {}).get("visitor_id", "anonymous")
    if not content and not body.image:
        raise HTTPException(400, "empty message")

    # 注入护栏检测
    inj = agent_core.detect_injection(content)
    if inj:
        storage.add_message(sid, "visitor", content)
        storage.log_injection(sid, visitor_id, content, inj, "blocked")
        storage.add_message(sid, "agent", "检测到越权输入，已拦截并记录。请就具体问题咨询。", tool_used="injection_guard")
        return {
            "role": "agent",
            "text": "检测到越权/提示词注入输入，本次消息已拦截。请就具体问题咨询，我们会正常为您服务。",
            "citations": [],
            "confidence": 1.0,
            "escalate": False,
            "ticket_id": None,
            "mode": "guardrail",
            "tool_used": "injection_guard",
            "message_id": None,
        }

    history = storage.get_messages(sid)
    storage.add_message(sid, "visitor", content or "（附图）", image_b64_placeholder=body.image)

    answer = agent_core.respond(content or "（附图）", history, visitor_id, body.image or "")
    # 长期记忆沉淀：记录本条问题的主题
    if content:
        storage.set_memory(visitor_id, "last_topic", content[:50])

    if answer.escalate:
        storage.mark_escalated(sid, answer.escalate_reason)
        ticket_id = storage.create_ticket(sid)
        msg_id = storage.add_message(
            sid, "agent", answer.text or "正在为您转接人工坐席…",
            refs=answer.citations, tool_used=answer.tool_used,
        )
        await hub.broadcast_to_operators(
            {
                "type": "new_pending",
                "session_id": sid,
                "ticket_id": ticket_id,
                "reason": answer.escalate_reason,
            }
        )
        return {
            "role": "agent",
            "text": answer.text,
            "citations": answer.citations,
            "confidence": answer.confidence,
            "escalate": True,
            "escalate_reason": answer.escalate_reason,
            "ticket_id": ticket_id,
            "mode": answer.mode,
            "tool_used": answer.tool_used,
            "tool_result": answer.tool_result,
            "memory_note": answer.memory_note,
            "message_id": msg_id,
        }

    msg_id = storage.add_message(
        sid, "agent", answer.text, refs=answer.citations, tool_used=answer.tool_used
    )
    return {
        "role": "agent",
        "text": answer.text,
        "citations": answer.citations,
        "confidence": answer.confidence,
        "escalate": False,
        "ticket_id": None,
        "mode": answer.mode,
        "tool_used": answer.tool_used,
        "tool_result": answer.tool_result,
        "memory_note": answer.memory_note,
        "message_id": msg_id,
    }


@app.post("/api/sessions/{sid}/escalate")
async def escalate(sid: str):
    storage.mark_escalated(sid, "visitor_requested")
    ticket_id = storage.create_ticket(sid)
    storage.add_message(sid, "agent", "好的，正在为您转接人工坐席。")
    await hub.broadcast_to_operators(
        {"type": "new_pending", "session_id": sid, "ticket_id": ticket_id, "reason": "visitor_requested"}
    )
    return {"ticket_id": ticket_id, "status": "pending_agent"}


# ---------- Operator API ----------
@app.get("/api/operator/queues")
def operator_queues():
    return storage.pending_queues()


@app.post("/api/operator/take/{sid}")
async def take_session(sid: str, body: NewSession = NewSession()):
    storage.set_status(sid, "agent_handled", assignee=body.visitor_id)
    await hub.publish(
        sid,
        {"type": "agent_handled", "operator": body.visitor_id, "session_id": sid},
    )
    await hub.broadcast_to_operators(
        {"type": "session_updated", "session_id": sid, "status": "agent_handled"}
    )
    return {"session_id": sid, "status": "agent_handled", "assignee": body.visitor_id}


@app.post("/api/operator/reply/{sid}")
async def operator_reply(sid: str, body: MessageIn):
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "empty message")
    storage.add_message(sid, "operator", content)
    await hub.publish(
        sid,
        {
            "type": "operator_message",
            "role": "operator",
            "content": content,
            "session_id": sid,
        },
    )
    await hub.broadcast_to_operators(
        {"type": "operator_replied", "session_id": sid, "content": content}
    )
    return {"role": "operator", "content": content}


@app.post("/api/operator/close/{sid}")
async def close_session(sid: str):
    storage.close_session(sid)
    await hub.publish(
        sid,
        {"type": "session_closed", "session_id": sid},
    )
    await hub.broadcast_to_operators(
        {"type": "session_updated", "session_id": sid, "status": "closed"}
    )
    return {"session_id": sid, "status": "closed"}


# ---------- 长期记忆 / 反馈 / 注入日志 ----------
@app.get("/api/memory/{visitor_id}")
def get_memory(visitor_id: str):
    return {
        "visitor_id": visitor_id,
        "memory": storage.get_memory(visitor_id),
        "visits": storage.session_count(visitor_id),
    }


@app.post("/api/sessions/{sid}/feedback")
def add_feedback(sid: str, body: FeedbackIn):
    if body.rating not in ("helpful", "not_helpful"):
        raise HTTPException(400, "rating must be helpful or not_helpful")
    storage.add_feedback(sid, body.message_id or 0, body.rating, body.comment)
    # 差评自动升级
    if body.rating == "not_helpful":
        sess = storage.get_session(sid)
        if sess and sess["status"] in ("ongoing",):
            storage.mark_escalated(sid, "feedback_not_helpful")
            ticket_id = storage.create_ticket(sid)
            storage.add_message(sid, "agent", "很抱歉回答未帮到您，已为您转接人工坐席。", tool_used="feedback")
            return {"rating": body.rating, "escalated": True, "ticket_id": ticket_id}
    return {"rating": body.rating, "escalated": False}


@app.get("/api/feedback/summary")
def feedback_summary():
    return storage.feedback_summary()


@app.get("/api/injection-log")
def injection_log(limit: int = 20):
    import sqlite3
    import os
    conn = sqlite3.connect(os.environ.get("CS_AGENT_DB", "cs_agent.db"))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT session_id, visitor_id, raw_input, detected, action, created_at "
        "FROM injection_log ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return {"entries": [dict(r) for r in rows]}


# ---------- Meta ----------
@app.get("/api/agent/health")
def health():
    return agent_core.health()


@app.get("/api/debug/conn")
def debug_conn():
    return {
        "visitor_sessions": list(hub.visitor_conns.keys()),
        "visitor_total": sum(len(v) for v in hub.visitor_conns.values()),
        "operator_total": len(hub.operator_conns),
    }


@app.get("/api/kb")
def kb():
    return {"kb": agent_core._load_kb()}


# ---------- WebSocket (operator desk real-time) ----------
# 必须先注册静态路径 /ws/operator，否则会被 /ws/{sid} 捕获
@app.websocket("/ws/operator")
async def ws_operator(ws: WebSocket):
    await hub.connect_operator(ws)


# ---------- WebSocket (operator -> visitor push) ----------
@app.websocket("/ws/{sid}")
async def ws(sid: str, ws: WebSocket):
    await hub.connect(sid, ws)
