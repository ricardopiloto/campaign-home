import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import { campaignInputSchema } from '../shared/schemas.ts'
import type { AdminCampaign, PublicCampaign } from '../shared/types.ts'
import { createApp } from './app.ts'
import { createLoginLimiter } from './auth.ts'
import { createCodexClient } from './codex.ts'
import { loadConfig } from './config.ts'
import { createFoundryStatusClient, UnsafeFoundryUrlError } from './foundry.ts'
import { createSafeGet, isPublicAddress } from './net-safety.ts'
import type { Transport } from './net-safety.ts'
import { createRateLimiter } from './rate-limit.ts'
import { createUploadStore, MAX_UPLOAD_BYTES } from './uploads.ts'
import { PASSWORD, SECRET, fakeCovers, linked, makePng, manual, setup } from './test-helpers.ts'

function upload(file: File) {
  const form = new FormData()
  form.set('file', file)
  return form
}
const pngFile = async (name = 'capa.png') =>
  new File([new Uint8Array(await makePng())], name, { type: 'image/png' })

describe('config (segurança)', () => {
  const env = { ADMIN_PASSWORD: 'senha-longa-de-teste', SESSION_SECRET: 's'.repeat(32) }
  it('recusa ADMIN_PASSWORD com menos de 12 caracteres', () => {
    assert.throws(() => loadConfig({ ...env, ADMIN_PASSWORD: '12345678901' }), /ADMIN_PASSWORD curta/)
    assert.doesNotThrow(() => loadConfig({ ...env, ADMIN_PASSWORD: '123456789012' }))
  })
  it('em produção exige CODEX_BASE_URL https e torna o cookie Secure por padrão', () => {
    const prod = { ...env, NODE_ENV: 'production' }
    assert.throws(() => loadConfig({ ...prod, CODEX_BASE_URL: 'http://codex.test' }), /https em produção/)
    assert.equal(loadConfig({ ...prod, CODEX_BASE_URL: 'https://codex.test' }).cookieSecure, true)
    assert.equal(loadConfig({ ...prod, COOKIE_SECURE: 'false' }).cookieSecure, false)
    assert.equal(loadConfig(env).cookieSecure, null)
    assert.doesNotThrow(() => loadConfig({ ...env, CODEX_BASE_URL: 'http://codex.test' }))
  })
  it('valida variáveis numéricas e de origem', () => {
    assert.throws(() => loadConfig({ ...env, TRUSTED_PROXY_HOPS: '0' }), /TRUSTED_PROXY_HOPS/)
    assert.throws(() => loadConfig({ ...env, PUBLIC_ORIGIN: 'nao-e-url' }), /PUBLIC_ORIGIN/)
    assert.throws(() => loadConfig({ ...env, FOUNDRY_ALLOWED_PORTS: '443,abc' }), /FOUNDRY_ALLOWED_PORTS/)
    assert.equal(loadConfig({ ...env, PUBLIC_ORIGIN: 'https://g.test/x' }).publicOrigin, 'https://g.test')
    assert.deepEqual(loadConfig({ ...env, FOUNDRY_ALLOWED_PORTS: '443, 8443' }).foundryAllowedPorts, [443, 8443])
  })
})

