import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { UPLOAD_PATH_RE } from '../shared/schemas.ts'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
} as const

type Ext = keyof typeof TYPES

const EXT_BY_MIME: Record<string, Ext> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

export class UploadError extends Error {}

function extFromName(name: string): Ext | null {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  return ext in TYPES ? (ext as Ext) : null
}

/** Confere a assinatura do arquivo para não confiar só no tipo declarado. */
function contentMatches(ext: Ext, bytes: Uint8Array): boolean {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)
  switch (ext) {
    case 'png':
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'jpg':
      return starts([0xff, 0xd8, 0xff])
    case 'webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)
    case 'svg': {
      const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart()
      return head.startsWith('<') && /<svg[\s>]/i.test(new TextDecoder().decode(bytes))
    }
  }
}

export function createUploadStore(dir: string) {
  async function save(file: File): Promise<string> {
    if (file.size === 0) throw new UploadError('Arquivo vazio')
    if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('A imagem deve ter no máximo 5 MB')
    const ext = EXT_BY_MIME[file.type]
    if (!ext || extFromName(file.name) !== ext) {
      throw new UploadError('Formato não permitido: use JPEG, PNG, WebP ou SVG')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!contentMatches(ext, bytes)) {
      throw new UploadError('O conteúdo do arquivo não corresponde ao formato informado')
    }
    await mkdir(dir, { recursive: true })
    const name = `${randomUUID()}.${ext}`
    await writeFile(path.join(dir, name), bytes)
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

  return { save, remove, read }
}

export type UploadStore = ReturnType<typeof createUploadStore>
