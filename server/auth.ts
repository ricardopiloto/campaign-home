import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const SESSION_COOKIE = 'gw_admin'
/** Sob HTTPS o prefixo __Host- impede que subdomínios sobrescrevam o cookie. */
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`
export const SESSION_TTL_SECONDS = 24 * 60 * 60

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Compara em tempo constante sem vazar o tamanho da senha. */
export function passwordMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected))
}

/** A chave depende também da senha: trocar ADMIN_PASSWORD invalida todos os tokens emitidos. */
export function deriveSessionKey(secret: string, adminPassword: string): Buffer {
  return createHmac('sha256', secret).update(sha256(adminPassword)).digest()
}

function sign(id: string, key: Buffer): string {
  return createHmac('sha256', key).update(id).digest('base64url')
}

/** Token de sessão: "<id>.<hmac>". A validade e a revogação ficam no banco. */
export function createSessionToken(id: string, key: Buffer): string {
  return `${id}.${sign(id, key)}`
}

/** Devolve o id da sessão se a assinatura confere; não consulta o banco. */
export function parseSessionToken(token: string | undefined, key: Buffer): string | null {
  if (!token) return null
  const [id, mac, ...rest] = token.split('.')
  if (!id || !mac || rest.length > 0) return null
  const expected = Buffer.from(sign(id, key))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return id
}

export function createSessionStore(db: DatabaseSync, now: () => number = Date.now) {
  const insert = db.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)')
  const select = db.prepare('SELECT expires_at, revoked_at FROM sessions WHERE id = ?')
  const revokeStmt = db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
  const purgeStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL')

  return {
    create(): string {
      const id = randomBytes(18).toString('base64url')
      insert.run(id, now() + SESSION_TTL_SECONDS * 1000)
      return id
    },
    isValid(id: string): boolean {
      const row = select.get(id) as { expires_at: number; revoked_at: number | null } | undefined
      return row !== undefined && row.revoked_at === null && row.expires_at > now()
    },
    revoke(id: string): void {
      revokeStmt.run(now(), id)
    },
    /** Remove sessões expiradas ou revogadas. */
    purge(): void {
      purgeStmt.run(now())
    },
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>

/**
 * Limite de falhas de login por chave (IP) numa janela, com atraso progressivo entre
 * tentativas (a partir da 3ª falha) e um limite global contra ataques distribuídos.
 */
export function createLoginLimiter({
  maxFailures = 5,
  globalMaxFailures = 50,
  windowMs = 15 * 60 * 1000,
  baseDelayMs = 1000,
  now = Date.now,
}: {
  maxFailures?: number
  globalMaxFailures?: number
  windowMs?: number
  baseDelayMs?: number
  now?: () => number
} = {}) {
  const failures = new Map<string, { count: number; resetAt: number; lastAt: number }>()
  let global = { count: 0, resetAt: 0 }

  function entry(key: string) {
    const current = failures.get(key)
    if (current && current.resetAt > now()) return current
    failures.delete(key)
    return null
  }

  return {
    /** Segundos até a próxima tentativa ser aceita; 0 quando liberado. */
    retryAfter(key: string): number {
      const t = now()
      let waitMs = 0
      if (global.resetAt > t && global.count >= globalMaxFailures) waitMs = global.resetAt - t
      const e = entry(key)
      if (e) {
        if (e.count >= maxFailures) waitMs = Math.max(waitMs, e.resetAt - t)
        else if (e.count >= 3 && baseDelayMs > 0) {
          const delay = Math.min(baseDelayMs * 2 ** (e.count - 3), 60_000)
          waitMs = Math.max(waitMs, e.lastAt + delay - t)
        }
      }
      return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0
    },
    isBlocked(key: string): boolean {
      return this.retryAfter(key) > 0
    },
    recordFailure(key: string): void {
      const t = now()
      const e = entry(key)
      if (e) {
        e.count++
        e.lastAt = t
      } else failures.set(key, { count: 1, resetAt: t + windowMs, lastAt: t })
      if (global.resetAt > t) global.count++
      else global = { count: 1, resetAt: t + windowMs }
      if (failures.size > 10_000) {
        for (const [k, v] of failures) if (v.resetAt <= t) failures.delete(k)
      }
    },
    reset(key: string): void {
      failures.delete(key)
    },
  }
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>
