"""运行时配置中心：默认值来自环境变量，可被 SQLite config 表覆盖，改完即时生效。

把 2026 主流 Agent 能力的可调参数集中在这里：模型、检索、上下文工程、
记忆、工具、护栏、升级阈值。agent_core 统一读这里，不再各自读 env。
"""
import json
import os

import storage

DEFAULTS = {
    # --- 模型 ---
    "llm": {
        "base_url": os.environ.get("USER_LLM_BASE_URL", "https://api.openai.com/v1"),
        "model": os.environ.get("USER_LLM_MODEL", "gpt-4o-mini"),
        "temperature": 0.2,
        "top_p": 1.0,
        "max_tokens": 512,
        # api_key 仅接受 env 注入，不落库，避免把凭据写进配置表
        "has_key": bool(os.environ.get("USER_LLM_API_KEY") and os.environ.get("USER_LLM_API_KEY") != "your-api-key-here"),
    },
    # --- 检索 ---
    "retrieval": {
        "kb_top_k": int(os.environ.get("USER_KB_TOP_K", "4")),
        "min_overlap": 0.08,
    },
    # --- 上下文工程 ---
    "context": {
        "history_turns": 10,        # 注入的历史轮数
        "char_budget": 2400,        # 历史 + KB 的字符预算
        "compress_threshold": 6,     # 历史超过 N 轮触发摘要压缩
        "summarize": True,          # 是否启用长历史摘要
        "relevant_only": True,      # 是否按相关性筛选历史
        "modules": {               # system prompt 各模块开关
            "kb": True,
            "tools": True,
            "memory": True,
            "persona": True,
            "summary": True,
        },
        "persona": "你是专业的在线客服 Agent，语气友好、简洁、可靠，使用中文回答。",
    },
    # --- 记忆 ---
    "memory": {
        "enable": True,
        "retrieval_top_k": 3,        # 按相关性注入的记忆片段数
        "auto_capture": True,        # 自动从对话沉淀偏好/事实
        "capture_keywords": ["喜欢", "常用", "偏好", "每次", "习惯", "总是"],
        "visit_greeting": True,      # 老访客主动问候
    },
    # --- 工具 ---
    "tools": {
        "query_order": True,
        "initiate_refund": True,
        "lookup_policy": True,
    },
    # --- 多模态 ---
    "multimodal": {
        "enable": True,
    },
    # --- 护栏 ---
    "guardrail": {
        "injection_block": True,
    },
    # --- 引擎模式（rule / llm / auto）---
    "engine": {
        "mode": "auto",
    },
    # --- 升级 ---
    "escalation": {
        "confidence_threshold": float(os.environ.get("USER_ESCALATE_THRESHOLD", "0.6")),
        "max_message_len": int(os.environ.get("USER_MAX_MESSAGE_LEN", "1000")),
        "react_steps": int(os.environ.get("USER_REACT_STEPS", "3")),
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = json.loads(json.dumps(base))
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _has_key() -> bool:
    key = os.environ.get("USER_LLM_API_KEY", "")
    return bool(key and key != "your-api-key-here")


def get_config() -> dict:
    """返回合并后的运行时配置。env 提供基础，DB 覆盖。"""
    cfg = json.loads(json.dumps(DEFAULTS))
    stored = storage.get_config() or {}
    cfg = _deep_merge(cfg, stored)
    # has_key 永远来自 env，不信任 DB 里的布尔
    cfg["llm"]["has_key"] = _has_key()
    cfg["llm"]["api_key"] = "configured" if cfg["llm"]["has_key"] else "missing"
    return cfg


def update_config(patch: dict) -> dict:
    """按 key 覆盖运行时配置，返回新配置。"""
    storage.set_config(patch or {})
    return get_config()
