import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import https from 'node:https'
import type { LookupFunction } from 'node:net'

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

function isPublicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const octets = address.split('.').map(Number)
    const [a, b] = octets
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && octets[2] === 99) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && octets[2] === 113) ||
      a >= 224
    )
  }
  if (version === 6) {
    const value = address.toLowerCase()
    return !(
      value === '::' ||
      value === '::1' ||
      value.startsWith('::ffff:') ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/.test(value) ||
      value.startsWith('ff') ||
      value.startsWith('2001:db8:') ||
      value.startsWith('2001:0:') ||
      value.startsWith('2002:') ||
      value.startsWith('64:ff9b:')
    )
  }
  return false
}

async function resolvePublicAddress(hostname: string) {
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  const version = isIP(host)
  const addresses = version
    ? [{ address: host, family: version }]
    : await lookup(host, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new UnsafeFoundryUrlError()
  }
  return addresses[0]
}

function validateUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UnsafeFoundryUrlError()
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port === '0'
  ) {
    throw new UnsafeFoundryUrlError()
  }
  return url
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
  return validateUrl(base.toString())
}

function requestJson(url: URL, address: { address: string; family: number }, timeoutMs: number, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = ((
      _hostname: string,
      options: { all?: boolean },
      callback: (error: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void,
    ) => {
      if (options?.all) callback(null, [address])
      else callback(null, address.address, address.family)
    }) as LookupFunction

    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        agent: false,
        lookup: pinnedLookup,
        timeout: timeoutMs,
        maxHeaderSize: 16 * 1024,
      },
      (res) => {
        const status = res.statusCode ?? 0
        const contentType = res.headers['content-type'] ?? ''
        if (status < 200 || status >= 300 || !contentType.toLowerCase().includes('json')) {
          res.destroy(new InvalidFoundryResponseError('Resposta Foundry inválida'))
          reject(new InvalidFoundryResponseError('Resposta Foundry inválida'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            res.destroy(new InvalidFoundryResponseError('Resposta Foundry excede o limite'))
            reject(new InvalidFoundryResponseError('Resposta Foundry excede o limite'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new InvalidFoundryResponseError('JSON Foundry inválido'))
          }
        })
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Timeout Foundry')))
    req.on('error', reject)
    req.end()
  })
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
} = {}) {
  const timeoutMs = options.timeoutMs ?? 4000
  const maxBytes = options.maxBytes ?? 32 * 1024
  const cacheTtlMs = options.cacheTtlMs ?? 60_000
  const now = options.now ?? Date.now
  const cache = new Map<string, { expiresAt: number; status: FoundryStatus }>()
  const pending = new Map<string, Promise<FoundryStatus>>()

  async function assertSafeUrl(value: string): Promise<void> {
    const url = statusUrlFromFoundry(value)
    try {
      await resolvePublicAddress(url.hostname)
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
        const address = await resolvePublicAddress(url.hostname)
        const body = await requestJson(url, address, timeoutMs, maxBytes)
        const status = mapStatus(body)
        cache.set(key, { status, expiresAt: now() + cacheTtlMs })
        while (cache.size > 500) cache.delete(cache.keys().next().value!)
        return status
      } catch (err) {
        const status = err instanceof UnsafeFoundryUrlError || err instanceof InvalidFoundryResponseError
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
