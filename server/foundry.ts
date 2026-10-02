import { ResponseTooLargeError, UnsafeUrlError, createSafeGet } from './net-safety.ts'
import type { SafeGet } from './net-safety.ts'

export interface FoundryStatus {
  serverAvailable: boolean | null
  tableActive: boolean | null
  world: string | null
  system: string | null
}

export class UnsafeFoundryUrlError extends Error {
  constructor() {
    super('O destino da API de status do Foundry não é permitido')
  }
}

class InvalidFoundryResponseError extends Error {}

const UNKNOWN: FoundryStatus = {
  serverAvailable: null,
  tableActive: null,
  world: null,
  system: null,
}

function statusUrlFromFoundry(value: string): URL {
  let base: URL
  try {
    base = new URL(value)
  } catch {
    throw new UnsafeFoundryUrlError()
  }
  if (base.protocol !== 'https:' || !base.hostname || base.username || base.password) {
    throw new UnsafeFoundryUrlError()
  }
  const basePath = base.pathname.replace(/\/+$/, '')
  base.pathname = `${basePath}/api/status`
  base.search = ''
  base.hash = ''
  return base
}

async function requestJson(
  safeGet: SafeGet,
  url: URL,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  let res
  try {
    res = await safeGet.get(url, { timeoutMs, maxBytes, accept: 'application/json' })
  } catch (err) {
    if (err instanceof ResponseTooLargeError) {
      throw new InvalidFoundryResponseError('Resposta Foundry excede o limite')
    }
    throw err
  }
  if (res.status < 200 || res.status >= 300 || !res.contentType.toLowerCase().includes('json')) {
    throw new InvalidFoundryResponseError('Resposta Foundry inválida')
  }
  try {
    return JSON.parse(res.body.toString('utf8'))
  } catch {
    throw new InvalidFoundryResponseError('JSON Foundry inválido')
  }
}

function mapStatus(value: unknown): FoundryStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidFoundryResponseError('Formato Foundry inválido')
  }
  const body = value as Record<string, unknown>
  const world = typeof body.world === 'string' && body.world.trim() ? body.world.trim() : null
  const tableActive = typeof body.active === 'boolean' ? body.active : Boolean(world)
  const system = tableActive && typeof body.system === 'string' && body.system.trim()
    ? body.system.trim()
    : null
  return { serverAvailable: true, tableActive, world: tableActive ? world : null, system }
}

export function createFoundryStatusClient(options: {
  timeoutMs?: number
  maxBytes?: number
  cacheTtlMs?: number
  now?: () => number
  safeGet?: SafeGet
} = {}) {
  const timeoutMs = options.timeoutMs ?? 4000
  const maxBytes = options.maxBytes ?? 32 * 1024
  const cacheTtlMs = options.cacheTtlMs ?? 60_000
  const now = options.now ?? Date.now
  const safeGet = options.safeGet ?? createSafeGet()
  const cache = new Map<string, { expiresAt: number; status: FoundryStatus }>()
  const pending = new Map<string, Promise<FoundryStatus>>()

  async function assertSafeUrl(value: string): Promise<void> {
    const url = statusUrlFromFoundry(value)
    try {
      await safeGet.assertSafe(url)
    } catch {
      throw new UnsafeFoundryUrlError()
    }
  }

  async function get(value: string | null): Promise<FoundryStatus | null> {
    if (!value) return null
    let url: URL
    try {
      url = statusUrlFromFoundry(value)
    } catch {
      return { ...UNKNOWN, serverAvailable: false, tableActive: false }
    }
    const key = url.toString()
    const hit = cache.get(key)
    if (hit && hit.expiresAt > now()) return hit.status
    const active = pending.get(key)
    if (active) return active

    const work = (async () => {
      try {
        const body = await requestJson(safeGet, url, timeoutMs, maxBytes)
        const status = mapStatus(body)
        cache.set(key, { status, expiresAt: now() + cacheTtlMs })
        while (cache.size > 500) cache.delete(cache.keys().next().value!)
        return status
      } catch (err) {
        const status = err instanceof UnsafeFoundryUrlError ||
          err instanceof UnsafeUrlError ||
          err instanceof InvalidFoundryResponseError
          ? UNKNOWN
          : { ...UNKNOWN, serverAvailable: false, tableActive: false }
        cache.set(key, { status, expiresAt: now() + cacheTtlMs })
        return status
      } finally {
        pending.delete(key)
      }
    })()
    pending.set(key, work)
    return work
  }

  return { assertSafeUrl, get }
}
