import { useEffect, useState } from 'react'
import {
  SlidersHorizontal, BookOpen, BarChart3, Brain, ShieldAlert,
  Save, Plus, Pencil, Trash2, X, Activity, Inbox, MessageSquare,
  FileText, Users, Search, Wrench, Zap, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  useConfig, useUpdateConfig, useKb, useKbMutations, useTools, useToolMutations,
  useInjectionRules, useInjectionRuleMutations,
  useAdminOverview, useAdminMemory, useAdminInjection,
} from './lib/queries'
import { StatCard, EmptyState } from './ui'
import { useShell } from './components/ResponsiveShell'
import { Spinner, ErrorBanner } from './components/Spinner'
import type { AgentConfig, KbEntry, ToolDef, InjectionRule, MemoryEntry, InjectionLogEntry } from './types/api'
import { usePagination } from './lib/pagination'
import './pages2.css'

const TABS = [
  { key: 'params', icon: <SlidersHorizontal size={15} />, label: '能力参数', sub: '模型 / 检索 / 上下文 / 记忆 / 引擎' },
  { key: 'tools', icon: <Wrench size={15} />, label: '工具注册表', sub: '可自定义 Agent 能执行的动作' },
  { key: 'guardrail', icon: <ShieldAlert size={15} />, label: '注入规则', sub: '护栏检测规则管理' },
  { key: 'kb', icon: <BookOpen size={15} />, label: '知识库', sub: 'RAG 语料增删改' },
  { key: 'data', icon: <BarChart3 size={15} />, label: '数据概览', sub: '运营统计' },
  { key: 'mem', icon: <Brain size={15} />, label: '长期记忆', sub: '跨会话沉淀' },
  { key: 'inj', icon: <Activity size={15} />, label: '注入日志', sub: '护栏审计' },
]

