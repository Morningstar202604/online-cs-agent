import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { qk } from './queryClient'
import type {
  AgentConfig, KbEntry, AdminOverview, MemoryEntry,
  InjectionLogEntry, ToolDef, InjectionRule, AgentHealth,
} from '../types/api'

const http = {
  get: async <T>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>,
  post: async <T>(url: string, body?: unknown): Promise<T> => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'request failed')
    return r.json() as Promise<T>
  },
  put: async <T>(url: string, body?: unknown): Promise<T> => {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'request failed')
    return r.json() as Promise<T>
  },
  del: async <T>(url: string): Promise<T> => {
    const r = await fetch(url, { method: 'DELETE' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'request failed')
    return r.json() as Promise<T>
  },
}

// ---- config ----
export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: () => http.get<{ config: AgentConfig }>('/api/config') })
}
export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<AgentConfig>) => http.put<{ config: AgentConfig }>('/api/config', { config: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.config }),
  })
}

// ---- kb ----
export function useKb() {
  return useQuery({ queryKey: qk.kb, queryFn: () => http.get<{ kb: KbEntry[] }>('/api/kb') })
}
export function useKbMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.kb })
  return {
    create: useMutation({ mutationFn: (e: KbEntry) => http.post<{ kb: KbEntry[] }>('/api/kb', e), onSuccess: invalidate }),
    update: useMutation({ mutationFn: (e: KbEntry) => http.put<{ kb: KbEntry[] }>(`/api/kb/${e.id}`, e), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => http.del<{ kb: KbEntry[] }>(`/api/kb/${id}`), onSuccess: invalidate }),
  }
}

// ---- tools ----
export function useTools() {
  return useQuery({ queryKey: qk.tools, queryFn: () => http.get<{ tools: ToolDef[] }>('/api/tools') })
}
export function useToolMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.tools })
  return {
    create: useMutation({ mutationFn: (t: ToolDef) => http.post<{ tool: ToolDef }>('/api/tools', t), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...t }: ToolDef & { id: string }) => http.put<{ tool: ToolDef }>(`/api/tools/${id}`, t),
      onSuccess: invalidate,
    }),
    toggle: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
        http.put<{ tool: ToolDef }>(`/api/tools/${id}`, { id, name: '', desc: '', args_json: {}, enabled }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => http.del(`/api/tools/${id}`), onSuccess: invalidate }),
  }
}

// ---- injection rules ----
export function useInjectionRules() {
  return useQuery({ queryKey: qk.injectionRules, queryFn: () => http.get<{ rules: InjectionRule[] }>('/api/injection-rules') })
}
export function useInjectionRuleMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.injectionRules })
  return {
    create: useMutation({ mutationFn: (r: { expr: string; action: 'block' | 'log_only'; enabled: boolean }) => http.post<{ rule: InjectionRule }>('/api/injection-rules', r), onSuccess: invalidate }),
    update: useMutation({ mutationFn: (r: InjectionRule) => http.put<{ rule: InjectionRule }>(`/api/injection-rules/${r.id}`, r), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: number) => http.del(`/api/injection-rules/${id}`), onSuccess: invalidate }),
  }
}

// ---- admin ----
export function useAdminOverview() {
  return useQuery({ queryKey: qk.admin.overview, queryFn: () => http.get<AdminOverview>('/api/admin/overview') })
}
export function useAdminMemory() {
  return useQuery({ queryKey: qk.admin.memory, queryFn: () => http.get<{ entries: MemoryEntry[] }>('/api/admin/memory') })
}
export function useAdminInjection() {
  return useQuery({ queryKey: qk.admin.injection, queryFn: () => http.get<{ entries: InjectionLogEntry[] }>('/api/admin/injection-log') })
}

// ---- health ----
export function useAgentHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => http.get<AgentHealth>('/api/agent/health'),
    refetchInterval: 30_000,
  })
}

// ---- operator queues（refetchInterval 替代 15s 手写轮询）----
export function useOperatorQueues() {
  return useQuery({
    queryKey: ['operator', 'queues'],
    queryFn: () => http.get<{ sessions: []; tickets: [] }>('/api/operator/queues'),
    refetchInterval: 15_000,
  })
}

export { http }
