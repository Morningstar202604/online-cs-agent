import { useEffect, useRef, useState } from 'react'

export interface WsMessage {
  type: string
  [k: string]: unknown
}

export function useWs(
  url: string | null,
  onMessage: (p: WsMessage) => void,
  enabled = true,
): { state: 'connecting' | 'online' | 'offline'; close: () => void } {
  const [state, setState] = useState<'connecting' | 'online' | 'offline'>(url ? 'connecting' : 'offline')
  const wsRef = useRef<WebSocket | null>(null)
  const closedRef = useRef(false)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMsgRef = useRef(onMessage)
  onMsgRef.current = onMessage

  useEffect(() => {
    if (!enabled || !url) return
    closedRef.current = false

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const host = window.location.host
      const socket = new WebSocket(`${proto}://${host}${url}`)
      wsRef.current = socket
      setState('connecting')
      socket.onopen = () => setState('online')
      socket.onclose = () => {
        setState('offline')
        if (!closedRef.current) retryRef.current = setTimeout(connect, 2500)
      }
      socket.onerror = () => socket.close()
      socket.onmessage = (e) => {
        try {
          onMsgRef.current(JSON.parse(e.data) as WsMessage)
        } catch {
          /* ignore malformed */
        }
      }
    }
    connect()
    return () => {
      closedRef.current = true
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [url, enabled])

  const close = () => {
    closedRef.current = true
    if (retryRef.current) clearTimeout(retryRef.current)
    wsRef.current?.close()
    setState('offline')
  }

  return { state, close }
}
