import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import {
  UPLOAD_PATH_RE,
  campaignInputSchema,
  loginInputSchema,
  isHttpsUrl,
  orderInputSchema,
  toApiError,
} from '../shared/schemas.ts'
import type { CampaignInput } from '../shared/schemas.ts'
import type { AdminCampaign, ApiError, PublicCampaign } from '../shared/types.ts'
import {
  SESSION_TTL_SECONDS,
  createLoginLimiter,
  createSessionToken,
  deriveSessionKey,
  parseSessionToken,
  passwordMatches,
  sessionCookieName,
} from './auth.ts'
import type { LoginLimiter, SessionStore } from './auth.ts'
import { CodexUnavailableError } from './codex.ts'
import type { CodexClient } from './codex.ts'
import type { Config } from './config.ts'
import { DuplicateCodexSlugError } from './repo.ts'
import type { CampaignRepo, StoredCampaign } from './repo.ts'
import { createFoundryStatusClient, UnsafeFoundryUrlError } from './foundry.ts'
import type { FoundryStatus } from './foundry.ts'
import type { createFoundryStatusClient as FoundryStatusClientFactory } from './foundry.ts'
import { createCoverFetcher } from './covers.ts'
import type { CoverFetcher } from './covers.ts'
import { createSafeGet } from './net-safety.ts'
import { createRateLimiter, rateLimit } from './rate-limit.ts'
import type { RateLimiter } from './rate-limit.ts'
import { securityHeaders } from './security-headers.ts'
import { MAX_UPLOAD_BYTES, UploadError, UploadQuotaError } from './uploads.ts'
import type { UploadStore } from './uploads.ts'

export interface AuditEvent {
  action: string
  ip: string
  ok?: boolean
  target?: string
}

/** Log estruturado de ações administrativas; nunca recebe senhas, tokens ou corpos de requisição. */
export function defaultAudit(event: AuditEvent): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), type: 'audit', ...event }))
}

const JSON_BODY_LIMIT = 64 * 1024
// Margem para o overhead do multipart além do arquivo.
const UPLOAD_BODY_LIMIT = MAX_UPLOAD_BYTES + 64 * 1024

export interface AppDeps {
  config: Pick<Config, 'adminPassword' | 'sessionSecret' | 'cookieSecure' | 'trustedProxy'> &
    Partial<Pick<Config, 'trustedProxyHops' | 'publicOrigin' | 'rateLimitPublic' | 'rateLimitAdmin'>> & {
      distDir?: string | null
    }
  repo: CampaignRepo
  codex: CodexClient
  uploads: UploadStore
  sessions: SessionStore
  foundryStatus?: ReturnType<typeof FoundryStatusClientFactory>
  covers?: CoverFetcher
  limiter?: LoginLimiter
  publicLimiter?: RateLimiter
  adminLimiter?: RateLimiter
  audit?: (event: AuditEvent) => void
}

/** Só links https chegam à home; registros legados com http: ficam guardados, mas ocultos. */
const safeLink = (url: string | null) => (url && isHttpsUrl(url) ? url : null)
const safeImage = (url: string | null) =>
  url && (isHttpsUrl(url) || UPLOAD_PATH_RE.test(url)) ? url : null

function toPublic(c: StoredCampaign, foundryStatus: FoundryStatus | null): PublicCampaign {
  return {
    id: c.id,
    title: c.title,
    tagline: c.tagline,
    system: foundryStatus
      ? foundryStatus.tableActive
        ? foundryStatus.system || c.system
        : ''
      : c.system,
    status: statusLabel(foundryStatus),
    ongoing: c.ongoing,
    imageUrl: safeImage(c.imageUrl),
    foundryUrl: safeLink(c.foundryUrl),
    codexUrl: safeLink(c.codexUrl),
  }
}

function statusLabel(status: FoundryStatus | null): string {
  if (!status) return 'NÃO CONFIGURADO'
  if (status.serverAvailable !== true) return 'INDISPONÍVEL'
  return status.tableActive ? 'ATIVO' : 'INATIVO'
}

function toInput(c: StoredCampaign): CampaignInput {
  return {
    source: c.source,
    codexSlug: c.codexSlug,
    title: c.title,
    tagline: c.tagline,
    system: c.system,
    ongoing: c.ongoing,
    imageUrl: c.imageUrl,
    imageSource: c.imageSource,
    foundryUrl: c.foundryUrl,
    codexUrl: c.codexUrl,
  }
}

const fail = (c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 502 | 503 | 507,
  body: ApiError) =>
  c.json(body, status)

