import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { SESSION_TTL_SECONDS } from './auth.ts'

export function createSessionStore(
  db: DatabaseSync,
  { idleTimeoutSeconds = 1800, now = Date.now }: {
    idleTimeoutSeconds?: number
    now?: () => number
  } = {},
) {
  const idleMs = idleTimeoutSeconds * 1000
  const hash = (token: string) => createHash('sha256').update(token).digest('hex')
  const validToken = (token: string | undefined): token is string =>
    !!token && /^[A-Za-z0-9_-]{43}$/.test(token)
  const clean = db.prepare('DELETE FROM admin_sessions WHERE absolute_expiry <= ? OR last_activity <= ?')
  const insert = db.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?, ?)')
  const lookup = db.prepare(`SELECT token_hash FROM admin_sessions
    WHERE token_hash = ? AND absolute_expiry > ? AND last_activity > ?`)
  // A condição e a atualização ocorrem numa única instrução: sessões vencidas nunca revivem.
  const touch = db.prepare(`UPDATE admin_sessions SET last_activity = MAX(last_activity, ?)
    WHERE token_hash = ? AND absolute_expiry > ? AND last_activity > ?`)
  const remove = db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')

  return {
    create(): string {
      const time = now()
      clean.run(time, time - idleMs)
      const token = randomBytes(32).toString('base64url')
      insert.run(hash(token), time, time, time + SESSION_TTL_SECONDS * 1000)
      return token
    },
    validate(token: string | undefined, renew = false): boolean {
      if (!validToken(token)) return false
      const time = now()
      const digest = hash(token)
      const valid = renew
        ? touch.run(time, digest, time, time - idleMs).changes > 0
        : !!lookup.get(digest, time, time - idleMs)
      if (!valid) remove.run(digest)
      return valid
    },
    revoke(token: string | undefined): void {
      if (validToken(token)) remove.run(hash(token))
    },
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>
