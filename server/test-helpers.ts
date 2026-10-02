import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from './app.ts'
import { createLoginLimiter } from './auth.ts'
import { createCodexClient } from './codex.ts'
import { openDb } from './db.ts'
import { createRepo } from './repo.ts'
import { createSessionStore } from './sessions.ts'
import { createUploadStore } from './uploads.ts'

export const PASSWORD = 'senha-de-teste'
export const SECRET = 'x'.repeat(32)
export const CODEX = 'https://codex.test'

export const CATALOG = {
  campanhas: [
    { slug: 'wfrp', nome: 'WFRP', sistema: 'wfrp4e', genero: 'fantasia', capa_url: '/api/c/wfrp/media/covers/a.png' },
    { slug: 'wod', nome: 'WoD', sistema: 'WoD', genero: 'gotico', capa_url: null },
  ],
}

export type FakeCodex = { body: unknown; status: number; fail: boolean; calls: number }

export function setup({ codexBaseUrl = CODEX as string | null, idleTimeoutSeconds = 1800, now = Date.now } = {}) {
  const fake: FakeCodex = { body: CATALOG, status: 200, fail: false, calls: 0 }
  const fetchImpl = (async () => {
    fake.calls++
    if (fake.fail) throw new Error('connect ECONNREFUSED')
    return new Response(JSON.stringify(fake.body), { status: fake.status })
  }) as typeof fetch

  const uploadsDir = mkdtempSync(path.join(tmpdir(), 'gw-uploads-'))
  const db = openDb(':memory:')
  const repo = createRepo(db)
  const app = createApp({
    config: { adminPassword: PASSWORD, sessionSecret: SECRET, cookieSecure: false, trustedProxy: false },
    repo,
    sessions: createSessionStore(db, { idleTimeoutSeconds, now }),
    // Fixtures usam domínios .test; testes de API não devem depender de DNS/rede reais.
    foundryStatus: {
      assertSafeUrl: async () => {},
      get: async (url) => url ? { serverAvailable: true, tableActive: true, world: 'test', system: '' } : null,
    },
    codex: createCodexClient({ baseUrl: codexBaseUrl, fetch: fetchImpl, cacheTtlMs: 0 }),
    uploads: createUploadStore(uploadsDir),
    limiter: createLoginLimiter(),
  })

  let cookie = ''
  async function login(password = PASSWORD) {
    const res = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return res
  }

  function req(url: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('cookie', cookie)
    let body = init.body
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.json)
    }
    return app.request(url, { ...init, headers, body })
  }

  return { app, repo, fake, uploadsDir, login, req }
}

export const manual = (overrides: Record<string, unknown> = {}) => ({
  source: 'manual',
  title: 'Iron & Dust',
  foundryUrl: 'https://foundry.test/iron',
  ...overrides,
})

export const linked = (overrides: Record<string, unknown> = {}) => ({
  source: 'codex',
  codexSlug: 'wfrp',
  title: 'WFRP',
  system: 'wfrp4e',
  imageUrl: `${CODEX}/api/c/wfrp/media/covers/a.png`,
  imageSource: 'codex',
  codexUrl: `${CODEX}/c/wfrp`,
  foundryUrl: 'https://foundry.test/wfrp',
  ...overrides,
})
