import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CampaignInput } from '../shared/schemas.ts'
import type { AdminCampaign, CampaignSource, ImageSource } from '../shared/types.ts'

interface CampaignRow {
  id: string
  source: CampaignSource
  codex_slug: string | null
  title: string
  tagline: string
  system: string
  status: string
  ongoing: number
  image_url: string | null
  image_source: ImageSource | null
  foundry_url: string | null
  codex_url: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type StoredCampaign = Omit<AdminCampaign, 'missingInCodex'>

export class DuplicateCodexSlugError extends Error {
  constructor() {
    super('Esta campanha do codex já está vinculada')
  }
}

function fromRow(row: CampaignRow): StoredCampaign {
  return {
    id: row.id,
    source: row.source,
    codexSlug: row.codex_slug,
    title: row.title,
    tagline: row.tagline,
    system: row.system,
    status: row.status,
    ongoing: row.ongoing === 1,
    imageUrl: row.image_url,
    imageSource: row.image_source,
    foundryUrl: row.foundry_url,
    codexUrl: row.codex_url,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: campaigns\.codex_slug/.test(err.message)
}

function params(input: CampaignInput) {
  return {
    source: input.source,
    codex_slug: input.codexSlug,
    title: input.title,
    tagline: input.tagline,
    system: input.system,
    status: input.status,
    ongoing: input.ongoing ? 1 : 0,
    image_url: input.imageUrl,
    image_source: input.imageSource,
    foundry_url: input.foundryUrl,
    codex_url: input.codexUrl,
  }
}

export function createRepo(db: DatabaseSync, now: () => Date = () => new Date()) {
  const selectAll = db.prepare(
    'SELECT * FROM campaigns ORDER BY sort_order ASC, created_at ASC, id ASC',
  )
  const selectOne = db.prepare('SELECT * FROM campaigns WHERE id = ?')

  function get(id: string): StoredCampaign | null {
    const row = selectOne.get(id) as CampaignRow | undefined
    return row ? fromRow(row) : null
  }

  function list(): StoredCampaign[] {
    return (selectAll.all() as unknown as CampaignRow[]).map(fromRow)
  }

  function create(input: CampaignInput): StoredCampaign {
    const id = randomUUID()
    const ts = now().toISOString()
    const { next } = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM campaigns')
      .get() as { next: number }
    try {
      db.prepare(
        `INSERT INTO campaigns (id, source, codex_slug, title, tagline, system, status, ongoing,
           image_url, image_source, foundry_url, codex_url, sort_order, created_at, updated_at)
         VALUES (:id, :source, :codex_slug, :title, :tagline, :system, :status, :ongoing,
           :image_url, :image_source, :foundry_url, :codex_url, :sort_order, :ts, :ts)`,
      ).run({ ...params(input), id, sort_order: next, ts })
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateCodexSlugError()
      throw err
    }
    return get(id)!
  }

  function update(id: string, input: CampaignInput): StoredCampaign | null {
    try {
      const result = db
        .prepare(
          `UPDATE campaigns SET source = :source, codex_slug = :codex_slug, title = :title,
             tagline = :tagline, system = :system, status = :status, ongoing = :ongoing,
             image_url = :image_url, image_source = :image_source, foundry_url = :foundry_url,
             codex_url = :codex_url, updated_at = :ts
           WHERE id = :id`,
        )
        .run({ ...params(input), id, ts: now().toISOString() })
      if (result.changes === 0) return null
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateCodexSlugError()
      throw err
    }
    return get(id)
  }

  function remove(id: string): StoredCampaign | null {
    const existing = get(id)
    if (!existing) return null
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id)
    return existing
  }

  /**
   * Aplica a ordem dada. Ids desconhecidos são ignorados; campanhas omitidas
   * vão para o fim, mantendo a ordem relativa atual.
   */
  function reorder(ids: string[]): void {
    const current = list().map((c) => c.id)
    const known = new Set(current)
    const seen = new Set<string>()
    const ordered = ids.filter((id) => known.has(id) && !seen.has(id) && seen.add(id))
    const final = [...ordered, ...current.filter((id) => !seen.has(id))]
    const stmt = db.prepare('UPDATE campaigns SET sort_order = ? WHERE id = ?')
    db.exec('BEGIN')
    try {
      final.forEach((id, index) => stmt.run(index, id))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  function linkedSlugs(): Set<string> {
    const rows = db
      .prepare('SELECT codex_slug FROM campaigns WHERE codex_slug IS NOT NULL')
      .all() as { codex_slug: string }[]
    return new Set(rows.map((r) => r.codex_slug))
  }

  return { list, get, create, update, remove, reorder, linkedSlugs }
}

export type CampaignRepo = ReturnType<typeof createRepo>
