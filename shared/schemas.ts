// Validação compartilhada entre servidor e formulários do admin (mesmas regras, mesmas mensagens).
import { z } from 'zod'
import type { ApiError } from './types.ts'

export const UPLOAD_PATH_RE = /^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp|svg)$/

/** Só https e sem credenciais embutidas (http abre espaço a downgrade e rastreamento). */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

const trimmedText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} deve ter no máximo ${max} caracteres`)

const optionalHttpsUrl = (message: string) =>
  z
    .string()
    .max(2048, 'URL longa demais')
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || isHttpsUrl(v), message)

export const campaignInputSchema = z
  .object({
    source: z.enum(['codex', 'manual'], 'Origem inválida'),
    codexSlug: z
      .string()
      .trim()
      .max(48)
      .nullish()
      .transform((v) => v || null),
    title: trimmedText(120, 'O nome').min(1, 'O nome é obrigatório'),
    tagline: trimmedText(300, 'A tagline').default(''),
    system: trimmedText(60, 'O sistema').default(''),
    ongoing: z.boolean().default(false),
    imageUrl: z
      .string()
      .max(2048, 'URL longa demais')
      .nullish()
      .transform((v) => v?.trim() || null)
      .refine(
        (v) => v === null || isHttpsUrl(v) || UPLOAD_PATH_RE.test(v),
        'A imagem deve ser uma URL https válida',
      ),
    imageSource: z.enum(['codex', 'upload', 'url']).nullish(),
    foundryUrl: optionalHttpsUrl('O link do Foundry deve ser uma URL https válida'),
    codexUrl: optionalHttpsUrl('O link do Codex deve ser uma URL https válida'),
  })
  .superRefine((data, ctx) => {
    if (data.source === 'codex' && !data.codexSlug) {
      ctx.addIssue({
        code: 'custom',
        path: ['codexSlug'],
        message: 'Selecione uma campanha do codex',
      })
    }
    if (!data.foundryUrl && !data.codexUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['foundryUrl'],
        message: 'Informe ao menos um link (Foundry ou Codex)',
      })
    }
  })
  .transform((data) => ({
    ...data,
    codexSlug: data.source === 'codex' ? data.codexSlug : null,
    // A origem da imagem é derivada, não confiada ao cliente.
    imageSource:
      data.imageUrl === null
        ? null
        : data.imageSource === 'codex' && data.source === 'codex'
          ? ('codex' as const)
          : UPLOAD_PATH_RE.test(data.imageUrl)
            ? ('upload' as const)
            : ('url' as const),
  }))

export type CampaignInput = z.output<typeof campaignInputSchema>
export type CampaignFormValues = z.input<typeof campaignInputSchema>

export const orderInputSchema = z.object({
  ids: z.array(z.string().min(1)).max(500),
})

export const loginInputSchema = z.object({
  password: z.string().min(1, 'Informe a senha').max(512),
})

/** Converte o primeiro problema de validação no formato de erro da API. */
export function toApiError(error: z.ZodError): ApiError {
  const issue = error.issues[0]
  const field = issue?.path[0]
  return {
    error: issue?.message ?? 'Dados inválidos',
    ...(typeof field === 'string' ? { field } : {}),
  }
}
