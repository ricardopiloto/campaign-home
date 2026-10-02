import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { AdminCampaign, CodexCampaign, PublicCampaign } from '../shared/types.ts'
import { CODEX, linked, manual, setup } from './test-helpers.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function upload(file: File) {
  const form = new FormData()
  form.set('file', file)
  return form
}

describe('GET /api/campaigns', () => {
  it('é público e expõe apenas campos de exibição', async () => {
    const t = setup()
    await t.login()
    await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    const res = await t.app.request('/api/campaigns')
    assert.equal(res.status, 200)
    const [item] = (await res.json()) as PublicCampaign[]
    assert.deepEqual(Object.keys(item).sort(), [
      'codexUrl', 'foundryUrl', 'id', 'imageUrl', 'ongoing', 'status', 'system', 'tagline', 'title',
    ])
  })
})

describe('autenticação', () => {
  it('login correto define cookie httpOnly; errado responde 401 sem cookie', async () => {
    const t = setup()
    const bad = await t.login('errada')
    assert.equal(bad.status, 401)
    assert.equal(bad.headers.get('set-cookie'), null)
    assert.deepEqual(await bad.json(), { error: 'Senha inválida' })

    const ok = await t.login()
    assert.equal(ok.status, 204)
    const cookie = ok.headers.get('set-cookie') ?? ''
    assert.match(cookie, /gw_admin=/)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Lax/)
  })

  it('rotas admin sem sessão respondem 401', async () => {
    const t = setup()
    for (const [method, url] of [
      ['GET', '/api/admin/session'],
      ['GET', '/api/admin/campaigns'],
      ['POST', '/api/admin/campaigns'],
      ['PUT', '/api/admin/campaigns/order'],
      ['DELETE', '/api/admin/campaigns/x'],
      ['GET', '/api/admin/codex/available'],
      ['POST', '/api/admin/uploads'],
    ]) {
      const res = await t.req(url, { method })
      assert.equal(res.status, 401, `${method} ${url}`)
    }
  })

  it('cookie adulterado é recusado', async () => {
    const t = setup()
    const res = await t.app.request('/api/admin/session', { headers: { cookie: 'gw_admin=9999999999.abc' } })
    assert.equal(res.status, 401)
  })

  it('logout invalida a sessão no cliente', async () => {
    const t = setup()
    await t.login()
    const res = await t.req('/api/admin/logout', { method: 'POST' })
    assert.equal(res.status, 204)
    assert.match(res.headers.get('set-cookie') ?? '', /gw_admin=;.*Max-Age=0/)
  })

  it('escrita com Origin de outro host responde 403', async () => {
    const t = setup()
    await t.login()
    const res = await t.req('http://gateway.test/api/admin/campaigns', {
      method: 'POST',
      json: manual(),
      headers: { origin: 'https://evil.test', host: 'gateway.test' },
    })
    assert.equal(res.status, 403)
    const same = await t.req('http://gateway.test/api/admin/campaigns', {
      method: 'POST',
      json: manual(),
      headers: { origin: 'http://gateway.test', host: 'gateway.test' },
    })
    assert.equal(same.status, 201)
  })

  it('6ª tentativa falha recebe 429 mesmo com a senha certa', async () => {
    const t = setup()
    for (let i = 0; i < 5; i++) assert.equal((await t.login('errada')).status, 401)
    assert.equal((await t.login()).status, 429)
  })
})

describe('codex/available', () => {
  it('lista apenas campanhas não vinculadas', async () => {
    const t = setup()
    await t.login()
    let items = (await (await t.req('/api/admin/codex/available')).json()) as CodexCampaign[]
    assert.deepEqual(items.map((i) => i.slug), ['wfrp', 'wod'])
    assert.equal(items[0].imageUrl, `${CODEX}/api/c/wfrp/media/covers/a.png`)
    assert.equal(items[0].codexUrl, `${CODEX}/c/wfrp`)

    await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    items = (await (await t.req('/api/admin/codex/available')).json()) as CodexCampaign[]
    assert.deepEqual(items.map((i) => i.slug), ['wod'])
  })

  it('503 sem CODEX_BASE_URL, 502 com codex fora do ar', async () => {
    const off = setup({ codexBaseUrl: null })
    await off.login()
    assert.equal((await off.req('/api/admin/codex/available')).status, 503)

    const t = setup()
    await t.login()
    t.fake.fail = true
    const res = await t.req('/api/admin/codex/available')
    assert.equal(res.status, 502)
    assert.deepEqual(await res.json(), { error: 'Não foi possível carregar o catálogo do codex' })
  })
})

