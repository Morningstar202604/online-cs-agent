import React from 'react'
import {
  Sparkles,
  Paperclip,
  ImagePlus,
  Send,
  ThumbsUp,
  ThumbsDown,
  ShieldCheck,
  UserRound,
  CircleCheck,
  X,
  RefreshCw,
} from 'lucide-react'

export function Avatar({ kind = 'agent', size = 34 }) {
  const map = {
    agent: { icon: <Sparkles size={size * 0.5} />, bg: 'var(--brand-grad)', color: '#fff', label: 'Agent' },
    visitor: { icon: <UserRound size={size * 0.5} />, bg: 'var(--visitor-soft)', color: 'var(--brand)', label: '访客' },
    operator: { icon: <CircleCheck size={size * 0.5} />, bg: 'var(--operator-soft)', color: '#c2358f', label: '坐席' },
  }
  const m = map[kind] || map.agent
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: m.bg,
        color: m.color,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        boxShadow: kind === 'agent' ? '0 4px 10px rgba(43,92,255,0.25)' : 'none',
      }}
      title={m.label}
    >
      {m.icon}
    </span>
  )
}

const TOOL_LABEL = {
  query_order: '查订单',
  initiate_refund: '退款申请',
  lookup_policy: '查政策',
  vision: '图片识别',
  injection_guard: '安全护栏',
}
export function toolLabel(name) {
  return TOOL_LABEL[name] || name
}

export function MsgMeta({ msg }) {
  if (!msg) return null
  const chips = []
  if (msg.refs && msg.refs.length) chips.push(`依据 ${msg.refs.join(' / ')}`)
  if (msg.tool_used && msg.tool_used !== 'injection_guard') chips.push(`工具：${toolLabel(msg.tool_used)}`)
  if (msg.ctx_used) {
    const c = msg.ctx_used
    if (c.kb && c.kb.hits && c.kb.hits.length) chips.push(`KB×${c.kb.hits.length}`)
    if (c.memory && c.memory.hits && c.memory.hits.length) chips.push(`记忆×${c.memory.hits.length}`)
    if (c.history && c.history.summarized) chips.push('历史摘要')
    if (c.history && c.history.relevant_only) chips.push('相关性筛选')
  }
  if (!chips.length) return null
  return (
    <span className="msg-meta">
      {chips.map((c, i) => (
        <em key={i}>{c}</em>
      ))}
    </span>
  )
}

export function FeedbackRow({ onFeedback, feedback, show }) {
  if (!show) return null
  return (
    <div className="feedback-row">
      <span className="feedback-label">这条回答有用吗？</span>
      <button className={`fb-btn ${feedback === 'helpful' ? 'on' : ''}`} onClick={() => onFeedback('helpful')}>
        <ThumbsUp size={13} />
        {feedback === 'helpful' ? '已标记有用' : '有用'}
      </button>
      <button className={`fb-btn ${feedback === 'not_helpful' ? 'on' : ''}`} onClick={() => onFeedback('not_helpful')}>
        <ThumbsDown size={13} />
        {feedback === 'not_helpful' ? '已转人工' : '没用'}
      </button>
    </div>
  )
}

export function InjectBanner({ text, onClose }) {
  if (!text) return null
  return (
    <div className="inject-banner">
      <ShieldCheck size={15} />
      <span>{text}</span>
      {onClose && (
        <button className="inject-close" onClick={onClose}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}

export function QuickChips({ items, onPick, disabled }) {
  if (!items.length) return null
  return (
    <div className="quick-row">
      {items.map((q, i) => (
        <button key={i} className="quick" onClick={() => onPick(q)} disabled={disabled}>
          <Sparkles size={12} />
          {q.text || q}
        </button>
      ))}
    </div>
  )
}

export function Composer({
  value,
  onChange,
  onSend,
  onPickImage,
  image,
  loading,
  maxLength = 1000,
  placeholder = '输入您的问题…',
  disabled,
  imageTip = '上传图片（多模态）',
}) {
  const ref = React.useRef(null)
  return (
    <div className="composer">
      <div className="composer-top">
        <label className="icon-btn" title={imageTip}>
          <ImagePlus size={16} />
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
        </label>
        {image && (
          <div className="composer-img">
            <img src={image} alt="预览" />
            <button title="移除图片" onClick={(e) => (e.target.closest('label,div') ? onPickImage && null : null)} style={{ pointerEvents: 'none' }}>
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="composer-bar">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={1}
          disabled={disabled}
        />
        <span className="composer-count">
          {value.length}/{maxLength}
        </span>
        <button className="send-btn" onClick={() => onSend()} disabled={loading || !value.trim() || disabled}>
          <Send size={15} />
          <span>发送</span>
        </button>
      </div>
    </div>
  )
}

export function PageHead({ title, sub, right }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {right && <div className="page-head-right">{right}</div>}
    </div>
  )
}

export function StatCard({ icon, value, label, tone = 'brand' }) {
  const tones = {
    brand: { bg: 'var(--brand-soft)', color: 'var(--brand)' },
    ok: { bg: 'var(--ok-soft)', color: '#1a8f52' },
    warn: { bg: 'var(--warn-soft)', color: '#b5731b' },
    danger: { bg: 'var(--danger-soft)', color: '#c93034' },
    muted: { bg: 'var(--system-soft)', color: 'var(--ink-2)' },
  }
  const t = tones[tone] || tones.brand
  return (
    <div className="stat">
      <div className="stat-icon" style={{ background: t.bg, color: t.color }}>
        {icon}
      </div>
      <div className="stat-val">{value}</div>
      <div className="stat-lb">{label}</div>
    </div>
  )
}

export function EmptyState({ icon, title, desc, action = null }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      {title && <div className="empty-title">{title}</div>}
      {desc && <div className="empty-desc">{desc}</div>}
      {action}
    </div>
  )
}
