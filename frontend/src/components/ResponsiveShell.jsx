import React, { createContext, useContext, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { MessageCircle, Headset, Settings, Menu, X, Sparkles } from 'lucide-react'
import { useMediaQuery } from '../hooks/useMediaQuery'

export const NAV = [
  { to: '/', label: '对话', icon: <MessageCircle size={18} />, end: true },
  { to: '/operator', label: '坐席', icon: <Headset size={18} /> },
  { to: '/settings', label: '设置', icon: <Settings size={18} /> },
]

const Ctx = React.createContext({ drawerOpen: false, setDrawerOpen: () => {}, mobile: false })
export const useShell = () => useContext(Ctx)

export default function ResponsiveShell({ children }) {
  const mobile = useMediaQuery('(max-width: 639px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const loc = useLocation()

  // 切页自动关闭抽屉
  React.useEffect(() => setDrawerOpen(false), [loc.pathname])

  return (
    <Ctx.Provider value={{ drawerOpen, setDrawerOpen, mobile }}>
      <div className="min-h-screen flex flex-col bg-bg text-ink">
        {mobile ? (
          <>
            {/* 移动端顶栏：可呼出侧滑抽屉 */}
            <header className="h-14 flex items-center justify-between px-4 bg-panel/80 backdrop-blur border-b border-line-2 sticky top-0 z-40">
              <button
                className="w-10 h-10 grid place-items-center rounded-md text-ink-2 active:bg-panel-2"
                onClick={() => setDrawerOpen(true)}
                aria-label="打开菜单"
              >
                <Menu size={20} />
              </button>
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-brand-grad grid place-items-center text-white shadow-md">
                  <Sparkles size={14} />
                </span>
                <span className="font-bold text-sm">在线客服 Agent</span>
              </div>
              <div className="w-10" />
            </header>

            {/* 侧滑抽屉 */}
            {drawerOpen && (
              <div className="fixed inset-0 z-50">
                <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
                <div className="absolute left-0 top-0 h-full w-[280px] max-w-[82vw] bg-panel shadow-lg flex flex-col animate-[drawerIn_.22s_cubic-bezier(.2,.8,.2,1)]">
                  <div className="p-4 border-b border-line-2 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-brand-grad grid place-items-center text-white">
                      <Sparkles size={15} />
                    </span>
                    <div>
                      <div className="font-bold text-sm">在线客服 Agent</div>
                      <div className="text-[11px] text-muted">2026 Agent 客服</div>
                    </div>
                  </div>
                  <nav className="p-3 flex flex-col gap-1">
                    {NAV.map((n) => (
                      <DrawerNav key={n.to} item={n} onNav={() => setDrawerOpen(false)} />
                    ))}
                  </nav>
                </div>
              </div>
            )}

            <main className="flex-1 min-h-0">{children}</main>

            {/* 底部 Tab（固定） */}
            <nav className="shrink-0 sticky bottom-0 bg-panel border-t border-line-2 z-40 grid grid-cols-3 pb-[env(safe-area-inset-bottom)]">
              {NAV.map((n) => (
                <BottomTab key={n.to} item={n} />
              ))}
            </nav>
          </>
        ) : (
          <>
            <header className="h-14 flex items-center justify-between px-6 bg-panel/80 backdrop-blur border-b border-line-2 sticky top-0 z-40">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-brand-grad grid place-items-center text-white shadow-md">
                  <Sparkles size={15} />
                </span>
                <div>
                  <div className="font-bold text-sm leading-none">在线客服 Agent</div>
                  <div className="text-[10px] text-muted mt-0.5">2026 主流 Agent 能力</div>
                </div>
              </div>
              <nav className="flex gap-1">
                {NAV.map((n) => (
                  <DesktopNav key={n.to} item={n} />
                ))}
              </nav>
            </header>
            <main className="flex-1 min-h-0">{children}</main>
          </>
        )}
      </div>
    </Ctx.Provider>
  )
}

function DrawerNav({ item, onNav }) {
  const loc = useLocation()
  const active = item.end ? loc.pathname === item.to : loc.pathname.startsWith(item.to)
  return (
    <Link
      to={item.to}
      onClick={onNav}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition ${active ? 'bg-brand-soft text-brand font-semibold' : 'text-ink-2 hover:bg-panel-2'}`}
    >
      <span className={`w-8 h-8 grid place-items-center rounded-lg ${active ? 'bg-brand text-white' : 'bg-panel-2 text-muted'}`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  )
}

function BottomTab({ item }) {
  const loc = useLocation()
  const active = item.end ? loc.pathname === item.to : loc.pathname.startsWith(item.to)
  return (
    <Link
      to={item.to}
      className={`flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition ${active ? 'text-brand' : 'text-muted'}`}
    >
      <span className={`w-10 h-10 grid place-items-center rounded-full transition ${active ? 'bg-brand-soft text-brand' : 'text-ink-2'}`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  )
}

function DesktopNav({ item }) {
  const loc = useLocation()
  const active = item.end ? loc.pathname === item.to : loc.pathname.startsWith(item.to)
  return (
    <Link
      to={item.to}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${active ? 'bg-brand text-white shadow-md' : 'text-ink-2 hover:bg-line-2'}`}
    >
      {item.label}
    </Link>
  )
}