describe('sessão revogável', () => {
  it('token copiado antes do logout deixa de valer depois dele', async () => {
    const t = setup()
    await t.login()
    const stolen = t.cookie
    assert.equal((await t.req('/api/admin/session')).status, 204)
    await t.req('/api/admin/logout', { method: 'POST' })
    const res = await t.app.request('/api/admin/session', { headers: { cookie: stolen } })
    assert.equal(res.status, 401)
  })

  it('trocar ADMIN_PASSWORD invalida sessões emitidas antes', async () => {
    const t = setup()
    await t.login()
    const restarted = createApp({
      config: { adminPassword: 'outra-senha-bem-longa', sessionSecret: SECRET, cookieSecure: false, trustedProxy: false },
      repo: t.repo,
      codex: createCodexClient({ baseUrl: null }),
      uploads: createUploadStore(t.uploadsDir),
      sessions: t.sessions,
    })
    const res = await restarted.request('/api/admin/session', { headers: { cookie: t.cookie } })
    assert.equal(res.status, 401)
  })

  it('sessão expirada no servidor é recusada', async () => {
    const t = setup()
    await t.login()
    t.db.exec('UPDATE sessions SET expires_at = 1')
    assert.equal((await t.req('/api/admin/session')).status, 401)
  })

  it('sob HTTPS o cookie usa __Host-, Secure e Path=/', async () => {
    const t = setup({ config: { cookieSecure: true } })
    const res = await t.login()
    const cookie = res.headers.get('set-cookie') ?? ''
    assert.match(cookie, /^__Host-gw_admin=/)
    assert.match(cookie, /Secure/)
    assert.match(cookie, /Path=\//)
    assert.match(cookie, /HttpOnly/)
    assert.equal((await t.req('/api/admin/session')).status, 204)
  })
})

describe('limite de login atrás de proxy', () => {
  const proxy = { trustedProxy: true, trustedProxyHops: 1 }

  it('X-Forwarded-For forjado pelo cliente não escapa do limite', async () => {
    const t = setup({ config: proxy })
    for (let i = 0; i < 5; i++) {
      const res = await t.login('errada', { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.9` })
      assert.equal(res.status, 401)
    }
    const blocked = await t.login(PASSWORD, { 'x-forwarded-for': '10.9.9.9, 203.0.113.9' })
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
    // Outro cliente real (outra entrada adicionada pelo proxy) não é afetado.
    const other = await t.login(PASSWORD, { 'x-forwarded-for': '10.9.9.9, 198.51.100.7' })
    assert.equal(other.status, 204)
  })

  it('limite global bloqueia mesmo com a senha certa e IPs diferentes', async () => {
    const t = setup({
      config: proxy,
      limiter: createLoginLimiter({ globalMaxFailures: 3, baseDelayMs: 0 }),
    })
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      await t.login('errada', { 'x-forwarded-for': ip })
    }
    const res = await t.login(PASSWORD, { 'x-forwarded-for': '198.51.100.4' })
    assert.equal(res.status, 429)
  })

  it('atraso progressivo devolve 429 entre tentativas seguidas', async () => {
    let now = 0
    const t = setup({ limiter: createLoginLimiter({ baseDelayMs: 1000, now: () => now }) })
    for (let i = 0; i < 3; i++) await t.login('errada')
    const res = await t.login('errada')
    assert.equal(res.status, 429)
    now += 1500
    assert.equal((await t.login('errada')).status, 401)
  })
})

describe('CSRF', () => {
  it('escrita sem Origin nem Sec-Fetch-Site responde 403 e nada muda', async () => {
    const t = setup()
    await t.login()
    const res = await t.req('/api/admin/campaigns', {
      method: 'POST',
      json: manual(),
      headers: { 'sec-fetch-site': '' },
    })
    assert.equal(res.status, 403)
    assert.equal(t.repo.list().length, 0)
  })

  it('Sec-Fetch-Site cross-site é recusado; same-origin é aceito', async () => {
    const t = setup()
    await t.login()
    const cross = await t.req('/api/admin/campaigns', {
      method: 'POST',
      json: manual(),
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(cross.status, 403)
    assert.equal((await t.req('/api/admin/campaigns', { method: 'POST', json: manual() })).status, 201)
  })

  it('login também exige prova de mesma origem', async () => {
    const t = setup()
    const res = await t.login(PASSWORD, { 'sec-fetch-site': 'cross-site' })
    assert.equal(res.status, 403)
  })

  it('com PUBLIC_ORIGIN, compara contra ela e não contra o Host', async () => {
    const t = setup({ config: { publicOrigin: 'https://gateway.test' } })
    await t.login()
    const url = 'http://interno:3000/api/admin/campaigns'
    const ok = await t.req(url, { method: 'POST', json: manual(), headers: { origin: 'https://gateway.test', host: 'interno:3000' } })
    assert.equal(ok.status, 201)
    const bad = await t.req(url, { method: 'POST', json: manual(), headers: { origin: 'http://interno:3000', host: 'interno:3000' } })
    assert.equal(bad.status, 403)
  })

  it('rotas JSON exigem Content-Type application/json (415)', async () => {
    const t = setup()
    await t.login()
    const body = JSON.stringify(manual())
    for (const [method, url] of [
      ['POST', '/api/admin/campaigns'],
      ['PUT', '/api/admin/campaigns/order'],
      ['PUT', '/api/admin/campaigns/x'],
    ]) {
      const res = await t.req(url, { method, body, headers: { 'content-type': 'text/plain' } })
      assert.equal(res.status, 415, `${method} ${url}`)
    }
    const login = await t.app.request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: PASSWORD }),
      headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(login.status, 415)
  })
})

describe('auditoria', () => {
  it('registra login falho com IP e sem a senha enviada', async () => {
    const t = setup()
    await t.login('senha-secreta-errada')
    assert.deepEqual(t.audit, [{ action: 'login', ip: 'unknown', ok: false }])
    assert.equal(JSON.stringify(t.audit).includes('senha-secreta-errada'), false)
  })

  it('registra o ciclo de vida das ações administrativas', async () => {
    const t = setup({ covers: fakeCovers() })
    await t.login()
    const created = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: manual() })).json()) as AdminCampaign
    await t.req(`/api/admin/campaigns/${created.id}`, { method: 'PUT', json: manual({ title: 'Novo' }) })
    await t.req('/api/admin/campaigns/order', { method: 'PUT', json: { ids: [created.id] } })
    await t.req('/api/admin/uploads', { method: 'POST', body: upload(await pngFile()) })
    await t.req(`/api/admin/campaigns/${created.id}`, { method: 'DELETE' })
    await t.req('/api/admin/logout', { method: 'POST' })
    assert.deepEqual(
      t.audit.map((e) => e.action),
      ['login', 'campaign.create', 'campaign.update', 'campaign.reorder', 'upload.create', 'campaign.delete', 'logout'],
    )
    assert.equal(t.audit[1].target, created.id)
  })
})

describe('cabeçalhos de segurança', () => {
  it('estão presentes na home, na API e nos uploads', async () => {
    const t = setup()
    for (const url of ['/', '/api/campaigns', '/api/health', '/uploads/nada.png']) {
      const res = await t.app.request(url)
      const csp = res.headers.get('content-security-policy') ?? ''
      assert.match(csp, /frame-ancestors 'none'/, url)
      assert.match(csp, /object-src 'none'/, url)
      assert.match(csp, /base-uri 'self'/, url)
      assert.match(csp, /script-src 'self'(;|$)/, url)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url)
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', url)
      assert.equal(res.headers.get('x-frame-options'), 'DENY', url)
    }
  })

  it('HSTS só sob HTTPS', async () => {
    const http = setup()
    assert.equal((await http.app.request('/api/health')).headers.get('strict-transport-security'), null)
    const https = setup({ config: { cookieSecure: true } })
    assert.match((await https.app.request('/api/health')).headers.get('strict-transport-security') ?? '', /max-age=\d+/)
    const proxied = setup({ config: { trustedProxy: true, cookieSecure: null } })
    const res = await proxied.app.request('/api/health', { headers: { 'x-forwarded-proto': 'https' } })
    assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=\d+/)
  })

  it('não sobrescreve a CSP de sandbox do SVG legado', async () => {
    const t = setup()
    const name = '0e0f5b8a-3c1e-4c4e-9d1b-3a4f5e6d7c8b.svg'
    writeFileSync(path.join(t.uploadsDir, name), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const res = await t.app.request(`/uploads/${name}`)
    assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/)
  })
})

describe('limite de taxa e de corpo', () => {
  it('responde 429 com Retry-After ao exceder em endpoint público', async () => {
    let now = 0
    const t = setup({ extra: { publicLimiter: createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now }) } })
    assert.equal((await t.app.request('/api/campaigns')).status, 200)
    assert.equal((await t.app.request('/api/campaigns')).status, 200)
    const res = await t.app.request('/api/campaigns')
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('retry-after'), '60')
    now = 60_001
    assert.equal((await t.app.request('/api/campaigns')).status, 200)
  })

  it('aplica limite também a /api/admin/* e /uploads/*', async () => {
    const t = setup({
      extra: {
        adminLimiter: createRateLimiter({ limit: 1 }),
        publicLimiter: createRateLimiter({ limit: 1 }),
      },
    })
    await t.app.request('/uploads/nada.png')
    assert.equal((await t.app.request('/uploads/nada.png')).status, 429)
    await t.req('/api/admin/session')
    assert.equal((await t.req('/api/admin/session')).status, 429)
  })

  it('rejeita JSON grande com 413 antes de processar', async () => {
    const t = setup()
    await t.login()
    const res = await t.req('/api/admin/campaigns', {
      method: 'POST',
      json: manual({ tagline: 'x'.repeat(100 * 1024) }),
    })
    assert.equal(res.status, 413)
    assert.equal(t.repo.list().length, 0)
  })

  it('rejeita multipart acima do limite com 413', async () => {
    const t = setup()
    await t.login()
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 200 * 1024)], 'big.png', { type: 'image/png' })
    const res = await t.req('/api/admin/uploads', { method: 'POST', body: upload(big) })
    assert.equal(res.status, 413)
    assert.deepEqual(readdirSync(t.uploadsDir), [])
  })
})

describe('segurança de uploads', () => {
  const post = (t: ReturnType<typeof setup>, file: File) =>
    t.req('/api/admin/uploads', { method: 'POST', body: upload(file) })

  it('rejeita SVG com 400', async () => {
    const t = setup()
    await t.login()
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'a.svg', { type: 'image/svg+xml' })
    const res = await post(t, svg)
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: string }).error, /Formato não permitido/)
    assert.deepEqual(readdirSync(t.uploadsDir), [])
  })

  it('remove EXIF ao reencodar', async () => {
    const t = setup()
    await t.login()
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#336699' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'segredo-exif' } })
      .toBuffer()
    assert.ok((await sharp(jpeg).metadata()).exif, 'fixture deveria ter EXIF')
    const res = await post(t, new File([new Uint8Array(jpeg)], 'foto.jpg', { type: 'image/jpeg' }))
    assert.equal(res.status, 201)
    const { url } = (await res.json()) as { url: string }
    const stored = readFileSync(path.join(t.uploadsDir, path.basename(url)))
    assert.equal((await sharp(stored).metadata()).exif, undefined)
    assert.equal(stored.includes(Buffer.from('segredo-exif')), false)
  })

  it('rejeita imagem com dimensões acima de 4096 px sem decodificá-la', async () => {
    const t = setup()
    await t.login()
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#000' } })
      .png({ compressionLevel: 9 })
      .toBuffer()
    assert.ok(huge.length < MAX_UPLOAD_BYTES)
    const res = await post(t, new File([new Uint8Array(huge)], 'enorme.png', { type: 'image/png' }))
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: string }).error, /4096/)
    assert.deepEqual(readdirSync(t.uploadsDir), [])
  })

  it('rejeita PNG com assinatura válida e conteúdo corrompido', async () => {
    const t = setup()
    await t.login()
    const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    assert.equal((await post(t, new File([fake], 'x.png', { type: 'image/png' }))).status, 400)
  })

  it('recusa novos uploads com 507 quando a cota acabou', async () => {
    const t = setup({ uploadQuotaBytes: 1 })
    await t.login()
    const res = await post(t, await pngFile())
    assert.equal(res.status, 507)
    assert.deepEqual(readdirSync(t.uploadsDir), [])
  })

  it('serve imagens raster com Content-Disposition inline', async () => {
    const t = setup()
    await t.login()
    const { url } = (await (await post(t, await pngFile())).json()) as { url: string }
    const res = await t.app.request(url)
    assert.equal(res.headers.get('content-disposition'), 'inline')
    assert.equal(res.headers.get('content-type'), 'image/png')
  })

  it('remove uploads órfãos antigos e preserva os referenciados e os recentes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gw-sweep-'))
    const store = createUploadStore(dir)
    const orphan = path.basename(await store.save(await pngFile()))
    const kept = path.basename(await store.save(await pngFile()))
    const fresh = path.basename(await store.save(await pngFile()))
    const old = new Date(Date.now() - 25 * 3600 * 1000)
    for (const name of [orphan, kept]) utimesSync(path.join(dir, name), old, old)

    assert.equal(await store.sweepOrphans(new Set([kept])), 1)
    assert.equal(existsSync(path.join(dir, orphan)), false)
    assert.equal(existsSync(path.join(dir, kept)), true)
    assert.equal(existsSync(path.join(dir, fresh)), true)
  })

  it('repo.referencedUploads lista apenas arquivos de /uploads em uso', async () => {
    const t = setup()
    const name = '0e0f5b8a-3c1e-4c4e-9d1b-3a4f5e6d7c8b.png'
    t.repo.create(campaignInputSchema.parse(manual({ imageUrl: `/uploads/${name}` })))
    t.repo.create(campaignInputSchema.parse(manual({ title: 'B', imageUrl: 'https://i.test/a.png' })))
    assert.deepEqual([...t.repo.referencedUploads()], [name])
  })
})

describe('URLs externas', () => {
  it('rejeita http: e credenciais embutidas em foundryUrl, codexUrl e imageUrl', async () => {
    const t = setup()
    await t.login()
    const cases: [string, Record<string, unknown>][] = [
      ['foundryUrl', { foundryUrl: 'http://exemplo.com' }],
      ['foundryUrl', { foundryUrl: 'https://user:pass@exemplo.com' }],
      ['codexUrl', { foundryUrl: null, codexUrl: 'http://exemplo.com' }],
      ['imageUrl', { imageUrl: 'http://exemplo.com/a.png' }],
    ]
    for (const [field, overrides] of cases) {
      const res = await t.req('/api/admin/campaigns', { method: 'POST', json: manual(overrides) })
      assert.equal(res.status, 400, JSON.stringify(overrides))
      assert.equal(((await res.json()) as { field: string }).field, field)
    }
    assert.equal(t.repo.list().length, 0)
  })

  it('a home oculta links e imagens http: de registros legados', async () => {
    const t = setup()
    t.repo.create({
      ...campaignInputSchema.parse(manual()),
      foundryUrl: 'http://legado.test',
      codexUrl: 'http://legado.test/c',
      imageUrl: 'http://legado.test/a.png',
      imageSource: 'url',
    })
    const [item] = (await (await t.app.request('/api/campaigns')).json()) as PublicCampaign[]
    assert.equal(item.foundryUrl, null)
    assert.equal(item.codexUrl, null)
    assert.equal(item.imageUrl, null)
  })

  it('rejeita URL do Foundry que o servidor considera insegura com 400', async () => {
    const unsafe = {
      assertSafeUrl: async () => {
        throw new UnsafeFoundryUrlError()
      },
      get: async () => null,
    }
    const t = setup({ extra: { foundryStatus: unsafe } })
    await t.login()
    const res = await t.req('/api/admin/campaigns', { method: 'POST', json: manual() })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { field: string }).field, 'foundryUrl')
  })
})

describe('faixas de IP bloqueadas', () => {
  it('aceita só endereços públicos', () => {
    for (const ok of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001::200e']) {
      assert.equal(isPublicAddress(ok), true, ok)
    }
    for (const bad of [
      '0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
      '192.0.0.1', '192.0.2.1', '192.168.1.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
      '224.0.0.1', '240.0.0.1', '255.255.255.255',
      '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:8.8.8.8'.replace('8.8.8.8', '192.168.0.1'),
      'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2002:c000:204::', '2001::1', '64:ff9b::1',
      '100::1', '4000::1', 'nao-e-ip', '',
    ]) {
      assert.equal(isPublicAddress(bad), false, bad)
    }
  })
})

describe('consulta de status do Foundry', () => {
  const dns = (address: string) => async () => [{ address, family: address.includes(':') ? 6 : 4 }]
  const client = (options: Parameters<typeof createSafeGet>[0]) =>
    createFoundryStatusClient({ safeGet: createSafeGet(options), cacheTtlMs: 0 })

  it('recusa porta fora da lista e aceita 443 e as configuradas', async () => {
    const strict = client({ resolve: dns('93.184.216.34') })
    await assert.rejects(strict.assertSafeUrl('https://exemplo.com:8443'), UnsafeFoundryUrlError)
    await assert.doesNotReject(strict.assertSafeUrl('https://exemplo.com'))
    await assert.doesNotReject(strict.assertSafeUrl('https://exemplo.com:443'))
    const custom = client({ resolve: dns('93.184.216.34'), allowedPorts: [443, 8443] })
    await assert.doesNotReject(custom.assertSafeUrl('https://exemplo.com:8443'))
  })

  it('recusa host que resolve para IP privado sem abrir conexão', async () => {
    let connections = 0
    const transport: Transport = async () => {
      connections++
      return { status: 200, contentType: 'application/json', body: Buffer.from('{}') }
    }
    const c = client({ resolve: dns('10.0.0.5'), transport })
    await assert.rejects(c.assertSafeUrl('https://interno.exemplo.com'), UnsafeFoundryUrlError)
    const status = await c.get('https://interno.exemplo.com')
    assert.equal(status?.serverAvailable, null)
    assert.equal(connections, 0)
  })

  it('recusa host com algum registro privado entre os públicos', async () => {
    const mixed = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    await assert.rejects(client({ resolve: mixed }).assertSafeUrl('https://exemplo.com'), UnsafeFoundryUrlError)
  })

  it('não segue redirecionamento: 302 é tratado como resposta inválida', async () => {
    let calls = 0
    const transport: Transport = async () => {
      calls++
      return { status: 302, contentType: '', body: Buffer.alloc(0) }
    }
    const status = await client({ resolve: dns('93.184.216.34'), transport }).get('https://exemplo.com')
    assert.equal(calls, 1)
    assert.equal(status?.serverAvailable, null)
    assert.equal(status?.tableActive, null)
  })

  it('interpreta uma resposta válida e fixa o IP resolvido na conexão', async () => {
    let seen: { host: string; address: string } | null = null
    const transport: Transport = async (url, address) => {
      seen = { host: url.hostname, address: address.address }
      return {
        status: 200,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ active: true, world: 'w', system: 'wfrp4e' })),
      }
    }
    const status = await client({ resolve: dns('93.184.216.34'), transport }).get('https://exemplo.com/foundry')
    assert.equal(status?.tableActive, true)
    assert.deepEqual(seen, { host: 'exemplo.com', address: '93.184.216.34' })
  })
})

describe('capas do codex', () => {
  it('vincular copia a capa para /uploads e não referencia o host do codex', async () => {
    const t = setup({ covers: fakeCovers() })
    await t.login()
    const res = await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    assert.equal(res.status, 201)
    const created = (await res.json()) as AdminCampaign
    assert.match(created.imageUrl ?? '', /^\/uploads\/[a-f0-9-]{36}\.png$/)
    assert.equal(created.imageSource, 'codex')
    assert.equal(existsSync(path.join(t.uploadsDir, path.basename(created.imageUrl!))), true)
    const [pub] = (await (await t.app.request('/api/campaigns')).json()) as PublicCampaign[]
    assert.equal(pub.imageUrl?.includes('codex.test'), false)
  })

  it('falha no download não impede o vínculo e não grava a URL externa', async () => {
    const t = setup({
      covers: async () => {
        throw new Error('timeout')
      },
    })
    await t.login()
    const res = await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    assert.equal(res.status, 201)
    const created = (await res.json()) as AdminCampaign
    assert.equal(created.imageUrl, null)
    assert.equal(created.imageSource, null)
  })

  it('capa de fora da origem do codex não é baixada e vira imagem por URL', async () => {
    let downloads = 0
    const t = setup({
      covers: async () => {
        downloads++
        return pngFile()
      },
    })
    await t.login()
    const res = await t.req('/api/admin/campaigns', {
      method: 'POST',
      json: linked({ imageUrl: 'https://outro.test/a.png' }),
    })
    const created = (await res.json()) as AdminCampaign
    assert.equal(downloads, 0)
    assert.equal(created.imageUrl, 'https://outro.test/a.png')
    assert.equal(created.imageSource, 'url')
  })

  it('ressincronizar com falha no download mantém a capa atual', async () => {
    let failing = false
    const ok = fakeCovers()
    const t = setup({
      covers: async (url) => {
        if (failing) throw new Error('fora do ar')
        return ok(url)
      },
    })
    await t.login()
    const created = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })).json()) as AdminCampaign
    assert.ok(created.imageUrl)
    failing = true
    const res = await t.req(`/api/admin/campaigns/${created.id}/resync`, { method: 'POST' })
    assert.equal(res.status, 200)
    const updated = (await res.json()) as AdminCampaign
    assert.equal(updated.imageUrl, created.imageUrl)
    assert.equal(existsSync(path.join(t.uploadsDir, path.basename(created.imageUrl))), true)
  })
})