export function createApp(deps: AppDeps) {
  const { config, repo, codex, uploads, sessions } = deps
  const foundryStatus = deps.foundryStatus ?? createFoundryStatusClient()
  const covers = deps.covers ?? createCoverFetcher(createSafeGet())
  const limiter = deps.limiter ?? createLoginLimiter()
  const publicLimiter = deps.publicLimiter ?? createRateLimiter({ limit: config.rateLimitPublic ?? 120 })
  const adminLimiter = deps.adminLimiter ?? createRateLimiter({ limit: config.rateLimitAdmin ?? 60 })
  const auditLog = deps.audit ?? defaultAudit
  const sessionKey = deriveSessionKey(config.sessionSecret, config.adminPassword)
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

  /**
   * Atrás de proxy confiável, o IP real é o adicionado pelo último proxy: conta-se
   * `trustedProxyHops` entradas a partir do FIM de X-Forwarded-For. O início da lista é
   * escolhido pelo cliente e nunca é usado.
   */
  function clientIp(c: Context): string {
    if (config.trustedProxy) {
      const chain = (c.req.header('x-forwarded-for') ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      const hops = config.trustedProxyHops ?? 1
      const forwarded = chain[chain.length - hops]
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

  const audit = (c: Context, action: string, extra: { ok?: boolean; target?: string } = {}) =>
    auditLog({ action, ip: clientIp(c), ...extra })

  /** Rotas com corpo JSON exigem Content-Type: application/json (bloqueia formulários cross-site). */
  const requireJson: MiddlewareHandler = async (c, next) => {
    const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') {
      return fail(c, 415, { error: 'Content-Type deve ser application/json' })
    }
    await next()
  }

  const tooLarge = (c: Context) => fail(c, 413, { error: 'Requisição grande demais' })
  const jsonLimit = bodyLimit({ maxSize: JSON_BODY_LIMIT, onError: tooLarge })
  const uploadLimit = bodyLimit({ maxSize: UPLOAD_BODY_LIMIT, onError: tooLarge })

  /**
   * Capas do codex são copiadas para /uploads: o navegador do visitante não contata o codex.
   * Só aceita URLs da origem do codex; falhas nunca deixam a URL externa gravada.
   */
  async function localizeCover(
    input: CampaignInput,
    fallback: { imageUrl: string | null; imageSource: CampaignInput['imageSource'] } | null,
  ): Promise<CampaignInput> {
    const url = input.imageUrl
    if (input.source !== 'codex' || input.imageSource !== 'codex' || !url || UPLOAD_PATH_RE.test(url)) {
      return input
    }
    if (!codex.baseUrl || new URL(url).origin !== new URL(codex.baseUrl).origin) {
      return { ...input, imageSource: 'url' }
    }
    try {
      const local = await uploads.save(await covers(url))
      return { ...input, imageUrl: local, imageSource: 'codex' }
    } catch (err) {
      console.warn(`[gateway] capa do codex não importada: ${(err as Error).message}`)
      return { ...input, ...(fallback ?? { imageUrl: null, imageSource: null }) }
    }
  }

  app.use('*', securityHeaders(isHttps))

  // ---------- Público ----------

  app.use('/api/campaigns', rateLimit(publicLimiter, clientIp))
  app.use('/uploads/*', rateLimit(publicLimiter, clientIp))

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/campaigns', async (c) => {
    c.header('Cache-Control', 'no-store')
    const campaigns = await Promise.all(
      repo.list().map(async (campaign) => toPublic(campaign, await foundryStatus.get(campaign.foundryUrl))),
    )
    return c.json(campaigns)
  })

  // ---------- Admin: sessão ----------

  const admin = new Hono()

  app.use('/api/admin/*', rateLimit(adminLimiter, clientIp))

  // CSRF: escritas só passam com prova de mesma origem (Origin ou, sem ele, Sec-Fetch-Site).
  admin.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin')
      const fetchSite = c.req.header('sec-fetch-site')
      let allowed = false
      if (origin) {
        if (config.publicOrigin) {
          allowed = origin === config.publicOrigin
        } else {
          try {
            allowed = new URL(origin).host === c.req.header('host')
          } catch {
            allowed = false
          }
        }
      } else if (fetchSite) {
        allowed = fetchSite === 'same-origin'
      }
      if (!allowed) return fail(c, 403, { error: 'Origem não permitida' })
    }
    await next()
  })

  // Corpos JSON são pequenos; o upload tem limite próprio, aplicado depois da autenticação.
  admin.use('*', (c, next) => (c.req.path.endsWith('/uploads') ? next() : jsonLimit(c, next)))

  admin.post('/login', requireJson, async (c) => {
    const ip = clientIp(c)
    const wait = limiter.retryAfter(ip)
    if (wait > 0) {
      c.header('Retry-After', String(wait))
      return fail(c, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' })
    }
    const parsed = loginInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    if (!passwordMatches(parsed.data.password, config.adminPassword)) {
      limiter.recordFailure(ip)
      audit(c, 'login', { ok: false })
      return fail(c, 401, { error: 'Senha inválida' })
    }
    limiter.reset(ip)
    audit(c, 'login', { ok: true })
    const secure = isHttps(c)
    setCookie(c, sessionCookieName(secure), createSessionToken(sessions.create(), sessionKey), {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    return c.body(null, 204)
  })

  admin.post('/logout', (c) => {
    const secure = isHttps(c)
    const name = sessionCookieName(secure)
    const id = parseSessionToken(getCookie(c, name), sessionKey)
    if (id) sessions.revoke(id)
    audit(c, 'logout')
    deleteCookie(c, name, { path: '/', secure })
    return c.body(null, 204)
  })

  // Todas as rotas abaixo exigem sessão.
  admin.use('*', async (c, next) => {
    const id = parseSessionToken(getCookie(c, sessionCookieName(isHttps(c))), sessionKey)
    if (!id || !sessions.isValid(id)) {
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
    const result: AdminCampaign[] = await Promise.all(
      campaigns.map(async (x) => ({
        ...x,
        status: statusLabel(await foundryStatus.get(x.foundryUrl)),
        missingInCodex:
          x.source === 'manual' ? false : codexSlugs ? !codexSlugs.has(x.codexSlug!) : null,
      })),
    )
    return c.json(result)
  })

  admin.post('/campaigns', requireJson, async (c) => {
    const parsed = campaignInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    if (parsed.data.foundryUrl) {
      try {
        await foundryStatus.assertSafeUrl(parsed.data.foundryUrl)
      } catch (err) {
        if (err instanceof UnsafeFoundryUrlError) {
          return fail(c, 400, { error: err.message, field: 'foundryUrl' })
        }
        throw err
      }
    }
    try {
      const created = repo.create(await localizeCover(parsed.data, null))
      audit(c, 'campaign.create', { target: created.id })
      return c.json({ ...created, status: statusLabel(await foundryStatus.get(created.foundryUrl)) }, 201)
    } catch (err) {
      if (err instanceof DuplicateCodexSlugError) {
        return fail(c, 409, { error: err.message, field: 'codexSlug' })
      }
      throw err
    }
  })

  admin.put('/campaigns/order', requireJson, async (c) => {
    const parsed = orderInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    repo.reorder(parsed.data.ids)
    audit(c, 'campaign.reorder')
    return c.body(null, 204)
  })

  admin.put('/campaigns/:id', requireJson, async (c) => {
    const previous = repo.get(c.req.param('id'))
    if (!previous) return fail(c, 404, { error: 'Campanha não encontrada' })
    const parsed = campaignInputSchema.safeParse(await readJson(c))
    if (!parsed.success) return fail(c, 400, toApiError(parsed.error))
    if (parsed.data.foundryUrl) {
      try {
        await foundryStatus.assertSafeUrl(parsed.data.foundryUrl)
      } catch (err) {
        if (err instanceof UnsafeFoundryUrlError) {
          return fail(c, 400, { error: err.message, field: 'foundryUrl' })
        }
        throw err
      }
    }
    try {
      const updated = repo.update(
        previous.id,
        await localizeCover(parsed.data, { imageUrl: previous.imageUrl, imageSource: previous.imageSource }),
      )
      if (!updated) return fail(c, 404, { error: 'Campanha não encontrada' })
      audit(c, 'campaign.update', { target: updated.id })
      if (previous.imageUrl !== updated.imageUrl) await uploads.remove(previous.imageUrl)
      return c.json({ ...updated, status: statusLabel(await foundryStatus.get(updated.foundryUrl)) })
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
    audit(c, 'campaign.delete', { target: removed.id })
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
    const updated = repo.update(
      current.id,
      await localizeCover(input, { imageUrl: current.imageUrl, imageSource: current.imageSource }),
    )
    if (updated) {
      audit(c, 'campaign.resync', { target: updated.id })
      if (current.imageUrl !== updated.imageUrl) await uploads.remove(current.imageUrl)
    }
    return c.json(updated ? { ...updated, status: statusLabel(await foundryStatus.get(updated.foundryUrl)) } : null)
  })

  admin.post('/uploads', uploadLimit, async (c) => {
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
      const url = await uploads.save(file)
      audit(c, 'upload.create', { target: url })
      return c.json({ url }, 201)
    } catch (err) {
      if (err instanceof UploadQuotaError) return fail(c, 507, { error: err.message, field: 'imageUrl' })
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
      // SVGs legados (novos envios não são aceitos) só rodam em sandbox.
      c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    } else {
      c.header('Content-Disposition', 'inline')
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
