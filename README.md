# 在线客服 Agent

基于 Web 全栈的在线客服答疑 Agent。访客自助提问，Agent 基于知识库（RAG）+ LLM 回答；解决不了自动升级人工坐席，坐席在工作台接管并回复（WebSocket 实时推送）。

## 技术栈

- 前端：React + Vite（访客聊天页 `/` + 坐席工作台 `/operator`），`/api` 反向代理到后端
- 后端：FastAPI + SQLite
- Agent：RAG（知识库 bigram 检索 top-K）+ OpenAI 兼容 LLM；未配置 LLM 凭据时自动降级为规则 + 检索模式
- 持久化：SQLite（sessions / messages / tickets）

## 快速启动

```bash
# 后端（规则模式，无需 LLM 凭据）
cd backend
pip install -r requirements.txt
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000

# 前端
cd frontend
npm install
npm run dev
```

或一键：`./start.sh`（启动双服务，前端 :5173 含 /api 代理）

## 接入 LLM（可选）

复制 `backend/.env.example` 为 `backend/.env`，填入你的 OpenAI 兼容凭据：

```
USER_LLM_API_KEY=你的 Key
USER_LLM_BASE_URL=https://api.openai.com/v1
USER_LLM_MODEL=gpt-4o-mini
```

代码仅通过环境变量读取 `USER_LLM_API_KEY` / `USER_LLM_BASE_URL` / `USER_LLM_MODEL`，缺失时自动走规则模式（仍可用，命中 KB 会标注来源编号，未命中转人工）。

### 切换 LLM 供应商

任意 OpenAI 兼容端点都支持。常用配置：

- **OpenAI**：`USER_LLM_BASE_URL=https://api.openai.com/v1`，`USER_LLM_MODEL=gpt-4o-mini`
- **DeepSeek**：`USER_LLM_BASE_URL=https://api.deepseek.com/v1`，`USER_LLM_MODEL=deepseek-chat`
- **通义千问**：`USER_LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`，`USER_LLM_MODEL=qwen-plus`

保存后重启后端即可。`GET /api/agent/health` 返回的 `mode` 字段会显示 `llm`（已接）或 `rule`（未接），可用于快速确认当前状态。

### 自定义检索与阈值

- `USER_KB_TOP_K`：检索条数，默认 4
- `USER_ESCALATE_THRESHOLD`：置信度升级阈值，默认 0.6
- `USER_MAX_MESSAGE_LEN`：单条消息长度上限，默认 1000

## 知识库

演示数据在 `backend/data/kb.json`（物流/售后/账户/使用/发票/投诉 6 类）。替换为你自己的条目即可，字段：`id`、`text`（含关键词）、`title`、`answer`、`tags`。

## 测试

```bash
cd backend
pytest test_agent.py -v
```

覆盖：检索命中/未命中、规则回答与升级判定、坐席请求升级、会话生命周期。

## 预览

本地开发服务器暴露在前端端口 :5173，`/api` 与 `/ws` 已反向代理到 :8000。
