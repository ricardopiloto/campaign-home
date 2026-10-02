import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createApp } from './app.ts'
import { createLoginLimiter, createSessionStore } from './auth.ts'
import type { AuditEvent, AppDeps } from './app.ts'
import { createCodexClient } from './codex.ts'
import { openDb } from './db.ts'
import type { FoundryStatus } from './foundry.ts'
import { createRepo } from './repo.ts'
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

const ACTIVE: FoundryStatus = { serverAvailable: true, tableActive: true, world: 'w', system: 'wfrp4e' }

export function setup({
  codexBaseUrl = CODEX as string | null,
  config = {} as Partial<AppDeps['config']>,
  covers,
  uploadQuotaBytes,
  limiter = createLoginLimiter({ baseDelayMs: 0 }),
  extra = {} as Partial<AppDeps>,
}: {
  codexBaseUrl?: string | null
  config?: Partial<AppDeps['config']>
  covers?: AppDeps['covers']
  uploadQuotaBytes?: number
  limiter?: AppDeps['limiter']
  extra?: Partial<AppDeps>
} = {}) {
  const fake: FakeCodex = { body: CATALOG, status: 200, fail: false, calls: 0 }
  const fetchImpl = (async () => {
    fake.calls++
    if (fake.fail) throw new Error('connect ECONNREFUSED')
    return new Response(JSON.stringify(fake.body), { status: fake.status })
  }) as typeof fetch

  // Sem DNS nem rede: o status do Foundry é sempre "ativo" (o cliente real tem testes próprios).
  const foundryStatus = {
    assertSafeUrl: async () => {},
    get: async (url: string | null) => (url ? ACTIVE : null),
  }
  const audit: AuditEvent[] = []

  const uploadsDir = mkdtempSync(path.join(tmpdir(), 'gw-uploads-'))
  const db = openDb(':memory:')
  const repo = createRepo(db)
  const sessions = createSessionStore(db)
  const app = createApp({
    config: { adminPassword: PASSWORD, sessionSecret: SECRET, cookieSecure: false, trustedProxy: false, ...config },
    repo,
    codex: createCodexClient({ baseUrl: codexBaseUrl, fetch: fetchImpl, cacheTtlMs: 0 }),
    uploads: createUploadStore(uploadsDir, { quotaBytes: uploadQuotaBytes }),
    sessions,
    foundryStatus,
    covers,
    limiter,
    audit: (event) => audit.push(event),
    ...extra,
  })

  let cookie = ''
  let cookieName = ''
  async function login(password = PASSWORD, headers: Record<string, string> = {}) {
    const res = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
      body: JSON.stringify({ password }),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      cookie = setCookie.split(';')[0]
      cookieName = cookie.split('=')[0]
    }
    return res
  }

  /** Requisição autenticada, same-origin por padrão (passe `sec-fetch-site: ''` para omitir). */
  function req(url: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers({ 'sec-fetch-site': 'same-origin' })
    new Headers(init.headers).forEach((value, key) => {
      if (value === '') headers.delete(key)
      else headers.set(key, value)
    })
    if (cookie) headers.set('cookie', cookie)
    let body = init.body
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.json)
    }
    return app.request(url, { ...init, headers, body })
  }

  return {
    app,
    repo,
    db,
    sessions,
    fake,
    audit,
    uploadsDir,
    login,
    req,
    get cookie() {
      return cookie
    },
    get cookieName() {
      return cookieName
    },
  }
}

export const makePng = (width = 8, height = 8) =>
  sharp({ create: { width, height, channels: 3, background: '#cc3333' } }).png().toBuffer()

export const fakeCovers = (): NonNullable<AppDeps['covers']> => async () =>
  new File([new Uint8Array(await makePng())], 'cover.png', { type: 'image/png' })

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
