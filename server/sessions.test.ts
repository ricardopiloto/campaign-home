import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { campaignInputSchema } from '../shared/schemas.ts'
import { SESSION_TTL_SECONDS } from './auth.ts'
import { loadConfig } from './config.ts'
import { migrate, openDb } from './db.ts'
import { createRepo } from './repo.ts'
import { createSessionStore } from './sessions.ts'
import { manual, setup } from './test-helpers.ts'

describe('sessões persistidas', () => {
  it('migra banco existente sem alterar campanhas e preserva prazos após restart', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gw-sessions-'))
    const file = path.join(dir, 'test.db')
    let db = openDb(file)
    try {
      const campaign = createRepo(db).create(campaignInputSchema.parse(manual()))
      db.exec('DROP TABLE admin_sessions; PRAGMA user_version = 2')
      migrate(db)
      assert.deepEqual(createRepo(db).get(campaign.id), campaign)
      let time = 1000
      let sessions = createSessionStore(db, { idleTimeoutSeconds: 10, now: () => time })
      const token = sessions.create()
      const row = db.prepare('SELECT * FROM admin_sessions').get()!
      assert.notEqual(row.token_hash, token)
      assert.equal(row.created_at, 1000)
      db.close()
      db = openDb(file)
      sessions = createSessionStore(db, { idleTimeoutSeconds: 10, now: () => time })
      time = 10_999
      assert.equal(sessions.validate(token), true)
      time = 11_000
      assert.equal(sessions.validate(token), false)
      assert.equal(sessions.validate(token, true), false)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renova atomicamente entre conexões, limita duração e revoga cópias', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gw-concurrent-'))
    const a = openDb(path.join(dir, 'test.db'))
    const b = new DatabaseSync(path.join(dir, 'test.db'))
    let time = 0
    const options = { idleTimeoutSeconds: SESSION_TTL_SECONDS, now: () => time }
    const first = createSessionStore(a, options)
    const second = createSessionStore(b, options)
    try {
      const token = first.create()
      assert.match(token, /^[A-Za-z0-9_-]{43}$/)
      assert.equal(first.validate(`${token.slice(0, -1)}!`), false)
      time = 1000
      assert.equal(first.validate(token, true), true)
      assert.equal(second.validate(token, true), true)
      time = SESSION_TTL_SECONDS * 1000
      assert.equal(second.validate(token, true), false)
      assert.equal(first.validate(token, true), false)
      const next = second.create()
      first.revoke(next)
      assert.equal(second.validate(next, true), false)
      assert.equal(first.validate('9999999999.legacy'), false)
    } finally {
      a.close()
      b.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('limpa registros vencidos ao criar nova sessão', () => {
    const db = openDb(':memory:')
    let time = 0
    const sessions = createSessionStore(db, { idleTimeoutSeconds: 1, now: () => time })
    sessions.create()
    time = 1000
    sessions.create()
    assert.equal(db.prepare('SELECT count(*) AS count FROM admin_sessions').get()!.count, 1)
    db.close()
  })
})

describe('configuração da inatividade', () => {
  const env = { ADMIN_PASSWORD: 'test', SESSION_SECRET: 's'.repeat(32) }
  it('usa 1800 segundos e aceita inteiro positivo', () => {
    assert.equal(loadConfig(env).adminSessionIdleTimeoutSeconds, 1800)
    assert.equal(loadConfig({ ...env, ADMIN_SESSION_IDLE_TIMEOUT_SECONDS: '60' }).adminSessionIdleTimeoutSeconds, 60)
  })
  it('rejeita configurações inválidas', () => {
    for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '1e3', '9007199254740991']) {
      assert.throws(() => loadConfig({ ...env, ADMIN_SESSION_IDLE_TIMEOUT_SECONDS: value }), /ADMIN_SESSION_IDLE_TIMEOUT_SECONDS/)
    }
  })
})

describe('ciclo da sessão na API', () => {
  it('consultas automáticas e home não renovam; expiração bloqueia escritas e uploads', async () => {
    let time = 0
    const t = setup({ idleTimeoutSeconds: 10, now: () => time })
    const login = await t.login()
    assert.equal(login.headers.get('cache-control'), 'no-store')
    time = 9000
    assert.equal((await t.req('/api/admin/session')).status, 204)
    assert.equal((await t.req('/api/campaigns')).status, 200)
    time = 10_000
    for (const [url, method] of [
      ['/api/admin/campaigns', 'POST'],
      ['/api/admin/campaigns/order', 'PUT'],
      ['/api/admin/campaigns/x', 'DELETE'],
      ['/api/admin/uploads', 'POST'],
      ['/api/admin/session/activity', 'POST'],
    ]) {
      const res = await t.req(url, { method, json: manual() })
      assert.equal(res.status, 401)
      assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.match(res.headers.get('set-cookie')!, /Max-Age=0/)
    }
    assert.deepEqual(t.repo.list(), [])
    assert.deepEqual(readdirSync(t.uploadsDir), [])
    assert.equal((await t.login()).status, 204)
    assert.equal((await t.req('/api/admin/session')).status, 204)
  })

  it('atividade e chamadas de usuário renovam, mas origem rejeitada não renova', async () => {
    let time = 0
    const t = setup({ idleTimeoutSeconds: 10, now: () => time })
    await t.login()
    time = 9000
    assert.equal((await t.req('/api/admin/session/activity', { method: 'POST' })).status, 204)
    time = 18_000
    assert.equal((await t.req('/api/admin/campaigns')).status, 200)
    time = 27_000
    const rejected = await t.req('http://gateway.test/api/admin/session/activity', {
      method: 'POST', headers: { host: 'gateway.test', origin: 'https://evil.test' },
    })
    assert.equal(rejected.status, 403)
    time = 28_000
    assert.equal((await t.req('/api/admin/session')).status, 401)
  })

  it('logout revoga cópias do cookie e cookies legados são recusados', async () => {
    const t = setup()
    const login = await t.login()
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    assert.equal((await t.req('/api/admin/logout', { method: 'POST' })).status, 204)
    assert.equal((await t.app.request('/api/admin/session', { headers: { cookie } })).status, 401)
    assert.equal((await t.app.request('/api/admin/session', {
      headers: { cookie: 'gw_admin=9999999999.legacy' },
    })).status, 401)
    assert.equal((await t.login('wrong')).headers.get('cache-control'), 'no-store')
  })
})
