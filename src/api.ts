import type { ApiError } from '../shared/types.ts'

export class ApiRequestError extends Error {
  status: number
  field?: string

  constructor(status: number, body: Partial<ApiError>) {
    super(body.error ?? `Erro ${status}`)
    this.status = status
    this.field = body.field
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const expiredListeners = new Set<() => void>()
const adminRequests = new Set<AbortController>()

export function onAdminSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener)
  return () => { expiredListeners.delete(listener) }
}

export function abortAdminRequests(): void {
  for (const controller of adminRequests) controller.abort()
  adminRequests.clear()
}

export async function api<T = void>(
  method: Method,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const protectedAdmin = url.startsWith('/api/admin/')
    && url !== '/api/admin/login' && url !== '/api/admin/logout'
  const controller = protectedAdmin ? new AbortController() : null
  if (controller) adminRequests.add(controller)
  const requestSignal = controller
    ? signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    : signal
  const init: RequestInit = { method, credentials: 'same-origin', signal: requestSignal }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  try {
    const res = await fetch(url, init)
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as Partial<ApiError>
      if (res.status === 401 && protectedAdmin) {
        for (const listener of expiredListeners) listener()
        abortAdminRequests()
      }
      throw new ApiRequestError(res.status, payload)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof ApiRequestError || (err as Error).name === 'AbortError') throw err
    throw new ApiRequestError(0, { error: 'Sem conexão com o servidor' })
  } finally {
    if (controller) adminRequests.delete(controller)
  }
}
