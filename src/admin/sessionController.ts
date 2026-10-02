import { abortAdminRequests, ApiRequestError, api, onAdminSessionExpired } from '../api.ts'

export type SessionState = 'checking' | 'ok' | 'expired' | 'unavailable'

export interface SessionEnvironment {
  isVisible(): boolean
  onFocus(listener: () => void): () => void
  onVisibility(listener: () => void): () => void
  onActivity(listener: (trusted: boolean, inAdmin: boolean) => void): () => void
}

export function startAdminSession(onState: (state: SessionState) => void, environment: SessionEnvironment) {
  let disposed = false
  let checking = false
  let allowed = false
  let expired = false
  let activityTimer: ReturnType<typeof setTimeout> | undefined
  let lastActivitySent = -Infinity
  const change = (value: SessionState) => {
    if (!disposed) {
      allowed = value === 'ok'
      onState(value)
    }
  }
  const unsubscribe = onAdminSessionExpired(() => {
    expired = true
    clearTimeout(activityTimer)
    change('expired')
  })

  async function check(block = false) {
    if (disposed || expired || !environment.isVisible()) return
    if (block) change('checking')
    if (checking) return
    checking = true
    try {
      await api('GET', '/api/admin/session')
      if (!disposed && !expired) {
        change('ok')
      }
    } catch (err) {
      if (!disposed && !expired && (err as Error).name !== 'AbortError') change('unavailable')
    } finally {
      checking = false
    }
  }

  async function sendActivity() {
    activityTimer = undefined
    if (!allowed || expired || disposed || !environment.isVisible()) return
    lastActivitySent = Date.now()
    try {
      await api('POST', '/api/admin/session/activity')
    } catch (err) {
      if (err instanceof ApiRequestError && err.status !== 401) change('unavailable')
    }
  }

  function activity(trusted: boolean, inAdmin: boolean) {
    if (!trusted || !inAdmin || !allowed || !environment.isVisible()) return
    if (activityTimer !== undefined) return
    const delay = Math.max(0, 30_000 - (Date.now() - lastActivitySent))
    if (delay === 0) void sendActivity()
    else activityTimer = setTimeout(() => { void sendActivity() }, delay)
  }

  function returned() { void check(true) }
  function visibility() {
    clearTimeout(activityTimer)
    activityTimer = undefined
    if (environment.isVisible()) returned()
  }
  void check(true)
  const interval = setInterval(() => { void check() }, 60_000)
  const unsubscribeFocus = environment.onFocus(returned)
  const unsubscribeVisibility = environment.onVisibility(visibility)
  const unsubscribeActivity = environment.onActivity(activity)
  return { retry: returned, dispose: () => {
    disposed = true
    unsubscribe()
    clearInterval(interval)
    clearTimeout(activityTimer)
    unsubscribeFocus()
    unsubscribeVisibility()
    unsubscribeActivity()
    abortAdminRequests()
  } }
}
