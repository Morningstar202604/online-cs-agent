import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AppStore {
  sessionId: string | null
  visitorId: string | null
  opId: string | null
  // 草稿（移动端切页不丢输入）
  draft: Record<string, string>
  setSession: (id: string | null) => void
  setVisitorId: (id: string | null) => void
  setOpId: (id: string | null) => void
  setDraft: (page: string, value: string) => void
  resetDraft: (page: string) => void
}

const rand = () => Math.random().toString(36).slice(2, 10)

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      sessionId: null,
      visitorId: null,
      opId: null,
      draft: {},
      setSession: (id) => set({ sessionId: id }),
      setVisitorId: (id) => set({ visitorId: id }),
      setOpId: (id) => set({ opId: id }),
      setDraft: (page, value) => set((s) => ({ draft: { ...s.draft, [page]: value } })),
      resetDraft: (page) => set((s) => ({ draft: { ...s.draft, [page]: '' } })),
    }),
    { name: 'cs-agent-app', partialize: (s) => ({ visitorId: s.visitorId, opId: s.opId, draft: s.draft }) },
  ),
)

export function ensureVisitorId() {
  let v = useAppStore.getState().visitorId
  if (!v) {
    v = 'v-' + rand()
    useAppStore.getState().setVisitorId(v)
  }
  return v
}

export function ensureOpId() {
  let v = useAppStore.getState().opId
  if (!v) {
    v = 'op-' + rand()
    useAppStore.getState().setOpId(v)
  }
  return v
}
