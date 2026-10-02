import { lookup } from 'node:dns/promises'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import ipaddr from 'ipaddr.js'

export class UnsafeUrlError extends Error {}

export interface ResolvedAddress {
  address: string
  family: number
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>

export interface SafeResponse {
  status: number
  contentType: string
  body: Buffer
}

/** Só endereços unicast globais: bloqueia loopback, privados, link-local, CGNAT, reservados, multicast, 6to4/Teredo etc. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  let parsed = ipaddr.parse(address)
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address()
  }
  if (parsed.range() !== 'unicast') return false
  if (parsed.kind() === 'ipv6') {
    // Apenas 2000::/3 é espaço global atribuído; o resto do IPv6 é reservado.
    const [first] = (parsed as ipaddr.IPv6).parts
    return (first & 0xe000) === 0x2000
  }
  return true
}

const defaultResolver: HostResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

export async function resolvePublicAddress(
  hostname: string,
  resolve: HostResolver = defaultResolver,
): Promise<ResolvedAddress> {
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  const version = ipaddr.isValid(host) ? (host.includes(':') ? 6 : 4) : 0
  const addresses = version ? [{ address: host, family: version }] : await resolve(host)
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new UnsafeUrlError()
  }
  return addresses[0]
}

/** https, sem credenciais embutidas e em porta permitida (a padrão do esquema é 443). */
export function assertSafeHttpsUrl(url: URL, allowedPorts: readonly number[]): void {
  const port = url.port === '' ? 443 : Number(url.port)
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    !allowedPorts.includes(port)
  ) {
    throw new UnsafeUrlError()
  }
}

export type Transport = (
  url: URL,
  address: ResolvedAddress,
  options: { timeoutMs: number; maxBytes: number; accept: string },
) => Promise<SafeResponse>

export class ResponseTooLargeError extends Error {}

/** GET com IP fixado (contra DNS rebinding), sem seguir redirecionamentos e com limite de tamanho e tempo. */
export const httpsTransport: Transport = (url, address, { timeoutMs, maxBytes, accept }) =>
  new Promise((resolve, reject) => {
    const pinnedLookup = ((
      _hostname: string,
      options: { all?: boolean },
      callback: (
        error: NodeJS.ErrnoException | null,
        address: string | { address: string; family: number }[],
        family?: number,
      ) => void,
    ) => {
      if (options?.all) callback(null, [address])
      else callback(null, address.address, address.family)
    }) as LookupFunction

    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { accept },
        agent: false,
        lookup: pinnedLookup,
        timeout: timeoutMs,
        maxHeaderSize: 16 * 1024,
      },
      (res) => {
        const status = res.statusCode ?? 0
        const contentType = String(res.headers['content-type'] ?? '')
        if (status < 200 || status >= 300) {
          // Redirecionamentos (3xx) caem aqui: nunca são seguidos.
          res.destroy()
          resolve({ status, contentType, body: Buffer.alloc(0) })
          return
        }
        const declared = Number(res.headers['content-length'])
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy()
          reject(new ResponseTooLargeError())
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            res.destroy()
            reject(new ResponseTooLargeError())
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Timeout')))
    req.on('error', reject)
    req.end()
  })

export function createSafeGet({
  allowedPorts = [443],
  resolve,
  transport = httpsTransport,
}: {
  allowedPorts?: readonly number[]
  resolve?: HostResolver
  transport?: Transport
} = {}) {
  /** Valida a URL e o destino sem abrir conexão. */
  async function assertSafe(url: URL): Promise<ResolvedAddress> {
    assertSafeHttpsUrl(url, allowedPorts)
    return resolvePublicAddress(url.hostname, resolve)
  }

  async function get(
    url: URL,
    options: { timeoutMs: number; maxBytes: number; accept: string },
  ): Promise<SafeResponse> {
    const address = await assertSafe(url)
    return transport(url, address, options)
  }

  return { assertSafe, get }
}

export type SafeGet = ReturnType<typeof createSafeGet>
