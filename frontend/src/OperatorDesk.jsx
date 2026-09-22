import { useEffect, useRef, useState, useCallback } from 'react'

export default function OperatorDesk() {
  const [queues, setQueues] = useState({ sessions: [], tickets: [] })
  const [active, setActive] = useState(null)
  const [dialog, setDialog] = useState([])
  const [reply, setReply] = useState('')
  const [connState, setConnState] = useState('connecting')
  const [error, setError] = useState('')
  const [opId] = useState(
    () => localStorage.getItem('cs_op_id') || 'op-' + Math.random().toString(36).slice(2, 8),
  )
  const bodyRef = useRef(null)
  const wsRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('cs_op_id', opId)
  }, [opId])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/operator/queues')
      setQueues(await res.json())
      setError('')
    } catch (e) {
      setError('获取队列失败，请检查后端是否在线')
    }
  }, [])

  // 首次加载 + 低频兜底轮询（WS 为主，保留 15s 兜底）
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [refresh])

  // WS 实时接收新会话 / 状态变更
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${window.location.host}/ws/operator`)
    wsRef.current = socket
    socket.onopen = () => setConnState('online')
    socket.onclose = () => setConnState('offline')
    socket.onmessage = (e) => {
      const p = JSON.parse(e.data)
      if (p.type === 'new_pending') {
        refresh()
      } else if (p.type === 'session_updated') {
        refresh()
      }
    }
    return () => socket.close()
  }, [refresh])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [dialog])

  const openDialog = async (sid) => {
    setActive(sid)
    const res = await fetch(`/api/sessions/${sid}/messages`)
    const data = await res.json()
    setDialog(data.messages)
  }

  const take = async (sid) => {
    setError('')
    try {
      const res = await fetch('/api/operator/take/' + sid, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: opId }),
      })
      if (!res.ok) throw new Error('接管失败')
      await refresh()
      openDialog(sid)
    } catch (e) {
      setError(e.message)
    }
  }

  const doReply = async () => {
    const c = reply.trim()
    if (!c || !active) return
    setReply('')
    setDialog((prev) => [
      ...prev,
      { role: 'operator', content: c, refs: [], ts: new Date().toISOString() },
    ])
    try {
      const res = await fetch(`/api/operator/reply/${active}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: c }),
      })
      if (!res.ok) throw new Error('回复失败')
    } catch (e) {
      setError(e.message)
    }
  }

  const closeSess = async (sid) => {
    setError('')
    try {
      const res = await fetch(`/api/operator/close/${sid}`, { method: 'POST' })
      if (!res.ok) throw new Error('关闭失败')
      setActive(null)
      setDialog([])
      await refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  const connDot = {
    online: 'online-dot',
    offline: 'offline-dot',
    connecting: 'connecting-dot',
  }[connState]

  return (
    <div>
      <div className="op-top">
        <div>
          <span className="conn-dot" /> 实时连接：{connState === 'online' ? '在线' : connState === 'offline' ? '已断开' : '连接中'}
        </div>
        <div className="sub">坐席 {opId}</div>
      </div>

      <div className="queue-grid">
        <div className="card">
          <h3>待接管会话（{queues.sessions.length}）</h3>
          {queues.sessions.length === 0 && <div className="empty">暂无待接管会话</div>}
          {queues.sessions.map((s) => (
            <div key={s.id} className="queue-item">
              <div className="queue-title">
                会话 #{s.id.slice(0, 8)}
                <span className="meta">原因：{s.escalate_reason || '-'}</span>
              </div>
              <div className="ops-row">
                <button className="btn" onClick={() => take(s.id)}>接管并对话</button>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>工单（{queues.tickets.length}）</h3>
          {queues.tickets.length === 0 && <div className="empty">暂无工单</div>}
          {queues.tickets.map((t) => (
            <div key={t.id} className="queue-item">
              <div className="queue-title">
                {t.id} · #{t.session_id.slice(0, 8)}
                <span className="meta">
                  {t.priority} · {t.status} · {new Date(t.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {active && (
        <div className="op-dialog">
          <div className="op-dialog-head">
            <h3>会话 #{active.slice(0, 8)}</h3>
            <button className="btn secondary sm" onClick={() => closeSess(active)}>关闭会话</button>
          </div>
          <div className="chat-body" ref={bodyRef}>
            {dialog.length === 0 && <div className="empty">暂无消息</div>}
            {dialog.map((m, i) => (
              <div key={`op-${m.role}-${i}-${m.ts || ''}`} className={`msg-row ${m.role}`}>
                <div className={`msg ${m.role}`}>
                  {m.content}
                  {m.refs && m.refs.length > 0 && <span className="refs">依据：{m.refs.join(', ')}</span>}
                </div>
                {m.ts && <span className="msg-time">{formatTime(m.ts)}</span>}
              </div>
            ))}
          </div>
          {error && <p className="hint err">{error}</p>}
          <div className="chat-input">
            <input
              value={reply}
              placeholder="以坐席身份回复…"
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doReply()}
            />
            <button className="btn" onClick={doReply} disabled={!reply.trim()}>回复</button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
