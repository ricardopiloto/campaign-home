import { z } from 'zod'
import type { CodexCampaign } from '../shared/types.ts'

export class CodexUnavailableError extends Error {}

const catalogItemSchema = z.object({
  slug: z.string().trim().min(1),
  nome: z.string().trim().min(1),
  sistema: z.string().nullish(),
  capa_url: z.string().nullish(),
})

const catalogSchema = z.object({ campanhas: z.array(z.unknown()) })

export interface CodexClientOptions {
  baseUrl: string | null
  fetch?: typeof fetch
  timeoutMs?: number
  cacheTtlMs?: number
  now?: () => number
}

/** Converte a resposta de /api/campanhas/catalogo em campanhas disponíveis. Itens inválidos são descartados. */
export function mapCatalog(baseUrl: string, body: unknown): CodexCampaign[] {
  const parsed = catalogSchema.safeParse(body)
  if (!parsed.success) {
    throw new CodexUnavailableError('Resposta do catálogo do codex em formato inesperado')
  }
  const items: CodexCampaign[] = []
  for (const raw of parsed.data.campanhas) {
    const item = catalogItemSchema.safeParse(raw)
    if (!item.success) continue
    const { slug, nome, sistema, capa_url } = item.data
    let imageUrl: string | null = null
    if (capa_url) {
      try {
        imageUrl = new URL(capa_url, `${baseUrl}/`).href
      } catch {
        imageUrl = null
      }
    }
    items.push({
      slug,
      title: nome,
      system: sistema?.trim() ?? '',
      imageUrl,
      codexUrl: `${baseUrl}/c/${encodeURIComponent(slug)}`,
    })
  }
  if (parsed.data.campanhas.length > 0 && items.length === 0) {
    throw new CodexUnavailableError('Nenhuma campanha válida no catálogo do codex')
  }
  return items
}

export function createCodexClient(options: CodexClientOptions) {
  const {
    baseUrl,
    fetch: fetchImpl = fetch,
    timeoutMs = 5000,
    cacheTtlMs = 60_000,
    now = Date.now,
  } = options
  let cache: { at: number; items: CodexCampaign[] } | null = null

  async function list({ fresh = false } = {}): Promise<CodexCampaign[]> {
    if (!baseUrl) throw new Error('Integração com o codex não configurada')
    if (!fresh && cache && now() - cache.at < cacheTtlMs) return cache.items

    let body: unknown
    try {
      const res = await fetchImpl(`${baseUrl}/api/campanhas/catalogo`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      body = await res.json()
    } catch (err) {
      throw new CodexUnavailableError(
        `Não foi possível carregar o catálogo do codex (${(err as Error).message})`,
      )
    }
    const items = mapCatalog(baseUrl, body)
    cache = { at: now(), items }
    return items
  }

  return { enabled: baseUrl !== null, baseUrl, list }
}

export type CodexClient = ReturnType<typeof createCodexClient>
