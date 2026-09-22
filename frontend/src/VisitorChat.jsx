import { useEffect, useRef, useState, useCallback } from 'react'

const QUICK = [
  '我的订单 ORD12345678 何时发货？',
  '如何申请退款？',
  '怎么开发票？',
  '帮我转人工',
]
const MAX_LEN = 1000

export default function VisitorChat() {
  const sessionRef = useRef(null)
  const visitorIdRef = useRef(null)
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [image, setImage] = useState('')
  const [loading, setLoading] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [ticketId, setTicketId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [error, setError] = useState('')
  const [memoryNote, setMemoryNote] = useState('')
  const [lastMsg, setLastMsg] = useState(null)
  const [feedback, setFeedback] = useState('')
  const bodyRef = useRef(null)

  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current
    const vid = 'v-' + Math.random().toString(36).slice(2, 8)
    visitorIdRef.current = vid
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: vid }),
    })
    const data = await res.json()
    sessionRef.current = data.session_id
    setSessionId(data.session_id)
    return data.session_id
  }, [])

  useEffect(() => {
    ensureSession()
  }, [ensureSession])

  // 老访客主动问候（长期记忆）
  useEffect(() => {
    if (!visitorIdRef.current || !sessionId) return
    fetch(`/api/memory/${visitorIdRef.current}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.visits > 1 && d.memory && Object.keys(d.memory).length > 0) {
          const topics = Object.values(d.memory).slice(0, 3).join('、')
          setMemoryNote(`欢迎回来！您之前咨询过：${topics}`)
        }
      })
      .catch(() => {})
  }, [sessionId])

  // 实时推送
  useEffect(() => {
    if (!sessionId) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${window.location.host}/ws/${sessionId}`)
    socket.onmessage = (e) => {
      const p = JSON.parse(e.data)
      if (p.type === 'operator_message') {
        setMessages((prev) => [
          ...prev,
          { role: 'operator', content: p.content, refs: [], ts: new Date().toISOString() },
        ])
        setLastMsg(null)
      } else if (p.type === 'agent_handled') {
        setOperatorName(p.operator || '')
        setMessages((prev) => [
          ...prev,
          { role: 'operator', content: `坐席 ${p.operator || '已接管'} 为您服务，请稍候…`, ts: new Date().toISOString() },
        ])
      } else if (p.type === 'session_closed') {
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: '会话已关闭，感谢您的咨询。', ts: new Date().toISOString() },
        ])
      }
    }
    return () => socket.close()
  }, [sessionId])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, loading])

  const onPickImage = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setImage(reader.result)
    reader.readAsDataURL(f)
  }

  const send = async (text) => {
    const content = (text ?? input).trim()
    if (!content || loading) return
    if (content.length > MAX_LEN) {
      setError(`消息过长，请控制在 ${MAX_LEN} 字符以内`)
      return
    }
    setError('')
    const sid = await ensureSession()
    const img = image.startsWith('data:') ? image.split(',')[1] : image
    setInput('')
    setImage('')
    setLastMsg(null)
    setFeedback('')
    setMessages((prev) => [
      ...prev,
      { role: 'visitor', content, refs: [], ts: new Date().toISOString(), image: img || undefined },
    ])
    setLoading(true)
    try {
      const res = await fetch(`/api/sessions/${sid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, image: img || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '请求失败')
      }
      const data = await res.json()
      const msg = {
        role: 'agent',
        content: data.text,
        refs: data.citations || [],
        ts: new Date().toISOString(),
        tool_used: data.tool_used,
        tool_result: data.tool_result,
        message_id: data.message_id,
      }
      setMessages((prev) => [...prev, msg])
      setLastMsg(msg)
      if (data.escalate) {
        setEscalated(true)
        setTicketId(data.ticket_id || '')
      }
      if (data.memory_note) setMemoryNote(data.memory_note)
      if (data.tool_used === 'injection_guard') {
        setError('检测到越权/提示词注入输入，已拦截并记录。请就具体问题咨询。')
      }
    } catch (e) {
      setError(e.message || '网络异常，请检查连接后重试')
    } finally {
      setLoading(false)
    }
  }

  const giveFeedback = async (rating) => {
    if (!sessionId || !lastMsg) return
    setFeedback(rating)
    try {
      await fetch(`/api/sessions/${sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, message_id: lastMsg.message_id }),
      })
      if (rating === 'not_helpful') {
        setEscalated(true)
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: '已为您转接人工坐席跟进。', ts: new Date().toISOString() },
        ])
      }
    } catch (e) {}
  }

  return (
    <div>
      {memoryNote && <div className="memory-banner">{memoryNote}</div>}
      {error && <div className="hint err">{error}</div>}
      <div className="chat-panel">
        <div className="chat-head">
          <div className="chat-head-left">
            <span className="avatar">客服</span>
            <div>
              <div>在线客服 Agent</div>
              <div className="sub">{sessionId ? `会话 #${sessionId.slice(0, 8)}` : '正在连接…'}</div>
            </div>
          </div>
          {escalated && (
            <span className="badge">
              已转人工{operatorName ? ` · 坐席 ${operatorName}` : ''} {ticketId}
            </span>
          )}
        </div>
        <div className="chat-body" ref={bodyRef}>
          {messages.length === 0 && !loading && (
            <p className="hint">您好，我是在线客服 Agent。可点击下方常见问题，或直接输入；支持上传截图（多模态）。</p>
          )}
          {messages.map((m, i) => (
            <div key={`m-${i}-${m.ts || ''}`} className={`msg-row ${m.role}`}>
              {m.role === 'system' ? (
                <div className="system-line">{m.content}</div>
              ) : (
                <div className={`msg ${m.role}`}>
                  {m.image && (
                    <img
                      src={m.image.startsWith('data:') ? m.image : 'data:image/png;base64,' + m.image}
                      alt="用户上传图"
                      className="user-img"
                    />
                  )}
                  {m.content}
                  {m.refs && m.refs.length > 0 && <span className="refs">依据：{m.refs.join(', ')}</span>}
                  {m.tool_used && m.tool_used !== 'injection_guard' && (
                    <span className="tool-chip">工具：{toolLabel(m.tool_used)}</span>
                  )}
                </div>
              )}
              {m.ts && <span className="msg-time">{formatTime(m.ts)}</span>}
            </div>
          ))}
          {loading && (
            <div className="typing">
              <span className="dot" /> <span className="dot" /> <span className="dot" />
              <span className="typing-label">Agent 正在处理…</span>
            </div>
          )}
          {escalated && !operatorName && (
            <p className="hint warn">已为您转接人工坐席，坐席在线后会实时出现在这里。</p>
          )}
          {lastMsg && !escalated && !loading && (
            <div className="feedback-row">
              <span className="feedback-label">这条回答有用吗？</span>
              <button
                className={`fb-btn ${feedback === 'helpful' ? 'on' : ''}`}
                onClick={() => giveFeedback('helpful')}
              >
                {feedback === 'helpful' ? '已标记有用' : '有用'}
              </button>
              <button
                className={`fb-btn ${feedback === 'not_helpful' ? 'on' : ''}`}
                onClick={() => giveFeedback('not_helpful')}
              >
                {feedback === 'not_helpful' ? '已转人工' : '没用'}
              </button>
            </div>
          )}
        </div>
        <div className="quick-row">
          {QUICK.map((q) => (
            <button key={q} className="quick" onClick={() => send(q)} disabled={loading}>
              {q}
            </button>
          ))}
        </div>
        <div className="chat-input">
          <label className="img-btn" title="上传截图（多模态）">
            📎
            <input type="file" accept="image/*" onChange={onPickImage} />
          </label>
          {image && <img src={image} alt="预览" className="img-preview" />}
          <input
            value={input}
            maxLength={MAX_LEN}
            placeholder="输入您的问题…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <span className="char-count">{input.length}/{MAX_LEN}</span>
          <button className="btn" onClick={() => send()} disabled={loading || !input.trim()}>
            发送
          </button>
        </div>
      </div>
      <p className="hint">
        当前 Agent 能力：工具调用（查订单/退款/政策）· 多模态（截图）· 长期记忆 · 注入护栏 · ReAct 推理。
        LLM 凭据未配置时走规则 + 检索模式。
      </p>
    </div>
  )
}

function toolLabel(name) {
  return {
    query_order: '查订单',
    initiate_refund: '退款申请',
    lookup_policy: '查政策',
    vision: '图片识别',
  }[name] || name
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
