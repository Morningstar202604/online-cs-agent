import { useRef, useEffect, useState, useCallback, memo } from 'react'
import {
  Plus,
  RefreshCw,
  Package,
  Undo2,
  ScrollText,
  User,
  Headset,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react'
import {
  Avatar,
  Composer,
  FeedbackRow,
  InjectBanner,
  MsgMeta,
} from './ui'
import { useWs } from './hooks/useWs'
import { ensureVisitorId, useAppStore } from './store/appStore'
import { useShell } from './components/ResponsiveShell'
import { http } from './lib/queries'
import './pages.css'

const SCENES = [
  { icon: <Package size={16} />, bg: 'var(--brand-soft)', color: 'var(--brand)', title: '查订单物流', text: '我的订单 ORD12345678 什么时候发货？' },
  { icon: <Undo2 size={16} />, bg: 'var(--ok-soft)', color: '#1a8f52', title: '申请退款', text: '我想申请退款，怎么操作？' },
  { icon: <ScrollText size={16} />, bg: 'var(--warn-soft)', color: '#b5731b', title: '查退改政策', text: '旅游团退改政策是怎么规定的？' },
  { icon: <User size={16} />, bg: 'var(--operator-soft)', color: '#c2358f', title: '转人工坐席', text: '帮我转人工' },
]

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem('cs_sessions') || '[]')
  } catch {
    return []
  }
}

function saveSessions(list) {
  localStorage.setItem('cs_sessions', JSON.stringify(list.slice(0, 30)))
}

// 消息行：memo 避免长列表时整列重渲染
const MsgRow = memo(function MsgRow({ m, last, escalated, loading, onFeedback, feedback }) {
  if (m.role === 'system') {
    return (
      <div className="msg-row system">
        <div className="system-line">{m.content}</div>
      </div>
    )
  }
  return (
    <div className={`msg-row ${m.role}`}>
      <Avatar kind={m.role} size={30} />
      <div className="msg-body">
        {m.image && (
          <img
            src={m.image.startsWith('data:') ? m.image : 'data:image/png;base64,' + m.image}
            alt="用户上传图"
            className="user-img"
          />
        )}
        <div className="bubble">{m.content}</div>
        {m.role === 'agent' && <MsgMeta msg={m} />}
        {m.ts && <span className="msg-time">{formatTime(m.ts)}</span>}
        {m.role === 'agent' && (
          <FeedbackRow
            onFeedback={onFeedback}
            feedback={feedback}
            show={last && !escalated && !loading}
          />
        )}
      </div>
    </div>
  )
})

