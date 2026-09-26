import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

export const qk = {
  config: ['config'] as const,
  kb: ['kb'] as const,
  tools: ['tools'] as const,
  injectionRules: ['injection-rules'] as const,
  admin: {
    overview: ['admin', 'overview'] as const,
    memory: ['admin', 'memory'] as const,
    injection: ['admin', 'injection-log'] as const,
  },
  health: ['agent', 'health'] as const,
}
