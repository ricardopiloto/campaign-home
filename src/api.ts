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

export async function api<T = void>(
  method: Method,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', signal }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiRequestError(0, { error: 'Sem conexão com o servidor' })
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Partial<ApiError>
    throw new ApiRequestError(res.status, payload)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
