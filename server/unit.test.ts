import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { campaignInputSchema, toApiError } from '../shared/schemas.ts'
import { createLoginLimiter } from './auth.ts'
import { CodexUnavailableError, createCodexClient, mapCatalog } from './codex.ts'
import { loadConfig } from './config.ts'
import { migrate, openDb } from './db.ts'
import { DuplicateCodexSlugError, createRepo } from './repo.ts'

const validEnv = { ADMIN_PASSWORD: 'x', SESSION_SECRET: 's'.repeat(32) }

describe('config', () => {
  it('recusa iniciar sem ADMIN_PASSWORD', () => {
    assert.throws(() => loadConfig({ SESSION_SECRET: 's'.repeat(32) }), /ADMIN_PASSWORD/)
  })
  it('recusa iniciar sem SESSION_SECRET', () => {
    assert.throws(() => loadConfig({ ADMIN_PASSWORD: 'x' }), /SESSION_SECRET/)
  })
  it('normaliza CODEX_BASE_URL e aceita ausência', () => {
    assert.equal(loadConfig(validEnv).codexBaseUrl, null)
    assert.equal(
      loadConfig({ ...validEnv, CODEX_BASE_URL: 'https://codex.test/' }).codexBaseUrl,
      'https://codex.test',
    )
  })
})

describe('db', () => {
  it('cria o schema e não reaplica migrações', () => {
    const db = openDb(':memory:')
    const version = () => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    assert.equal(version(), 3)
    migrate(db)
    assert.equal(version(), 3)
  })
})

describe('repo', () => {
  const input = (o: Record<string, unknown> = {}) =>
    campaignInputSchema.parse({ source: 'manual', title: 'A', foundryUrl: 'https://f.test', ...o })

  it('ordena por sort_order e coloca novas no fim', () => {
    const repo = createRepo(openDb(':memory:'))
    const a = repo.create(input({ title: 'A' }))
    const b = repo.create(input({ title: 'B' }))
    assert.deepEqual(repo.list().map((c) => c.title), ['A', 'B'])
    repo.reorder([b.id, a.id])
    assert.deepEqual(repo.list().map((c) => c.title), ['B', 'A'])
  })

  it('reorder mantém omitidas no fim e ignora ids desconhecidos', () => {
    const repo = createRepo(openDb(':memory:'))
    const [a, b, c] = ['A', 'B', 'C'].map((title) => repo.create(input({ title })))
    repo.reorder([c.id, 'desconhecido'])
    assert.deepEqual(repo.list().map((x) => x.id), [c.id, a.id, b.id])
  })

  it('rejeita codex_slug duplicado', () => {
    const repo = createRepo(openDb(':memory:'))
    const linked = input({ source: 'codex', codexSlug: 'wfrp' })
    repo.create(linked)
    assert.throws(() => repo.create(linked), DuplicateCodexSlugError)
  })
})

describe('validação', () => {
  const parse = (o: Record<string, unknown>) => campaignInputSchema.safeParse(o)

  it('rejeita esquema javascript:', () => {
    const r = parse({ source: 'manual', title: 'A', foundryUrl: 'javascript:alert(1)' })
    assert.equal(r.success, false)
    assert.equal(toApiError(r.error!).field, 'foundryUrl')
  })
  it('rejeita URL relativa', () => {
    const r = parse({ source: 'manual', title: 'A', codexUrl: '/c/wfrp' })
    assert.equal(r.success, false)
    assert.equal(toApiError(r.error!).field, 'codexUrl')
  })
  it('exige ao menos um link', () => {
    const r = parse({ source: 'manual', title: 'A', foundryUrl: '  ', codexUrl: '' })
    assert.equal(r.success, false)
    assert.deepEqual(toApiError(r.error!), {
      error: 'Informe ao menos um link (Foundry ou Codex)',
      field: 'foundryUrl',
    })
  })
  it('exige nome', () => {
    const r = parse({ source: 'manual', title: '   ', foundryUrl: 'https://f.test' })
    assert.equal(toApiError(r.error!).field, 'title')
  })
  it('exige slug no modo codex e descarta slug no modo manual', () => {
    assert.equal(toApiError(parse({ source: 'codex', title: 'A', foundryUrl: 'https://f.test' }).error!).field, 'codexSlug')
    const r = parse({ source: 'manual', codexSlug: 'wfrp', title: 'A', foundryUrl: 'https://f.test' })
    assert.equal(r.data?.codexSlug, null)
  })
  it('deriva a origem da imagem', () => {
    const base = { source: 'manual', title: 'A', foundryUrl: 'https://f.test' }
    assert.equal(parse({ ...base, imageUrl: 'https://i.test/a.png', imageSource: 'codex' }).data?.imageSource, 'url')
    assert.equal(parse({ ...base, imageUrl: '/uploads/0e0f5b8a-3c1e-4c4e-9d1b-3a4f5e6d7c8b.png' }).data?.imageSource, 'upload')
    assert.equal(parse({ ...base, imageUrl: '/etc/passwd' }).success, false)
  })
})

