import { useEffect, useRef, useState } from 'react'
import { startAdminSession } from './sessionController'
import type { SessionState } from './sessionController'

export function useAdminSession() {
  const [state, setState] = useState<SessionState>('checking')
  const [ready, setReady] = useState(false)
  const retry = useRef<() => void>(() => {})

  useEffect(() => {
    const controller = startAdminSession((value) => {
      setState(value)
      if (value === 'ok') setReady(true)
    }, {
      isVisible: () => document.visibilityState === 'visible',
      onFocus: (listener) => {
        window.addEventListener('focus', listener)
        return () => window.removeEventListener('focus', listener)
      },
      onVisibility: (listener) => {
        document.addEventListener('visibilitychange', listener)
        return () => document.removeEventListener('visibilitychange', listener)
      },
      onActivity: (listener) => {
        const activity = (event: Event) => listener(event.isTrusted,
          event.target instanceof Element && !!event.target.closest('.admin'))
        document.addEventListener('pointerdown', activity)
        document.addEventListener('keydown', activity)
        return () => {
          document.removeEventListener('pointerdown', activity)
          document.removeEventListener('keydown', activity)
        }
      },
    })
    retry.current = controller.retry
    return controller.dispose
  }, [])

  return { state, ready, retry: () => retry.current() }
}
