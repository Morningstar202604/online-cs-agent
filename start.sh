#!/bin/bash
# 启动后端 (FastAPI) + 前端 (Vite)
# 前端 devServer :5173 通过 /api 反向代理到后端 :8000
set -e

# 加载后端 LLM 环境变量（若存在 backend/.env）
if [ -f backend/.env ]; then
  set -a
  source backend/.env
  set +a
fi

# 启动后端
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir backend &
BACKEND_PID=$!

# 启动前端（作为暴露端口）
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173

# 清理
trap "kill $BACKEND_PID 2>/dev/null" EXIT