export default function VisitorChat() {
  const [sessions, setSessions] = useState(loadSessions)
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState([])
  const [image, setImage] = useState('')
  const [loading, setLoading] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [ticketId, setTicketId] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [error, setError] = useState('')
  const [memoryNote, setMemoryNote] = useState('')
  const [lastMsg, setLastMsg] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [injectMsg, setInjectMsg] = useState('')
  const bodyRef = useRef(null)
  const visitorId = useRef(null)
  const { mobile } = useShell()

  // 草稿走 zustand（切页不丢输入）
  const draft = useAppStore((s) => s.draft['visitor'] ?? '')
  const setDraft = useAppStore((s) => s.setDraft)
  const [input, setInput] = useState(draft)
  useEffect(() => {
    // 挂载时回填一次；之后由 setDraft 同步
    if (draft) setInput(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const onInputChange = (v) => {
    setInput(v)
    setDraft('visitor', v)
  }
  const onPickImage = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setImage(reader.result)
    reader.readAsDataURL(f)
  }

  // 键盘弹起时把输入区保持在可视范围内（visualViewport）
  const footRef = useRef(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      if (footRef.current) {
        footRef.current.style.bottom = Math.max(0, vv.offsetTop + vv.height - window.innerHeight) + 'px'
      }
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const ensureSession = useCallback(
    async (firstContent) => {
      if (sessionId) return sessionId
      if (!visitorId.current) visitorId.current = ensureVisitorId()
      const data = await http.post('/api/sessions', { visitor_id: visitorId.current })
      setSessionId(data.session_id)
      setSessions((prev) => {
        const next = [
          {
            sid: data.session_id,
            title: firstContent ? firstContent.slice(0, 20) : '新对话',
            ts: Date.now(),
          },
          ...prev.filter((s) => s.sid !== data.session_id),
        ]
        saveSessions(next)
        return next
      })
      return data.session_id
    },
    [sessionId],
  )

  // 老访客问候
  useEffect(() => {
    const vid = ensureVisitorId()
    http.get(`/api/memory/${vid}`)
      .then((d) => {
        if (d.visits > 1 && d.memory && Object.keys(d.memory).length > 0) {
          const topics = Object.values(d.memory).slice(0, 3).join('、')
          setMemoryNote(`欢迎回来！您之前咨询过：${topics}`)
        }
      })
      .catch(() => {})
  }, [])

  // WS 实时通道（useWs 自动重连；sessionId 为空时不连接）
  const { state: wsState } = useWs(
    sessionId ? `/ws/${sessionId}` : null,
    (p) => {
      if (p.type === 'operator_message') {
        setMessages((prev) => [
          ...prev,
          { role: 'operator', content: p.content, refs: [], ts: new Date().toISOString() },
        ])
        setLastMsg(null)
      } else if (p.type === 'agent_handled') {
        setOperatorName(p.operator || '坐席')
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `坐席 ${p.operator || '已接管'} 为您服务`, ts: new Date().toISOString() },
        ])
      } else if (p.type === 'session_closed') {
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: '会话已关闭，感谢您的咨询。', ts: new Date().toISOString() },
        ])
      }
    },
  )

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, loading])

  const openHistory = async (sid, title) => {
    setSessionId(sid)
    setEscalated(false)
    setOperatorName('')
    setLastMsg(null)
    setFeedback('')
    setInjectMsg('')
    try {
      const data = await http.get(`/api/sessions/${sid}/messages`)
      setMessages(
        (data.messages || []).map((m) => ({
          role: m.role === 'agent' ? 'agent' : m.role === 'operator' ? 'operator' : m.role === 'system' ? 'system' : 'visitor',
          content: m.content,
          refs: m.refs || [],
          ts: m.created_at,
          message_id: m.id,
        })),
      )
    } catch {
      setMessages([])
    }
    setSessions((prev) => {
      const next = prev.map((s) => (s.sid === sid ? { ...s, title: title || s.title } : s))
      saveSessions(next)
      return next
    })
  }

  const newChat = async () => {
    if (loading) return
    setSessionId('')
    setMessages([])
    setEscalated(false)
    setOperatorName('')
    setLastMsg(null)
    setFeedback('')
    setInjectMsg('')
    setError('')
    setMemoryNote('')
    setInput('')
    setDraft('visitor', '')
  }

  const send = async (text) => {
    const content = (text ?? input).trim()
    if (!content && !image) return
    if (loading) return
    setError('')
    setLastMsg(null)
    setFeedback('')
    const img = image.startsWith('data:') ? image.split(',')[1] : image
    const sid = await ensureSession(content)
    onInputChange('')
    setImage('')
    setMessages((prev) => [
      ...prev,
      { role: 'visitor', content: content || '（附图）', refs: [], ts: new Date().toISOString(), image: img || undefined },
    ])
    setLoading(true)
    try {
      const data = await http.post(`/api/sessions/${sid}/messages`, { content, image: img || null })
      const msg = {
        role: 'agent',
        content: data.text,
        refs: data.citations || [],
        ts: new Date().toISOString(),
        tool_used: data.tool_used,
        tool_result: data.tool_result,
        ctx_used: data.ctx_used,
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
        setInjectMsg('检测到越权/提示词注入输入，已拦截并记录。请就具体问题咨询。')
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
      await http.post(`/api/sessions/${sessionId}/feedback`, { rating, message_id: lastMsg.message_id })
      if (rating === 'not_helpful') {
        setEscalated(true)
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: '已为您转接人工坐席跟进。', ts: new Date().toISOString() },
        ])
      }
    } catch {}
  }

  const hasMessages = messages.length > 0
  const isMobile = mobile

  // 移动端：左侧会话栏收起，新对话入口移到顶部
  return (
    <div className={`chat-app ${isMobile ? 'chat-app-mobile' : ''}`}>
      {isMobile && (
        <div className="mobile-side-trigger">
          <button className="btn ghost sm" onClick={newChat} disabled={loading}>
            <Plus size={14} /> 新对话
          </button>
        </div>
      )}
      {/* 左侧：会话栏（移动端隐藏） */}
      <aside className={`side ${isMobile ? 'side-mobile' : ''}`}>
        <div className="side-head">
          <button className="new-chat" onClick={newChat} disabled={loading}>
            <Plus size={16} />
            新对话
          </button>
        </div>
        <div className="side-section">
          <div className="side-label">快速场景</div>
          <div className="scene-grid">
            {SCENES.map((s, i) => (
              <button key={i} className="scene" onClick={() => send(s.text)} disabled={loading}>
                <span className="s-ico" style={{ background: s.bg, color: s.color }}>
                  {s.icon}
                </span>
                <span>
                  <span className="s-t">{s.title}</span>
                  <span className="s-d" style={{ display: 'block' }}>{s.text.slice(0, 18)}…</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        {sessions.length > 0 && (
          <div className="side-section" style={{ flex: '0 1 auto' }}>
            <div className="side-label">历史对话</div>
            <div className="slist">
              {sessions.map((s) => (
                <div
                  key={s.sid}
                  className={`sitem ${s.sid === sessionId ? 'active' : ''}`}
                  onClick={() => openHistory(s.sid, s.title)}
                >
                  <span className="s-title">{s.title}</span>
                  <span className="s-meta">
                    {new Date(s.ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · #{s.sid.slice(0, 6)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="side-foot">
          <div className="agent-status">
            <span className={`dot ${wsState === 'online' ? 'online' : wsState === 'connecting' ? 'connecting' : 'offline'}`} />
            <span>{wsState === 'online' ? '实时通道在线' : wsState === 'connecting' ? '连接中…' : '已断开，重连中'}</span>
          </div>
        </div>
      </aside>

      {/* 右侧：对话区 */}
      <main className={`stage ${isMobile ? 'stage-mobile' : ''}`}>
        <div className="stage-head">
          <div className="sh-left">
            <Avatar kind="agent" size={36} />
            <div>
              <div className="sh-title">在线客服 Agent</div>
              <div className="sh-sub">
                {sessionId ? `会话 #${sessionId.slice(0, 8)}` : '未开始对话'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {escalated && (
              <span className="badge warn">
                <ShieldCheck size={12} />
                已转人工{operatorName ? ` · ${operatorName}` : ''}{ticketId}
              </span>
            )}
            <button className="btn ghost sm" onClick={newChat} title="重新开始">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {memoryNote && <div className="memory-banner"><User size={13} /> {memoryNote}</div>}
        {error && <div className="hint err" style={{ margin: '10px 24px 0' }}>{error}</div>}
        {injectMsg && <InjectBanner text={injectMsg} onClose={() => setInjectMsg('')} />}

        <div className="stage-body" ref={bodyRef}>
          {!hasMessages && !loading && (
            <div className="welcome">
              <div className="welcome-logo">
                <MessageCircle size={36} />
              </div>
              <h2>您好，我是在线客服 Agent</h2>
              <p>
                支持订单查询、退款申请、政策咨询，可上传截图（多模态），
                还能记住您的偏好。选一个场景开始，或直接输入问题。
              </p>
              <div className="welcome-cards">
                {SCENES.map((s, i) => (
                  <button key={i} className="wc" onClick={() => send(s.text)}>
                    <span className="wc-ico" style={{ background: s.bg, color: s.color }}>
                      {s.icon}
                    </span>
                    <span>
                      <span className="wc-t">{s.title}</span>
                      <span className="wc-d" style={{ display: 'block' }}>{s.text}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MsgRow
              key={i}
              m={m}
              last={i === messages.length - 1}
              escalated={escalated}
              loading={loading}
              onFeedback={giveFeedback}
              feedback={feedback}
            />
          ))}

          {loading && (
            <div className="msg-row agent">
              <Avatar kind="agent" size={30} />
              <div className="bubble typing">
                <span className="t-dot" /> <span className="t-dot" /> <span className="t-dot" />
                <span className="t-label">Agent 正在处理…</span>
              </div>
            </div>
          )}

          {escalated && !operatorName && (
            <div className="escalate-bar">
              <Headset size={14} />
              已为您转接人工坐席，坐席在线后会实时出现在这里。
            </div>
          )}
        </div>

        <div className="stage-foot" ref={footRef} style={isMobile ? { position: 'sticky', bottom: 0 } : undefined}>
          <Composer
            value={input}
            onChange={onInputChange}
            onSend={() => send()}
            onPickImage={onPickImage}
            image={image}
            loading={loading}
          />
        </div>
      </main>
    </div>
  )
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
