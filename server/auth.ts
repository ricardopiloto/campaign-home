import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'gw_admin'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Compara em tempo constante sem vazar o tamanho da senha. */
export function passwordMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected))
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Token de sessão sem estado: "<expiraEmSegundos>.<hmac>". */
export function createSessionToken(secret: string, nowMs = Date.now()): string {
  const exp = String(Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS)
  return `${exp}.${sign(exp, secret)}`
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!token) return false
  const [exp, mac, ...rest] = token.split('.')
  if (!exp || !mac || rest.length > 0 || !/^\d+$/.test(exp)) return false
  const expected = Buffer.from(sign(exp, secret))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  return Number(exp) * 1000 > nowMs
}

/** Limite de falhas de login por chave (IP) numa janela deslizante simples. */
export function createLoginLimiter({
  maxFailures = 5,
  windowMs = 15 * 60 * 1000,
  now = Date.now,
}: { maxFailures?: number; windowMs?: number; now?: () => number } = {}) {
  const failures = new Map<string, { count: number; resetAt: number }>()

  function entry(key: string) {
    const current = failures.get(key)
    if (current && current.resetAt > now()) return current
    failures.delete(key)
    return null
  }

  return {
    isBlocked(key: string): boolean {
      const e = entry(key)
      return e !== null && e.count >= maxFailures
    },
    recordFailure(key: string): void {
      const e = entry(key)
      if (e) e.count++
      else failures.set(key, { count: 1, resetAt: now() + windowMs })
      if (failures.size > 10_000) {
        for (const [k, v] of failures) if (v.resetAt <= now()) failures.delete(k)
      }
    },
    reset(key: string): void {
      failures.delete(key)
    },
  }
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>
