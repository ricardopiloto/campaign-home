import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import {
  campaignInputSchema,
  loginInputSchema,
  orderInputSchema,
  toApiError,
} from '../shared/schemas.ts'
import type { CampaignInput } from '../shared/schemas.ts'
import type { AdminCampaign, ApiError, PublicCampaign } from '../shared/types.ts'
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createLoginLimiter,
  createSessionToken,
  passwordMatches,
  verifySessionToken,
} from './auth.ts'
import type { LoginLimiter } from './auth.ts'
import { CodexUnavailableError } from './codex.ts'
import type { CodexClient } from './codex.ts'
import type { Config } from './config.ts'
import { DuplicateCodexSlugError } from './repo.ts'
import type { CampaignRepo, StoredCampaign } from './repo.ts'
import { UploadError } from './uploads.ts'
import type { UploadStore } from './uploads.ts'

export interface AppDeps {
  config: Pick<Config, 'adminPassword' | 'sessionSecret' | 'cookieSecure' | 'trustedProxy'> & {
    distDir?: string | null
  }
  repo: CampaignRepo
  codex: CodexClient
  uploads: UploadStore
  limiter?: LoginLimiter
}

function toPublic(c: StoredCampaign): PublicCampaign {
  return {
    id: c.id,
    title: c.title,
    tagline: c.tagline,
    system: c.system,
    status: c.status,
    ongoing: c.ongoing,
    imageUrl: c.imageUrl,
    foundryUrl: c.foundryUrl,
    codexUrl: c.codexUrl,
  }
}

function toInput(c: StoredCampaign): CampaignInput {
  return {
    source: c.source,
    codexSlug: c.codexSlug,
    title: c.title,
    tagline: c.tagline,
    system: c.system,
    status: c.status,
    ongoing: c.ongoing,
    imageUrl: c.imageUrl,
    imageSource: c.imageSource,
    foundryUrl: c.foundryUrl,
    codexUrl: c.codexUrl,
  }
}

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503, body: ApiError) =>
  c.json(body, status)

