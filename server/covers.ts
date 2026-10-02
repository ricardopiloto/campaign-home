import { UploadError, extForMime, MAX_UPLOAD_BYTES } from './uploads.ts'
import type { SafeGet } from './net-safety.ts'

/** Baixa uma capa externa e a devolve como arquivo, para passar pelo pipeline de upload. */
export type CoverFetcher = (url: string) => Promise<File>

export function createCoverFetcher(safeGet: SafeGet): CoverFetcher {
  return async (raw) => {
    const res = await safeGet.get(new URL(raw), {
      timeoutMs: 5000,
      maxBytes: MAX_UPLOAD_BYTES,
      accept: 'image/png,image/jpeg,image/webp',
    })
    const type = res.contentType.split(';')[0].trim().toLowerCase()
    const ext = extForMime(type)
    if (res.status < 200 || res.status >= 300 || !ext) {
      throw new UploadError('A capa do codex não pôde ser baixada')
    }
    return new File([new Uint8Array(res.body)], `cover.${ext}`, { type })
  }
}
