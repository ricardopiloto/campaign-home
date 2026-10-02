import path from 'node:path'

export interface Config {
  port: number
  dataDir: string
  adminPassword: string
  sessionSecret: string
  /** URL base do campaign-codex, sem barra final. null desativa o modo vinculado. */
  codexBaseUrl: string | null
  /** true/false força o atributo Secure do cookie; null decide pelo protocolo da requisição. */
  cookieSecure: boolean | null
  trustedProxy: boolean
  /** Quantos proxies confiáveis existem à frente do app (posição em X-Forwarded-For contada do fim). */
  trustedProxyHops: number
  /** Origem pública (ex.: https://gateway.exemplo.com.br) usada na checagem CSRF; null usa o Host. */
  publicOrigin: string | null
  production: boolean
  distDir: string
  rateLimitPublic: number
  rateLimitAdmin: number
  uploadQuotaBytes: number
  foundryAllowedPorts: number[]
}

export const MIN_PASSWORD_LENGTH = 12

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} inválida: use um inteiro positivo.`)
  return n
}

function parseBool(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === '') return null
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminPassword = env.ADMIN_PASSWORD ?? ''
  const sessionSecret = env.SESSION_SECRET ?? ''
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD não configurada: defina a senha do admin no ambiente.')
  }
  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD curta: use ao menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  }
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET ausente ou curta: use ao menos 32 caracteres aleatórios.')
  }

  const production = env.NODE_ENV === 'production'

  const codexRaw = env.CODEX_BASE_URL?.trim() ?? ''
  let codexBaseUrl: string | null = null
  if (codexRaw) {
    const url = new URL(codexRaw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('CODEX_BASE_URL deve ser uma URL http(s).')
    }
    if (production && url.protocol !== 'https:') {
      throw new Error('CODEX_BASE_URL deve usar https em produção.')
    }
    codexBaseUrl = url.href.replace(/\/+$/, '')
  }

  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT inválida.')
  }

  let publicOrigin: string | null = null
  const originRaw = env.PUBLIC_ORIGIN?.trim() ?? ''
  if (originRaw) {
    try {
      publicOrigin = new URL(originRaw).origin
    } catch {
      throw new Error('PUBLIC_ORIGIN inválida: use uma URL como https://gateway.exemplo.com.br.')
    }
  }

  const foundryAllowedPorts = (env.FOUNDRY_ALLOWED_PORTS ?? '443')
    .split(',')
    .map((p) => Number(p.trim()))
  if (foundryAllowedPorts.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
    throw new Error('FOUNDRY_ALLOWED_PORTS inválida: use portas separadas por vírgula.')
  }

  return {
    port,
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    adminPassword,
    sessionSecret,
    codexBaseUrl,
    // Em produção o cookie é Secure, salvo configuração explícita em contrário.
    cookieSecure: parseBool(env.COOKIE_SECURE) ?? (production ? true : null),
    trustedProxy: parseBool(env.TRUSTED_PROXY) ?? false,
    trustedProxyHops: parsePositiveInt(env.TRUSTED_PROXY_HOPS, 1, 'TRUSTED_PROXY_HOPS'),
    publicOrigin,
    production,
    distDir: path.resolve(env.DIST_DIR ?? './dist'),
    rateLimitPublic: parsePositiveInt(env.RATE_LIMIT_PUBLIC, 120, 'RATE_LIMIT_PUBLIC'),
    rateLimitAdmin: parsePositiveInt(env.RATE_LIMIT_ADMIN, 60, 'RATE_LIMIT_ADMIN'),
    uploadQuotaBytes: parsePositiveInt(env.UPLOAD_QUOTA_MB, 200, 'UPLOAD_QUOTA_MB') * 1024 * 1024,
    foundryAllowedPorts,
  }
}
