import path from 'node:path'

export interface Config {
  port: number
  dataDir: string
  adminPassword: string
  sessionSecret: string
  adminSessionIdleTimeoutSeconds: number
  /** URL base do campaign-codex, sem barra final. null desativa o modo vinculado. */
  codexBaseUrl: string | null
  /** true/false força o atributo Secure do cookie; null decide pelo protocolo da requisição. */
  cookieSecure: boolean | null
  trustedProxy: boolean
  distDir: string
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
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET ausente ou curta: use ao menos 32 caracteres aleatórios.')
  }
  const idleRaw = env.ADMIN_SESSION_IDLE_TIMEOUT_SECONDS ?? '1800'
  const adminSessionIdleTimeoutSeconds = Number(idleRaw)
  if (!/^\d+$/.test(idleRaw) || !Number.isSafeInteger(adminSessionIdleTimeoutSeconds)
    || adminSessionIdleTimeoutSeconds <= 0 || !Number.isSafeInteger(adminSessionIdleTimeoutSeconds * 1000)) {
    throw new Error('ADMIN_SESSION_IDLE_TIMEOUT_SECONDS deve ser um inteiro positivo em segundos.')
  }

  const codexRaw = env.CODEX_BASE_URL?.trim() ?? ''
  let codexBaseUrl: string | null = null
  if (codexRaw) {
    const url = new URL(codexRaw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('CODEX_BASE_URL deve ser uma URL http(s).')
    }
    codexBaseUrl = url.href.replace(/\/+$/, '')
  }

  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT inválida.')
  }

  return {
    port,
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    adminPassword,
    sessionSecret,
    adminSessionIdleTimeoutSeconds,
    codexBaseUrl,
    cookieSecure: parseBool(env.COOKIE_SECURE),
    trustedProxy: parseBool(env.TRUSTED_PROXY) ?? false,
    distDir: path.resolve(env.DIST_DIR ?? './dist'),
  }
}
