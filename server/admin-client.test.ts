import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abortAdminRequests, api, onAdminSessionExpired } from '../src/api.ts'
import { startAdminSession } from '../src/admin/sessionController.ts'
import type { SessionEnvironment, SessionState } from '../src/admin/sessionController.ts'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function environment() {
  let visible = true
  let focus = () => {}
  let visibility = () => {}
  let activity: (trusted: boolean, inAdmin: boolean) => void = () => {}
  let removed = 0
  const env: SessionEnvironment = {
    isVisible: () => visible,
    onFocus: (listener) => { focus = listener; return () => { removed++ } },
    onVisibility: (listener) => { visibility = listener; return () => { removed++ } },
    onActivity: (listener) => { activity = listener; return () => { removed++ } },
  }
  return {
    env, focus: () => focus(), activity: (trusted = true, inAdmin = true) => activity(trusted, inAdmin),
    visibility: (value: boolean) => { visible = value; visibility() }, removed: () => removed,
  }
}

describe('controle de sessão no cliente', () => {
  it('verifica sem heartbeat de renovação; só agrupa interação confiável no admin visível', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 0 })
    const calls: { url: string; method: string }[] = []
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method! })
      return new Response(null, { status: 204 })
    })
    const states: SessionState[] = []
    const env = environment()
    const controller = startAdminSession((state) => states.push(state), env.env)
    try {
      await flush()
      assert.equal(states.at(-1), 'ok')
      t.mock.timers.tick(60_000)
      await flush()
      assert.equal(calls.length, 2)
      assert.ok(calls.every((call) => call.method === 'GET'))
      env.activity(false)
      env.activity(true, false)
      assert.equal(calls.length, 2)
      env.activity()
      await flush()
      assert.equal(calls.at(-1)!.url, '/api/admin/session/activity')
      env.activity()
      env.activity()
      t.mock.timers.tick(29_999)
      assert.equal(calls.length, 3)
      t.mock.timers.tick(1)
      await flush()
      assert.equal(calls.length, 4)
      env.visibility(false)
      env.activity()
      t.mock.timers.tick(60_000)
      await flush()
      assert.equal(calls.length, 4)
      env.visibility(true)
      assert.equal(states.at(-1), 'checking')
      await flush()
      assert.equal(states.at(-1), 'ok')
      assert.equal(calls.at(-1)!.method, 'GET')
    } finally {
      controller.dispose()
    }
    assert.equal(env.removed(), 3)
    const count = calls.length
    t.mock.timers.tick(120_000)
    assert.equal(calls.length, count)
  })

  it('rede oferece retry; retorno com 401 expira e interrompe atividade', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 0 })
    let response: 'offline' | 'ok' | 'expired' = 'offline'
    t.mock.method(globalThis, 'fetch', async () => {
      if (response === 'offline') throw new Error('offline')
      return response === 'ok' ? new Response(null, { status: 204 })
        : Response.json({ error: 'Sessão inválida ou expirada' }, { status: 401 })
    })
    const states: SessionState[] = []
    const env = environment()
    const controller = startAdminSession((state) => states.push(state), env.env)
    try {
      await flush()
      assert.equal(states.at(-1), 'unavailable')
      assert.ok(!states.includes('expired'))
      response = 'ok'
      controller.retry()
      await flush()
      assert.equal(states.at(-1), 'ok')
      response = 'expired'
      env.focus()
      assert.equal(states.at(-1), 'checking')
      await flush()
      assert.equal(states.at(-1), 'expired')
      const count = states.length
      env.activity()
      t.mock.timers.tick(120_000)
      await flush()
      assert.equal(states.length, count)
    } finally { controller.dispose() }
  })

  it('401 protegido cancela chamadas pendentes; senha errada e rede não sinalizam expiração', async (t) => {
    let expirations = 0
    let pendingSignal: AbortSignal | undefined
    const unsubscribe = onAdminSessionExpired(() => { expirations++ })
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/pending')) {
        pendingSignal = init.signal!
        return new Promise<Response>((_resolve, reject) => {
          pendingSignal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
        })
      }
      if (url.endsWith('/offline')) throw new Error('network')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    })
    try {
      await assert.rejects(api('POST', '/api/admin/login', { password: 'wrong' }))
      await assert.rejects(api('GET', '/api/admin/offline'))
      assert.equal(expirations, 0)
      const pending = api('GET', '/api/admin/pending')
      const rejected = assert.rejects(pending, { name: 'AbortError' })
      await assert.rejects(api('PUT', '/api/admin/campaigns/x', {}))
      await rejected
      assert.equal(expirations, 1)
      assert.equal(pendingSignal!.aborted, true)
    } finally { unsubscribe(); abortAdminRequests() }
  })
})
