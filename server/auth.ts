import { createHash, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'gw_admin'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Compara em tempo constante sem vazar o tamanho da senha. */
export function passwordMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected))
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