describe('limitador de login', () => {
  it('bloqueia após o limite e libera após a janela', () => {
    let t = 0
    const limiter = createLoginLimiter({ maxFailures: 2, windowMs: 1000, now: () => t })
    limiter.recordFailure('ip')
    assert.equal(limiter.isBlocked('ip'), false)
    limiter.recordFailure('ip')
    assert.equal(limiter.isBlocked('ip'), true)
    assert.equal(limiter.isBlocked('outro'), false)
    t = 1001
    assert.equal(limiter.isBlocked('ip'), false)
  })
})

describe('codex', () => {
  const base = 'https://codex.test'

  it('mapeia itens, resolve capa relativa e deriva link', () => {
    const items = mapCatalog(base, {
      campanhas: [{ slug: 'wfrp', nome: 'WFRP', sistema: 'wfrp4e', capa_url: '/uploads/wfrp/covers/capa.jpg' }],
    })
    assert.deepEqual(items, [
      {
        slug: 'wfrp',
        title: 'WFRP',
        system: 'wfrp4e',
        imageUrl: 'https://codex.test/uploads/wfrp/covers/capa.jpg',
        codexUrl: 'https://codex.test/c/wfrp',
      },
    ])
  })

  it('descarta itens sem slug ou nome', () => {
    const items = mapCatalog(base, {
      campanhas: [{ nome: 'Sem slug' }, { slug: 'x' }, { slug: 'ok', nome: 'Ok', capa_url: null }],
    })
    assert.deepEqual(items.map((i) => i.slug), ['ok'])
  })

  it('falha quando nenhum item é válido ou o formato é inesperado', () => {
    assert.throws(() => mapCatalog(base, { campanhas: [{ foo: 1 }] }), CodexUnavailableError)
    assert.throws(() => mapCatalog(base, { outra: [] }), CodexUnavailableError)
    assert.deepEqual(mapCatalog(base, { campanhas: [] }), [])
  })

  it('converte timeout e erro HTTP em CodexUnavailableError', async () => {
    const slow = createCodexClient({
      baseUrl: base,
      timeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('timeout')))
        })) as unknown as typeof fetch,
    })
    await assert.rejects(slow.list(), CodexUnavailableError)

    const broken = createCodexClient({
      baseUrl: base,
      fetch: (async () => new Response('x', { status: 500 })) as typeof fetch,
    })
    await assert.rejects(broken.list(), CodexUnavailableError)
  })

  it('usa cache dentro do TTL', async () => {
    let calls = 0
    let t = 0
    const client = createCodexClient({
      baseUrl: base,
      now: () => t,
      cacheTtlMs: 1000,
      fetch: (async () => {
        calls++
        return new Response(JSON.stringify({ campanhas: [] }))
      }) as typeof fetch,
    })
    await client.list()
    await client.list()
    assert.equal(calls, 1)
    await client.list({ fresh: true })
    assert.equal(calls, 2)
    t = 5000
    await client.list()
    assert.equal(calls, 3)
  })
})
