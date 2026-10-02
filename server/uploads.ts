import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { UPLOAD_PATH_RE } from '../shared/schemas.ts'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 4096
export const DEFAULT_QUOTA_BYTES = 200 * 1024 * 1024
export const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000

// SVG só é servido (arquivos legados); novos envios não o aceitam.
const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
} as const

type Ext = keyof typeof TYPES
type AcceptedExt = 'png' | 'jpg' | 'webp'

const EXT_BY_MIME: Record<string, AcceptedExt> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export class UploadError extends Error {}
export class UploadQuotaError extends Error {
  constructor() {
    super('Limite de armazenamento de imagens atingido')
  }
}

/** Extensão de arquivo aceita para um tipo MIME de imagem; null se não for aceito. */
export function extForMime(mime: string): AcceptedExt | null {
  return EXT_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ?? null
}

function extFromName(name: string): Ext | null {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  return ext in TYPES ? (ext as Ext) : null
}

/** Confere a assinatura do arquivo para não confiar só no tipo declarado. */
function contentMatches(ext: AcceptedExt, bytes: Uint8Array): boolean {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)
  switch (ext) {
    case 'png':
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'jpg':
      return starts([0xff, 0xd8, 0xff])
    case 'webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)
  }
}

/** Valida dimensões pelo cabeçalho e reencoda, descartando metadados (EXIF) e dados embutidos. */
async function sanitizeImage(ext: AcceptedExt, bytes: Uint8Array): Promise<Buffer> {
  const limitInputPixels = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION
  try {
    const { width, height } = await sharp(bytes, { limitInputPixels: false }).metadata()
    if (!width || !height) throw new UploadError('Não foi possível ler as dimensões da imagem')
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw new UploadError(`A imagem deve ter no máximo ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} px`)
    }
    // rotate() aplica a orientação do EXIF antes de ele ser descartado.
    const pipeline = sharp(bytes, { limitInputPixels }).rotate()
    if (ext === 'png') return await pipeline.png().toBuffer()
    if (ext === 'jpg') return await pipeline.jpeg({ quality: 90 }).toBuffer()
    return await pipeline.webp({ quality: 90 }).toBuffer()
  } catch (err) {
    if (err instanceof UploadError) throw err
    throw new UploadError('O conteúdo do arquivo não corresponde ao formato informado')
  }
}

export function createUploadStore(
  dir: string,
  { quotaBytes = DEFAULT_QUOTA_BYTES, now = Date.now }: { quotaBytes?: number; now?: () => number } = {},
) {
  async function usedBytes(): Promise<number> {
    let total = 0
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      total += await stat(path.join(dir, name)).then((s) => s.size, () => 0)
    }
    return total
  }

  async function save(file: File): Promise<string> {
    if (file.size === 0) throw new UploadError('Arquivo vazio')
    if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('A imagem deve ter no máximo 5 MB')
    const ext = EXT_BY_MIME[file.type]
    if (!ext || extFromName(file.name) !== ext) {
      throw new UploadError('Formato não permitido: use JPEG, PNG ou WebP')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!contentMatches(ext, bytes)) {
      throw new UploadError('O conteúdo do arquivo não corresponde ao formato informado')
    }
    const clean = await sanitizeImage(ext, bytes)
    await mkdir(dir, { recursive: true })
    if ((await usedBytes()) + clean.length > quotaBytes) throw new UploadQuotaError()
    const name = `${randomUUID()}.${ext}`
    await writeFile(path.join(dir, name), clean)
    return `/uploads/${name}`
  }

  /** Remove um upload a partir da URL pública; ignora URLs que não são uploads. */
  async function remove(url: string | null): Promise<void> {
    if (!url || !UPLOAD_PATH_RE.test(url)) return
    await unlink(path.join(dir, path.basename(url))).catch(() => {})
  }

  /** Lê um upload pelo nome do arquivo; null se inválido ou inexistente. */
  async function read(name: string): Promise<{ body: Uint8Array; type: string } | null> {
    if (!UPLOAD_PATH_RE.test(`/uploads/${name}`)) return null
    try {
      const body = await readFile(path.join(dir, name))
      return { body, type: TYPES[extFromName(name)!] }
    } catch {
      return null
    }
  }

  /** Apaga arquivos antigos que nenhuma campanha referencia (envios abandonados). */
  async function sweepOrphans(
    referenced: ReadonlySet<string>,
    maxAgeMs = ORPHAN_MAX_AGE_MS,
  ): Promise<number> {
    let removed = 0
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!UPLOAD_PATH_RE.test(`/uploads/${name}`) || referenced.has(name)) continue
      const info = await stat(path.join(dir, name)).catch(() => null)
      if (!info || now() - info.mtimeMs < maxAgeMs) continue
      await unlink(path.join(dir, name)).then(() => removed++, () => {})
    }
    return removed
  }

  return { save, remove, read, sweepOrphans }
}

export type UploadStore = ReturnType<typeof createUploadStore>
