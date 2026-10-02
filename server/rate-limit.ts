import type { MiddlewareHandler } from 'hono'

/** Limite de requisições por chave numa janela fixa, em memória (uma instância do app). */
export function createRateLimiter({
  limit,
  windowMs = 60_000,
  now = Date.now,
}: {
  limit: number
  windowMs?: number
  now?: () => number
}) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return {
    /** Registra a requisição; devolve os segundos de espera quando acima do limite, ou 0. */
    hit(key: string): number {
      const t = now()
      let e = hits.get(key)
      if (!e || e.resetAt <= t) {
        e = { count: 0, resetAt: t + windowMs }
        hits.set(key, e)
        if (hits.size > 10_000) {
          for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k)
        }
      }
      e.count++
      return e.count > limit ? Math.max(1, Math.ceil((e.resetAt - t) / 1000)) : 0
    },
  }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>

export function rateLimit(
  limiter: RateLimiter,
  keyOf: (c: Parameters<MiddlewareHandler>[0]) => string,
): MiddlewareHandler {
  return async (c, next) => {
    const wait = limiter.hit(keyOf(c))
    if (wait > 0) {
      c.header('Retry-After', String(wait))
      return c.json({ error: 'Muitas requisições. Tente novamente em instantes.' }, 429)
    }
    await next()
  }
}
