import { useRef, useEffect, useState } from 'react'
import { Inbox, ClipboardList, Radio, X, Headset, Ticket, User, RefreshCw } from 'lucide-react'
import { http, useOperatorQueues } from './lib/queries'
import { useWs } from './hooks/useWs'
import { useAppStore, ensureOpId } from './store/appStore'
import { useShell } from './components/ResponsiveShell'
import { Avatar, MsgMeta } from './ui'
import { Spinner, ErrorBanner } from './components/Spinner'
import './pages2.css'

function normRole(r) {
  return r === 'agent' ? 'agent' : r === 'operator' ? 'operator' : r === 'system' ? 'system' : 'visitor'
}

function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function OperatorDesk() {
  const [tab, setTab] = useState('sessions')
  const [active, setActive] = useState(null)
  const [dialog, setDialog] = useState([])
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const opId = useAppStore((s) => s.opId)
  const setDraft = useAppStore((s) => s.setDraft)
  const { mobile } = useShell()
  const bodyRef = useRef(null)

  const queues = useOperatorQueues()

  // 坐席回复草稿走 zustand（切页不丢）
  const onReplyChange = (v) => {
    setReply(v)
    setDraft('operator-reply', v)
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

  // WS 实时接收新会话 / 状态变更（useWs 自动重连）
  const { state: connState } = useWs('/ws/operator', (p) => {
    if (p.type === 'new_pending' || p.type === 'session_updated') queues.refetch()
  })

  useEffect(() => { ensureOpId() }, [])
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [dialog, active])

  const openDialog = async (sid) => {
    setActive(sid)
    try {
      const d = await http.get(`/api/sessions/${sid}/messages`)
      setDialog((d.messages || []).map((m) => ({ ...m, role: normRole(m.role) })))
    } catch {
      setDialog([])
    }
  }

  const take = async (sid) => {
    setError('')
    try {
      await http.post(`/api/operator/take/${sid}`, { visitor_id: opId })
      await queues.refetch()
      openDialog(sid)
    } catch (e) {
      setError(e.message)
    }
  }

  const doReply = async () => {
    const c = reply.trim()
    if (!c || !active) return
    onReplyChange('')
    setDialog((prev) => [...prev, { role: 'operator', content: c, ts: new Date().toISOString() }])
    try {
      await http.post(`/api/operator/reply/${active}`, { content: c })
    } catch (e) {
      setError(e.message)
    }
  }

  const closeSess = async (sid) => {
    setError('')
    try {
      await http.post(`/api/operator/close/${sid}`)
      setActive(null)
      setDialog([])
      await queues.refetch()
    } catch (e) {
      setError(e.message)
    }
  }

  const items = tab === 'sessions' ? queues.data?.sessions : queues.data?.tickets
  const isMobile = mobile

  // 移动端：堆叠 —— 先队列，再对话（active 时对话上移）
  return (
    <div className={`op-app ${isMobile ? 'op-app-mobile' : ''}`}>
      <section className={`op-pane ${isMobile ? '' : 'op-left'}`}>
        <div className={`op-left-head ${isMobile ? 'op-left-head-mobile' : ''}`}>
          <div className="op-conn">
            <Radio size={14} />
            <span>
              {connState === 'online' ? '实时通道在线' : connState === 'connecting' ? '连接中…' : '已断开，重连中'}
            </span>
            <span className={`dot ${connState === 'online' ? 'online' : connState === 'connecting' ? 'connecting' : 'offline'}`} style={{ marginLeft: 'auto' }} />
          </div>
          <div className="op-tabs">
            <button className={`op-tab ${tab === 'sessions' ? 'on' : ''}`} onClick={() => setTab('sessions')}>
              <Inbox size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              待接管（{queues.data?.sessions.length ?? 0}）
            </button>
            <button className={`op-tab ${tab === 'tickets' ? 'on' : ''}`} onClick={() => setTab('tickets')}>
              <ClipboardList size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              工单（{queues.data?.tickets.length ?? 0}）
            </button>
          </div>
          <div className="op-opid">
            <Headset size={12} style={{ verticalAlign: '-1px' }} /> 坐席 {opId || '…'}
          </div>
        </div>

        <div className={`op-list ${isMobile ? 'op-list-mobile' : ''}`}>
          {queues.isLoading && <Spinner label="加载队列…" />}
          {queues.isError && <ErrorBanner message={queues.error?.message} onRetry={() => queues.refetch()} />}
          {items && items.length === 0 && !queues.isLoading && (
            <div className="empty">{tab === 'sessions' ? '暂无待接管会话' : '暂无工单'}</div>
          )}
          {tab === 'sessions' && (queues.data?.sessions ?? []).map((s) => (
            <div key={s.id} className={`op-card ${active === s.id ? 'active' : ''}`} onClick={() => openDialog(s.id)}>
              <div className="op-card-title">
                <span><User size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} /> 会话 #{String(s.id).slice(0, 8)}</span>
                <span className="badge warn">待接管</span>
              </div>
              <div className="op-card-meta">原因：{s.escalate_reason || '-'}</div>
              <div className="op-actions">
                <button className="btn sm" onClick={(e) => { e.stopPropagation(); take(s.id) }}>接管并对话</button>
              </div>
            </div>
          ))}
          {tab === 'tickets' && (queues.data?.tickets ?? []).map((t) => (
            <div key={t.id} className={`op-card ${active === t.session_id ? 'active' : ''}`} onClick={() => openDialog(t.session_id)}>
              <div className="op-card-title">
                <span><Ticket size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} /> {t.id} · #{String(t.session_id).slice(0, 8)}</span>
                <span className="badge muted">{t.priority}</span>
              </div>
              <div className="op-card-meta">{t.status} · {new Date(t.created_at).toLocaleDateString('zh-CN')}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={`op-pane ${isMobile ? '' : 'op-right'}`}>
        <div className="op-right-head">
          <h3>{active ? `会话 #${active.slice(0, 8)}` : '选择一个会话开始服务'}</h3>
          {active && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost sm" onClick={() => openDialog(active)}><RefreshCw size={13} /> 刷新</button>
              <button className="btn secondary sm" onClick={() => closeSess(active)}><X size={13} /> 关闭</button>
            </div>
          )}
        </div>

        {error && <div className="hint err" style={{ margin: '10px 20px 0' }}>{error}</div>}

        <div className={`op-dialog ${isMobile ? 'op-dialog-mobile' : ''}`} ref={bodyRef}>
          {!active && <div className="empty" style={{ margin: 'auto' }}>从队列接管一个会话后，这里会实时展示对话。</div>}
          {dialog.map((m, i) =>
            m.role === 'system' ? (
              <div key={i} className="msg-row system"><div className="system-line">{m.content}</div></div>
            ) : (
              <div key={i} className={`msg-row ${m.role}`}>
                <Avatar kind={m.role === 'visitor' ? 'visitor' : m.role === 'operator' ? 'operator' : 'agent'} size={30} />
                <div className="msg-body">
                  <div className="bubble">{m.content}</div>
                  <MsgMeta msg={m} />
                  {m.ts && <span className="msg-time">{formatTime(m.ts)}</span>}
                </div>
              </div>
            ),
          )}
        </div>

        {active && (
          <div ref={footRef} className={`op-foot ${isMobile ? 'op-foot-mobile' : ''}`} style={isMobile ? { position: 'sticky', bottom: 0 } : undefined}>
            <textarea
              rows={1}
              value={reply}
              placeholder="以坐席身份回复…"
              onChange={(e) => onReplyChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doReply() } }}
            />
            <button className="btn" onClick={doReply} disabled={!reply.trim()}>回复</button>
          </div>
        )}
      </section>
    </div>
  )
}