export default function Settings() {
  const [tab, setTab] = useState('params')
  const { mobile } = useShell()
  const { data: cfgRes, isLoading, error, refetch } = useConfig()
  const cfg = cfgRes?.config
  const upd = useUpdateConfig()

  if (isLoading) return <Spinner full label="加载配置…" />
  if (error) return <div className="p-8"><ErrorBanner message={(error as Error).message} onRetry={() => refetch()} /></div>
  if (!cfg) return <div className="p-8"><Spinner full /></div>

  const active = TABS.find((t) => t.key === tab)!

  return (
    <div className={`set-app ${mobile ? 'set-app-mobile' : ''}`}>
      <aside className="set-side">
        <div className="ss-title">管理中心</div>
        <div className="ss-sub">Agent 运行时配置 · 即时生效</div>
        {TABS.map((t) => (
          <button key={t.key} className={`set-item ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            <span className="si-ico">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </aside>

      <main className="set-main">
        <div className="set-main-head">
          <div>
            <h1>{active.label}</h1>
            <p>{active.sub}</p>
          </div>
          {tab === 'params' && (
            <button className="btn" onClick={() => upd.mutate(cfg)} disabled={upd.isPending}>
              <Save size={14} />
              {upd.isPending ? '保存中…' : upd.isSuccess ? '已保存' : '保存配置'}
            </button>
          )}
        </div>

        {tab === 'params' && <ParamsPanel cfg={cfg} upd={upd} />}
        {tab === 'tools' && <ToolsPanel />}
        {tab === 'guardrail' && <GuardrailPanel />}
        {tab === 'kb' && <KbPanel />}
        {tab === 'data' && <DataPanel />}
        {tab === 'mem' && <MemPanel />}
        {tab === 'inj' && <InjPanel />}
      </main>
    </div>
  )
}

/* ============ 参数配置（补齐 char_budget/react_steps/top_p + 引擎模式） ============ */
function ParamsPanel({ cfg, upd }: { cfg: AgentConfig; upd: ReturnType<typeof useUpdateConfig> }) {
  const set = (group: keyof AgentConfig, key: string, value: unknown) => {
    const next = structuredClone(cfg) as AgentConfig
    ;(next[group] as Record<string, unknown>)[key] = value
    upd.mutate(next)
  }

  const Grp = ({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) => {
    const [open, setOpen] = useState(true)
    return (
      <div className="grp">
        <div className="grp-head" onClick={() => setOpen((o) => !o)}>
          <h3>{title}</h3>
          {note && <span className="gh-note">{note}</span>}
          <span className="text-muted text-xs">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
        </div>
        {open && <div className="grp-body">{children}</div>}
      </div>
    )
  }
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="f-row">
      <span className="f-lb">{label}</span>
      {children}
    </div>
  )

  return (
    <div className="space-y-3">
      <Grp id="engine" title="引擎模式" note="rule / llm / auto">
        <div className="mod-row">
          {(['auto', 'rule', 'llm'] as const).map((m) => (
            <button
              key={m}
              className={`mod-toggle ${cfg.engine.mode === m ? 'on' : ''}`}
              onClick={() => set('engine', 'mode', m)}
            >
              <Zap size={12} />
              {m === 'auto' ? '自动（有Key走LLM）' : m === 'llm' ? '强制LLM' : '纯规则'}
            </button>
          ))}
        </div>
        <Row label="说明">
          <span className="text-xs text-muted">
            {cfg.engine.mode === 'llm' && '强制 LLM 模式，无 Key 时自动降级并标注 rule_fallback。'}
            {cfg.engine.mode === 'rule' && '纯规则 ReAct，不依赖 LLM。'}
            {cfg.engine.mode === 'auto' && '有 LLM Key 走 LLM，否则规则兜底。'}
          </span>
        </Row>
      </Grp>

      <Grp id="llm" title="模型 / LLM" note="API Key 由环境变量 USER_LLM_API_KEY 注入">
        <Row label="API Key 状态">
          <span className={`badge ${cfg.llm.has_key ? 'ok' : 'muted'}`}>
            {cfg.llm.has_key ? '已配置 · ' + cfg.llm.model : '未配置'}
          </span>
        </Row>
        <Row label="Base URL"><input type="text" value={cfg.llm.base_url} onChange={(e) => set('llm', 'base_url', e.target.value)} /></Row>
        <Row label="Model"><input type="text" value={cfg.llm.model} onChange={(e) => set('llm', 'model', e.target.value)} /></Row>
        <Row label={`Temperature · ${cfg.llm.temperature}`}>
          <input type="range" min="0" max="2" step="0.1" value={cfg.llm.temperature} onChange={(e) => set('llm', 'temperature', parseFloat(e.target.value))} />
        </Row>
        <Row label={`Top-p · ${cfg.llm.top_p}`}>
          <input type="range" min="0" max="1" step="0.05" value={cfg.llm.top_p} onChange={(e) => set('llm', 'top_p', parseFloat(e.target.value))} />
        </Row>
        <Row label={`Max tokens · ${cfg.llm.max_tokens}`}>
          <input type="range" min="128" max="4096" step="128" value={cfg.llm.max_tokens} onChange={(e) => set('llm', 'max_tokens', parseInt(e.target.value, 10))} />
        </Row>
      </Grp>

      <Grp id="retrieval" title="知识检索（RAG）">
        <Row label={`Top-K · ${cfg.retrieval.kb_top_k}`}>
          <input type="range" min="1" max="10" value={cfg.retrieval.kb_top_k} onChange={(e) => set('retrieval', 'kb_top_k', parseInt(e.target.value, 10))} />
        </Row>
        <Row label={`最低重叠 · ${cfg.retrieval.min_overlap}`}>
          <input type="range" min="0" max="0.3" step="0.01" value={cfg.retrieval.min_overlap} onChange={(e) => set('retrieval', 'min_overlap', parseFloat(e.target.value))} />
        </Row>
      </Grp>

      <Grp id="context" title="上下文工程" note="相关性筛选 + 摘要 + 字符预算 + 模块开关">
        <Row label={`历史轮数 · ${cfg.context.history_turns}`}>
          <input type="range" min="0" max="30" value={cfg.context.history_turns} onChange={(e) => set('context', 'history_turns', parseInt(e.target.value, 10))} />
        </Row>
        <Row label={`字符预算 · ${cfg.context.char_budget}`}>
          <input type="range" min="500" max="8000" step="100" value={cfg.context.char_budget} onChange={(e) => set('context', 'char_budget', parseInt(e.target.value, 10))} />
        </Row>
        <Row label={`压缩阈值 · ${cfg.context.compress_threshold}`}>
          <input type="range" min="2" max="20" value={cfg.context.compress_threshold} onChange={(e) => set('context', 'compress_threshold', parseInt(e.target.value, 10))} />
        </Row>
        <div className="f-row">
          <span className="f-lb">选项</span>
          <label className="f-row" style={{ padding: 0 }}>
            <input type="checkbox" checked={cfg.context.relevant_only} onChange={(e) => set('context', 'relevant_only', e.target.checked)} />
            <span className="text-xs">相关性筛选历史</span>
          </label>
          <label className="f-row" style={{ padding: 0 }}>
            <input type="checkbox" checked={cfg.context.summarize} onChange={(e) => set('context', 'summarize', e.target.checked)} />
            <span className="text-xs">长历史摘要</span>
          </label>
        </div>
        <Row label="人设"><textarea rows={2} value={cfg.context.persona} onChange={(e) => set('context', 'persona', e.target.value)} /></Row>
        <div className="mod-row">
          {Object.keys(cfg.context.modules).map((m) => (
            <label key={m} className={`mod-toggle ${cfg.context.modules[m] ? 'on' : ''}`}>
              <input type="checkbox" checked={!!cfg.context.modules[m]} onChange={(e) => set('context', 'modules', { ...cfg.context.modules, [m]: e.target.checked })} />
              {m}
            </label>
          ))}
        </div>
      </Grp>

      <Grp id="memory" title="长期记忆">
        <div className="f-row">
          <span className="f-lb">选项</span>
          <label className="f-row" style={{ padding: 0 }}>
            <input type="checkbox" checked={cfg.memory.enable} onChange={(e) => set('memory', 'enable', e.target.checked)} />
            <span className="text-xs">启用跨会话记忆</span>
          </label>
          <label className="f-row" style={{ padding: 0 }}>
            <input type="checkbox" checked={cfg.memory.auto_capture} onChange={(e) => set('memory', 'auto_capture', e.target.checked)} />
            <span className="text-xs">自动沉淀偏好</span>
          </label>
          <label className="f-row" style={{ padding: 0 }}>
            <input type="checkbox" checked={cfg.memory.visit_greeting} onChange={(e) => set('memory', 'visit_greeting', e.target.checked)} />
            <span className="text-xs">老访客问候</span>
          </label>
        </div>
        <Row label={`相关记忆条数 · ${cfg.memory.retrieval_top_k}`}>
          <input type="range" min="1" max="10" value={cfg.memory.retrieval_top_k} onChange={(e) => set('memory', 'retrieval_top_k', parseInt(e.target.value, 10))} />
        </Row>
        <Row label="偏好触发词"><input type="text" value={cfg.memory.capture_keywords.join(',')} onChange={(e) => set('memory', 'capture_keywords', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Row>
      </Grp>

      <Grp id="tools" title="工具 / 多模态 / 护栏 / 升级">
        {Object.keys(cfg.tools).map((t) => (
          <div key={t} className="f-row">
            <span className="f-lb">{t}</span>
            <input type="checkbox" checked={!!cfg.tools[t]} onChange={(e) => set('tools', t, e.target.checked)} />
          </div>
        ))}
        <div className="f-row">
          <span className="f-lb">多模态（图片）</span>
          <input type="checkbox" checked={cfg.multimodal.enable} onChange={(e) => set('multimodal', 'enable', e.target.checked)} />
        </div>
        <div className="f-row">
          <span className="f-lb">注入护栏</span>
          <input type="checkbox" checked={cfg.guardrail.injection_block} onChange={(e) => set('guardrail', 'injection_block', e.target.checked)} />
        </div>
        <Row label={`升级置信阈值 · ${cfg.escalation.confidence_threshold}`}>
          <input type="range" min="0.1" max="1" step="0.05" value={cfg.escalation.confidence_threshold} onChange={(e) => set('escalation', 'confidence_threshold', parseFloat(e.target.value))} />
        </Row>
        <Row label={`消息长度上限 · ${cfg.escalation.max_message_len}`}>
          <input type="range" min="200" max="5000" step="100" value={cfg.escalation.max_message_len} onChange={(e) => set('escalation', 'max_message_len', parseInt(e.target.value, 10))} />
        </Row>
        <Row label={`ReAct 步数 · ${cfg.escalation.react_steps}`}>
          <input type="range" min="1" max="8" value={cfg.escalation.react_steps} onChange={(e) => set('escalation', 'react_steps', parseInt(e.target.value, 10))} />
        </Row>
      </Grp>
    </div>
  )
}

/* ============ 工具注册表（可自定义内部功能） ============ */
function ToolsPanel() {
  const { data: toolsRes, isLoading, refetch } = useTools()
  const tm = useToolMutations()
  const [editing, setEditing] = useState<ToolDef | 'new' | null>(null)
  const [newArgs, setNewArgs] = useState('')

  if (isLoading) return <Spinner full label="加载工具注册表…" />
  const tools = toolsRes?.tools ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-muted">共 {tools.length} 个工具 · 增删改即时影响 Agent 行为</span>
        <button className="btn sm" onClick={() => setEditing('new')}><Plus size={14} /> 新增工具</button>
      </div>

      <div className="kb-grid">
        {tools.map((t) => (
          <div className={`kb-card ${!t.enabled ? 'opacity-55' : ''}`} key={t.id}>
            <div className="kc-head">
              <span className="kc-id">{t.id}</span>
              <span className="kc-title">{t.name}</span>
              <div className="kc-actions" style={{ opacity: 1 }}>
                <button className="btn ghost sm" title="编辑" onClick={() => setEditing(t)}><Pencil size={13} /></button>
                <button className="btn ghost sm" title={t.enabled ? '停用' : '启用'} style={{ color: t.enabled ? 'var(--muted)' : 'var(--ok)' }} onClick={() => tm.toggle.mutate({ id: t.id, enabled: !t.enabled })}>
                  <Activity size={13} /> {t.enabled ? '启用' : '停用'}
                </button>
                <button className="btn ghost sm" title="删除" style={{ color: 'var(--danger)' }} onClick={() => { if (confirm(`删除工具 ${t.id}？`)) tm.remove.mutate(t.id) }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div className="kc-tags">
              <em>{t.builtin ? '内置' : '自定义'}</em>
              <em>{JSON.stringify(t.args_json)}</em>
            </div>
            <p className="kc-answer">{t.desc || '（无描述）'}</p>
          </div>
        ))}
      </div>

      {editing && (
        <div className="drawer-mask" onClick={() => setEditing(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>{editing === 'new' ? '新增工具' : '编辑 ' + (editing as ToolDef).id}</h3>
              <button className="btn ghost sm" onClick={() => setEditing(null)}><X size={14} /></button>
            </div>
            <div className="drawer-body">
              <ToolForm
                key={editing === 'new' ? 'new' : (editing as ToolDef).id}
                initial={editing === 'new' ? null : (editing as ToolDef)}
                newArgs={newArgs}
                setNewArgs={setNewArgs}
                isNew={editing === 'new'}
                onDone={() => setEditing(null)}
              />
            </div>
          </div>
        </div>
      )}
      {tm.create.isError && <ErrorBanner message={(tm.create.error as Error).message} onRetry={() => refetch()} />}
    </div>
  )
}

function ToolForm({ initial, isNew, onDone, newArgs, setNewArgs }: {
  initial: ToolDef | null; isNew: boolean; onDone: () => void
  newArgs: string; setNewArgs: (s: string) => void
}) {
  const tm = useToolMutations()
  const [id, setId] = useState(initial?.id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [desc, setDesc] = useState(initial?.desc ?? '')
  const [argsText, setArgsText] = useState(isNew ? newArgs : JSON.stringify(initial?.args_json ?? {}, null, 2))

  const save = () => {
    let args: Record<string, string> = {}
    try {
      args = JSON.parse(argsText || '{}')
    } catch {
      alert('args_json 不是合法 JSON')
      return
    }
    if (!id.trim()) return
    const payload: ToolDef = { id: id.trim(), name: name || id.trim(), desc, args_json: args, enabled: initial?.enabled ?? true, builtin: initial?.builtin ?? false }
    const p = isNew ? tm.create.mutateAsync(payload) : tm.update.mutateAsync(payload)
    p.then(onDone).catch((e) => alert((e as Error).message))
  }

  return (
    <>
      <div className="d-field">
        <label>工具 ID（唯一）</label>
        <input value={id} disabled={!isNew} onChange={(e) => setId(e.target.value)} placeholder="如 kb_faq" />
      </div>
      <div className="d-field">
        <label>名称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="查常见问题" />
      </div>
      <div className="d-field">
        <label>描述（供 LLM 理解）</label>
        <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="按主题检索 FAQ 知识库" />
      </div>
      <div className="d-field">
        <label>参数 schema（JSON：参数名 → 类型）</label>
        <textarea rows={3} value={argsText} onChange={(e) => { setArgsText(e.target.value); setNewArgs(e.target.value) }} placeholder={'{"topic": "string"}'} />
      </div>
      <div className="drawer-foot">
        <button className="btn secondary" onClick={onDone}>取消</button>
        <button className="btn" onClick={save} disabled={!id.trim()}><Save size={14} /> 保存</button>
      </div>
    </>
  )
}

/* ============ 注入规则管理 ============ */
function GuardrailPanel() {
  const { data: rulesRes, isLoading, refetch } = useInjectionRules()
  const rm = useInjectionRuleMutations()
  const [expr, setExpr] = useState('')
  const [action, setAction] = useState<'block' | 'log_only'>('block')

  if (isLoading) return <Spinner full label="加载注入规则…" />
  const rules = rulesRes?.rules ?? []

  const add = () => {
    if (!expr.trim()) return
    rm.create.mutate({ expr: expr.trim(), action, enabled: true }, {
      onSuccess: () => setExpr(''),
      onError: (e) => alert((e as Error).message),
    })
  }

  return (
    <div>
      <div className="grp" style={{ marginBottom: 16 }}>
        <div className="grp-head"><h3>新增规则</h3></div>
        <div className="grp-body">
          <div className="f-row">
            <span className="f-lb">正则 / 关键词</span>
            <input type="text" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder='如 (pretend|假装)\s*你\s*是' style={{ flex: 2 }} />
          </div>
          <div className="f-row">
            <span className="f-lb">动作</span>
            <div className="flex gap-2">
              <button className={`mod-toggle ${action === 'block' ? 'on' : ''}`} onClick={() => setAction('block')}>拦截</button>
              <button className={`mod-toggle ${action === 'log_only' ? 'on' : ''}`} onClick={() => setAction('log_only')}>仅记录</button>
            </div>
          </div>
          <div className="f-row">
            <button className="btn sm" onClick={add} disabled={!expr.trim()}><Plus size={13} /> 添加规则</button>
            {rm.create.isError && <span className="text-xs text-[#c93034]">{(rm.create.error as Error).message}</span>}
          </div>
        </div>
      </div>

      <div className="tbl-wrap">
        <table className="dt">
          <thead><tr><th>#</th><th>表达式</th><th>动作</th><th>启用</th><th></th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td className="raw" title={r.expr}>{r.expr}</td>
                <td>
                  <button className={`badge ${r.action === 'block' ? 'danger' : 'warn'}`} onClick={() => rm.update.mutate({ ...r, action: r.action === 'block' ? 'log_only' : 'block' })}>
                    {r.action === 'block' ? '拦截' : '仅记录'}
                  </button>
                </td>
                <td>
                  <input type="checkbox" checked={r.enabled} onChange={(e) => rm.update.mutate({ ...r, enabled: e.target.checked })} />
                </td>
                <td>
                  <button className="btn ghost sm" onClick={() => rm.remove.mutate(r.id)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rm.create.isError || rm.update.isError ? <div className="mt-2"><ErrorBanner message={(rm.create.error || rm.update.error || new Error()).message} onRetry={() => refetch()} /></div> : null}
    </div>
  )
}

/* ============ 知识库管理 ============ */
function KbPanel() {
  const { data: kbRes, isLoading } = useKb()
  const km = useKbMutations()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<KbEntry | 'new' | null>(null)

  if (isLoading) return <Spinner full label="加载知识库…" />
  const all = kbRes?.kb ?? []
  const q = query.toLowerCase()
  const kb = all.filter((e) =>
    !q || e.id.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) ||
    e.text.toLowerCase().includes(q) || (e.tags || []).some((t) => t.toLowerCase().includes(q)),
  )

  return (
    <>
      <div className="kb-search">
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input style={{ paddingLeft: 40 }} placeholder="搜索 id / 标题 / 关键词…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn" onClick={() => setEditing('new')}><Plus size={14} /> 新增条目</button>
      </div>

      {kb.length === 0 && <EmptyState icon={<BookOpen size={22} />} title="没有匹配的知识库条目" desc="调整搜索词或新增一条" />}

      <div className="kb-grid">
        {kb.map((e) => (
          <div className="kb-card" key={e.id}>
            <div className="kc-head">
              <span className="kc-id">{e.id}</span>
              <span className="kc-title">{e.title}</span>
              <div className="kc-actions" style={{ opacity: 1 }}>
                <button className="btn ghost sm" onClick={() => setEditing(e)}><Pencil size={13} /></button>
                <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => { if (confirm(`删除 ${e.id}？`)) km.remove.mutate(e.id) }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div className="kc-tags">{(e.tags || []).map((t) => <em key={t}>{t}</em>)}</div>
            <p className="kc-text">{e.text}</p>
            <p className="kc-answer">{e.answer}</p>
          </div>
        ))}
      </div>

      {editing && (
        <div className="drawer-mask" onClick={() => setEditing(null)}>
          <div className="drawer" onClick={(ev) => ev.stopPropagation()}>
            <div className="drawer-head">
              <h3>{editing === 'new' ? '新增知识库条目' : '编辑 ' + (editing as KbEntry).id}</h3>
              <button className="btn ghost sm" onClick={() => setEditing(null)}><X size={14} /></button>
            </div>
            <div className="drawer-body">
              <KbForm key={editing === 'new' ? 'new' : (editing as KbEntry).id} initial={editing === 'new' ? null : (editing as KbEntry)} onDone={() => setEditing(null)} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function KbForm({ initial, onDone }: { initial: KbEntry | null; onDone: () => void }) {
  const km = useKbMutations()
  const [id, setId] = useState(initial?.id ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const [answer, setAnswer] = useState(initial?.answer ?? '')
  const [tags, setTags] = useState(initial?.tags.join(',') ?? '')
  const isNew = !initial

  const save = () => {
    const e: KbEntry = { id: id.trim(), title, text, answer, tags: tags.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0) }
    const p = isNew ? km.create.mutateAsync(e) : km.update.mutateAsync(e)
    p.then(onDone).catch((err) => alert((err as Error).message))
  }

  return (
    <>
      <div className="d-field"><label>条目 ID</label><input value={id} disabled={!isNew} onChange={(ev) => setId(ev.target.value)} placeholder="KB007" /></div>
      <div className="d-field"><label>标题</label><input value={title} onChange={(ev) => setTitle(ev.target.value)} /></div>
      <div className="d-field"><label>检索关键词（空格分隔）</label><input value={text} onChange={(ev) => setText(ev.target.value)} /></div>
      <div className="d-field"><label>答案</label><textarea rows={4} value={answer} onChange={(ev) => setAnswer(ev.target.value)} /></div>
      <div className="d-field"><label>标签（逗号分隔）</label><input value={tags} onChange={(ev) => setTags(ev.target.value)} /></div>
      <div className="drawer-foot">
        <button className="btn secondary" onClick={onDone}>取消</button>
        <button className="btn" onClick={save} disabled={!id.trim() || !title.trim()}><Save size={14} /> 保存</button>
      </div>
    </>
  )
}

/* ============ 数据概览 ============ */
function DataPanel() {
  const { data: ov, isLoading } = useAdminOverview()
  if (isLoading || !ov) return <Spinner full label="加载数据…" />
  return (
    <>
      <div className="stat-grid">
        <StatCard icon={<Inbox size={18} />} value={ov.sessions} label="会话" tone="brand" />
        <StatCard icon={<MessageSquare size={18} />} value={ov.messages} label="消息" tone="ok" />
        <StatCard icon={<FileText size={18} />} value={ov.tickets} label="工单" tone="warn" />
        <StatCard icon={<Users size={18} />} value={ov.pending} label="待接管" tone="danger" />
        <StatCard icon={<BookOpen size={18} />} value={ov.kb_count} label="知识库" tone="brand" />
        <StatCard icon={<ShieldAlert size={18} />} value={ov.injection} label="注入拦截" tone="danger" />
        <StatCard icon={<Activity size={18} />} value={ov.feedback.total} label={`反馈 · 好评率 ${(ov.feedback.help_rate * 100).toFixed(1)}%`} tone="ok" />
      </div>
    </>
  )
}

function Pager({ page, maxPage, total, onChange, label }: { page: number; maxPage: number; total: number; onChange: (p: number) => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
      <span>{label} 共 {total} 条，第 {page + 1} / {maxPage + 1} 页</span>
      <button className="btn ghost sm" disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft size={14} /></button>
      <button className="btn ghost sm" disabled={page >= maxPage} onClick={() => onChange(page + 1)}><ChevronRight size={14} /></button>
    </div>
  )
}

/* ============ 长期记忆 ============ */
function MemPanel() {
  const { data: memRes, isLoading } = useAdminMemory()
  if (isLoading) return <Spinner full label="加载记忆…" />
  const mem: MemoryEntry[] = memRes?.entries ?? []
  if (!mem.length) return <EmptyState icon={<Brain size={22} />} title="暂无长期记忆" desc="访客产生偏好或多次咨询后会自动沉淀在这里。" />
  const pg = usePagination(mem)
  return (
    <>
      <div className="tbl-wrap">
        <table className="dt">
          <thead><tr><th>访客</th><th>Key</th><th>Value</th><th>更新</th></tr></thead>
          <tbody>
            {pg.pageItems.map((m: MemoryEntry, i: number) => (
              <tr key={`${m.visitor_id}-${m.key}-${i}`}>
                <td>{m.visitor_id}</td>
                <td><span className="badge info">{m.key}</span></td>
                <td>{m.value}</td>
                <td className="muted">{m.updated_at?.slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pg.hasPages && <Pager page={pg.page} maxPage={pg.maxPage} total={pg.total} onChange={pg.setPage} label="长期记忆" />}
    </>
  )
}

/* ============ 注入日志 ============ */
function InjPanel() {
  const { data: injRes, isLoading } = useAdminInjection()
  if (isLoading) return <Spinner full label="加载注入日志…" />
  const inj: InjectionLogEntry[] = injRes?.entries ?? []
  if (!inj.length) return <EmptyState icon={<ShieldAlert size={22} />} title="暂无注入拦截记录" desc="护栏被触发后会出现在这里。" />
  const pg = usePagination(inj)
  return (
    <>
      <div className="tbl-wrap">
        <table className="dt">
          <thead><tr><th>#</th><th>访客</th><th>原始输入</th><th>命中</th><th>动作</th></tr></thead>
          <tbody>
            {pg.pageItems.map((m: InjectionLogEntry) => (
              <tr key={m.id}>
                <td>{m.id}</td>
                <td>{m.visitor_id}</td>
                <td className="raw" title={m.raw_input}>{m.raw_input}</td>
                <td><span className="badge danger">{m.detected}</span></td>
                <td>{m.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pg.hasPages && <Pager page={pg.page} maxPage={pg.maxPage} total={pg.total} onChange={pg.setPage} label="注入日志" />}
    </>
  )
}