describe('CRUD de campanhas', () => {
  it('cria vinculada e manual; lista com origem e missingInCodex', async () => {
    const t = setup()
    await t.login()
    const a = await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    assert.equal(a.status, 201)
    const b = await t.req('/api/admin/campaigns', { method: 'POST', json: manual() })
    assert.equal(b.status, 201)

    const list = (await (await t.req('/api/admin/campaigns')).json()) as AdminCampaign[]
    assert.deepEqual(list.map((c) => [c.source, c.missingInCodex]), [['codex', false], ['manual', false]])
  })

  it('missingInCodex é true quando o slug sumiu e null quando o codex falha', async () => {
    const t = setup()
    await t.login()
    await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    t.fake.body = { campanhas: [{ slug: 'wod', nome: 'WoD' }] }
    let [c] = (await (await t.req('/api/admin/campaigns')).json()) as AdminCampaign[]
    assert.equal(c.missingInCodex, true)
    // A home continua exibindo a campanha.
    assert.equal(((await (await t.app.request('/api/campaigns')).json()) as unknown[]).length, 1)

    t.fake.fail = true
    ;[c] = (await (await t.req('/api/admin/campaigns')).json()) as AdminCampaign[]
    assert.equal(c.missingInCodex, null)
  })

  it('vínculo duplicado responde 409', async () => {
    const t = setup()
    await t.login()
    await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    const dup = await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })
    assert.equal(dup.status, 409)
    assert.equal(((await (await t.req('/api/admin/campaigns')).json()) as unknown[]).length, 1)
  })

  it('validação responde 400 com o campo', async () => {
    const t = setup()
    await t.login()
    const res = await t.req('/api/admin/campaigns', { method: 'POST', json: manual({ foundryUrl: null }) })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { field: string }).field, 'foundryUrl')
    const bad = await t.req('/api/admin/campaigns', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })
    assert.equal(bad.status, 400)
  })

  it('edita todos os campos e responde 404 para id inexistente', async () => {
    const t = setup()
    await t.login()
    const created = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })).json()) as AdminCampaign
    const res = await t.req(`/api/admin/campaigns/${created.id}`, {
      method: 'PUT',
      json: linked({ tagline: 'Nova tagline', status: '4 PLAYERS', ongoing: true }),
    })
    assert.equal(res.status, 200)
    const [pub] = (await (await t.app.request('/api/campaigns')).json()) as PublicCampaign[]
    assert.equal(pub.tagline, 'Nova tagline')
    assert.equal(pub.ongoing, true)

    assert.equal((await t.req('/api/admin/campaigns/nao-existe', { method: 'PUT', json: manual() })).status, 404)
  })

  it('remove, libera o slug e reordena', async () => {
    const t = setup()
    await t.login()
    const a = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: linked() })).json()) as AdminCampaign
    const b = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: manual({ title: 'B' }) })).json()) as AdminCampaign
    const c = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: manual({ title: 'C' }) })).json()) as AdminCampaign

    assert.equal((await t.req('/api/admin/campaigns/order', { method: 'PUT', json: { ids: [a.id, c.id, b.id] } })).status, 204)
    let titles = ((await (await t.app.request('/api/campaigns')).json()) as PublicCampaign[]).map((x) => x.title)
    assert.deepEqual(titles, ['WFRP', 'C', 'B'])

    assert.equal((await t.req(`/api/admin/campaigns/${a.id}`, { method: 'DELETE' })).status, 204)
    titles = ((await (await t.app.request('/api/campaigns')).json()) as PublicCampaign[]).map((x) => x.title)
    assert.deepEqual(titles, ['C', 'B'])
    const available = (await (await t.req('/api/admin/codex/available')).json()) as CodexCampaign[]
    assert.ok(available.some((x) => x.slug === 'wfrp'))
    assert.equal((await t.req(`/api/admin/campaigns/${a.id}`, { method: 'DELETE' })).status, 404)
  })
})