export function createApp(deps: AppDeps) {
  const { config, repo, codex, uploads } = deps
  const limiter = deps.limiter ?? createLoginLimiter()
  const app = new Hono()

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Erro interno do servidor' } satisfies ApiError, 500)
  })

  async function readJson(c: Context): Promise<unknown> {
    try {
      return await c.req.json()
    } catch {
      return undefined
    }
  }

  function clientIp(c: Context): string {
    if (config.trustedProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      if (forwarded) return forwarded
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  function isHttps(c: Context): boolean {
    if (config.cookieSecure !== null) return config.cookieSecure
    if (config.trustedProxy && c.req.header('x-forwarded-proto') === 'https') return true
    return new URL(c.req.url).protocol === 'https:'
  }

  // ---------- Público ----------

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/campaigns', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(repo.list().map(toPublic))
  })

  // ---------- Admin: sessão ----------

  const admin = new Hono()

  // CSRF: métodos de escrita só aceitam requisições da mesma origem.
  admin.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin')
      if (origin) {
        let originHost: string | null = null
        try {
          originHost = new URL(origin).host
        } catch {
          originHost = null
        }
        if (originHost !== c.req.header('host')) {
          return fail(c, 403, { error: 'Origem não permitida' })
        }
      }
    }
    await next()
  })

  admin.post('/login', async (c) => {
    const ip = clientIp(c)
    if (limiter.isBlocked(ip)) {
      return fail(c, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' })
    }
    const parsed = loginInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    if (!passwordMatches(parsed.data.password, config.adminPassword)) {
      limiter.recordFailure(ip)
      return fail(c, 401, { error: 'Senha inválida' })
    }
    limiter.reset(ip)
    setCookie(c, SESSION_COOKIE, createSessionToken(config.sessionSecret), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps(c),
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    return c.body(null, 204)
  })

  admin.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) })
    return c.body(null, 204)
  })

  // Todas as rotas abaixo exigem sessão.
  admin.use('*', async (c, next) => {
    if (!verifySessionToken(getCookie(c, SESSION_COOKIE), config.sessionSecret)) {
      return fail(c, 401, { error: 'Sessão inválida ou expirada' })
    }
    c.header('Cache-Control', 'no-store')
    await next()
  })

  admin.get('/session', (c) => c.body(null, 204))

  // ---------- Admin: codex ----------

  admin.get('/codex/available', async (c) => {
    if (!codex.enabled) {
      return fail(c, 503, { error: 'Integração com o codex não configurada' })
    }
    try {
      const linked = repo.linkedSlugs()
      const items = await codex.list({ fresh: c.req.query('fresh') === '1' })
      return c.json(items.filter((item) => !linked.has(item.slug)))
    } catch (err) {
      if (err instanceof CodexUnavailableError) {
        return fail(c, 502, { error: 'Não foi possível carregar o catálogo do codex' })
      }
      throw err
    }
  })

  // ---------- Admin: campanhas ----------

  admin.get('/campaigns', async (c) => {
    const campaigns = repo.list()
    let codexSlugs: Set<string> | null = null
    if (codex.enabled && campaigns.some((x) => x.source === 'codex')) {
      try {
        codexSlugs = new Set((await codex.list()).map((item) => item.slug))
      } catch (err) {
        if (!(err instanceof CodexUnavailableError)) throw err
      }
    }
    const result: AdminCampaign[] = campaigns.map((x) => ({
      ...x,
      missingInCodex:
        x.source === 'manual' ? false : codexSlugs ? !codexSlugs.has(x.codexSlug!) : null,
    }))
    return c.json(result)
  })

  admin.post('/campaigns', async (c) => {
    const parsed = campaignInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    try {
      return c.json(repo.create(parsed.data), 201)
    } catch (err) {
      if (err instanceof DuplicateCodexSlugError) {
        return fail(c, 409, { error: err.message, field: 'codexSlug' })
      }
      throw err
    }
  })

  admin.put('/campaigns/order', async (c) => {
    const parsed = orderInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    repo.reorder(parsed.data.ids)
    return c.body(null, 204)
  })

  admin.put('/campaigns/:id', async (c) => {
    const previous = repo.get(c.req.param('id'))
    if (!previous) return fail(c, 404, { error: 'Campanha não encontrada' })
    const parsed = campaignInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    try {
      const updated = repo.update(previous.id, parsed.data)
      if (!updated) return fail(c, 404, { error: 'Campanha não encontrada' })
      if (previous.imageUrl !== updated.imageUrl) await uploads.remove(previous.imageUrl)
      return c.json(updated)
    } catch (err) {
      if (err instanceof DuplicateCodexSlugError) {
        return fail(c, 409, { error: err.message, field: 'codexSlug' })
      }
      throw err
    }
  })

  admin.delete('/campaigns/:id', async (c) => {
    const removed = repo.remove(c.req.param('id'))
    if (!removed) return fail(c, 404, { error: 'Campanha não encontrada' })
    await uploads.remove(removed.imageUrl)
    return c.body(null, 204)
  })

  admin.post('/campaigns/:id/resync', async (c) => {
    const current = repo.get(c.req.param('id'))
    if (!current) return fail(c, 404, { error: 'Campanha não encontrada' })
    if (current.source !== 'codex' || !current.codexSlug) {
      return fail(c, 400, { error: 'Apenas campanhas vinculadas ao codex podem ser ressincronizadas' })
    }
    if (!codex.enabled) {
      return fail(c, 503, { error: 'Integração com o codex não configurada' })
    }
    let items
    try {
      items = await codex.list({ fresh: true })
    } catch (err) {
      if (err instanceof CodexUnavailableError) {
        return fail(c, 502, { error: 'Não foi possível carregar o catálogo do codex' })
      }
      throw err
    }
    const item = items.find((x) => x.slug === current.codexSlug)
    if (!item) return fail(c, 404, { error: 'Campanha não encontrada no codex' })

    const input = toInput(current)
    input.title = item.title
    input.system = item.system
    input.codexUrl = item.codexUrl
    if (current.imageSource === 'codex' || current.imageUrl === null) {
      input.imageUrl = item.imageUrl
      input.imageSource = item.imageUrl ? 'codex' : null
    }
    return c.json(repo.update(current.id, input))
  })

  admin.post('/uploads', async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.parseBody()
    } catch {
      return fail(c, 400, { error: 'Envio inválido', field: 'imageUrl' })
    }
    const file = body.file
    if (!(file instanceof File)) {
      return fail(c, 400, { error: 'Selecione um arquivo de imagem', field: 'imageUrl' })
    }
    try {
      return c.json({ url: await uploads.save(file) }, 201)
    } catch (err) {
      if (err instanceof UploadError) return fail(c, 400, { error: err.message, field: 'imageUrl' })
      throw err
    }
  })

  app.route('/api/admin', admin)

  app.all('/api/*', (c) => fail(c, 404, { error: 'Rota não encontrada' }))

  // ---------- Uploads públicos ----------

  app.get('/uploads/:name', async (c) => {
    const file = await uploads.read(c.req.param('name'))
    if (!file) return c.notFound()
    c.header('Content-Type', file.type)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    if (file.type === 'image/svg+xml') {
      c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    }
    return c.body(file.body as Uint8Array<ArrayBuffer>)
  })

  // ---------- SPA buildado ----------

  if (config.distDir) {
    const distDir = config.distDir
    app.use(
      '*',
      serveStatic({
        root: path.relative(process.cwd(), distDir),
        // Arquivos em /assets têm hash no nome, então podem ser cacheados para sempre.
        onFound: (filePath, c) => {
          if (filePath.includes('/assets/')) {
            c.header('Cache-Control', 'public, max-age=31536000, immutable')
          }
        },
      }),
    )
    app.get('*', async (c) => {
      try {
        return c.html(await readFile(path.join(distDir, 'index.html'), 'utf8'))
      } catch {
        return c.text('Front não buildado: rode `npm run build`.', 503)
      }
    })
  }

  return app
}