describe('ressincronização', () => {
  it('atualiza nome, sistema, link e imagem do codex; preserva o resto', async () => {
    const t = setup()
    await t.login()
    const created = (await (
      await t.req('/api/admin/campaigns', { method: 'POST', json: linked({ tagline: 'Minha tagline', status: '4 PLAYERS' }) })
    ).json()) as AdminCampaign
    t.fake.body = {
      campanhas: [{ slug: 'wfrp', nome: 'Armada Agazzi', sistema: 'WFRP 4e', capa_url: '/api/c/wfrp/media/covers/b.png' }],
    }
    const res = await t.req(`/api/admin/campaigns/${created.id}/resync`, { method: 'POST' })
    assert.equal(res.status, 200)
    const updated = (await res.json()) as AdminCampaign
    assert.equal(updated.title, 'Armada Agazzi')
    assert.equal(updated.system, 'WFRP 4e')
    assert.equal(updated.imageUrl, `${CODEX}/api/c/wfrp/media/covers/b.png`)
    assert.equal(updated.tagline, 'Minha tagline')
    assert.equal(updated.status, 'ATIVO')
    assert.equal(updated.foundryUrl, 'https://foundry.test/wfrp')
  })

  it('mantém imagem própria (URL) ao ressincronizar', async () => {
    const t = setup()
    await t.login()
    const created = (await (
      await t.req('/api/admin/campaigns', { method: 'POST', json: linked({ imageUrl: 'https://img.test/x.png', imageSource: 'url' }) })
    ).json()) as AdminCampaign
    const updated = (await (await t.req(`/api/admin/campaigns/${created.id}/resync`, { method: 'POST' })).json()) as AdminCampaign
    assert.equal(updated.imageUrl, 'https://img.test/x.png')
  })

  it('codex indisponível: 502 e nada muda', async () => {
    const t = setup()
    await t.login()
    const created = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: linked({ title: 'Local' }) })).json()) as AdminCampaign
    t.fake.fail = true
    assert.equal((await t.req(`/api/admin/campaigns/${created.id}/resync`, { method: 'POST' })).status, 502)
    assert.equal(t.repo.get(created.id)?.title, 'Local')
  })

  it('campanha manual não pode ser ressincronizada', async () => {
    const t = setup()
    await t.login()
    const created = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: manual() })).json()) as AdminCampaign
    assert.equal((await t.req(`/api/admin/campaigns/${created.id}/resync`, { method: 'POST' })).status, 400)
  })
})

describe('uploads', () => {
  it('aceita PNG, serve publicamente e apaga ao trocar/remover', async () => {
    const t = setup()
    await t.login()
    const res = await t.req('/api/admin/uploads', {
      method: 'POST',
      body: upload(new File([PNG], 'capa.png', { type: 'image/png' })),
    })
    assert.equal(res.status, 201)
    const { url } = (await res.json()) as { url: string }
    assert.match(url, /^\/uploads\/[a-f0-9-]{36}\.png$/)

    const served = await t.app.request(url)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')

    const created = (await (await t.req('/api/admin/campaigns', { method: 'POST', json: manual({ imageUrl: url }) })).json()) as AdminCampaign
    assert.equal(created.imageSource, 'upload')
    const file = path.join(t.uploadsDir, path.basename(url))
    assert.ok(existsSync(file))

    await t.req(`/api/admin/campaigns/${created.id}`, { method: 'PUT', json: manual({ imageUrl: null }) })
    assert.equal(existsSync(file), false)
  })

  it('serve SVG com CSP sandbox', async () => {
    const t = setup()
    await t.login()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    const res = await t.req('/api/admin/uploads', {
      method: 'POST',
      body: upload(new File([svg], 'a.svg', { type: 'image/svg+xml' })),
    })
    const { url } = (await res.json()) as { url: string }
    const served = await t.app.request(url)
    assert.match(served.headers.get('content-security-policy') ?? '', /sandbox/)
  })

  it('recusa tipo não permitido, conteúdo falso e arquivo grande', async () => {
    const t = setup()
    await t.login()
    const post = (file: File) => t.req('/api/admin/uploads', { method: 'POST', body: upload(file) })

    assert.equal((await post(new File(['MZ'], 'x.exe', { type: 'application/octet-stream' }))).status, 400)
    assert.equal((await post(new File(['not a png'], 'x.png', { type: 'image/png' }))).status, 400)
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(PNG)
    assert.equal((await post(new File([big], 'big.png', { type: 'image/png' }))).status, 400)
    assert.deepEqual(readdirSync(t.uploadsDir), [])
  })

  it('não serve caminhos fora do padrão', async () => {
    const t = setup()
    assert.equal((await t.app.request('/uploads/..%2Fgateway.db')).status, 404)
    assert.equal((await t.app.request('/uploads/nada.png')).status, 404)
  })
})
