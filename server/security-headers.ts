import type { Context, MiddlewareHandler } from 'hono'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Cabeçalhos de segurança em todas as respostas. Não sobrescreve um cabeçalho que a rota já
 * definiu (ex.: a CSP de sandbox dos SVGs legados em /uploads).
 */
export function securityHeaders(isHttps: (c: Context) => boolean): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const set = (name: string, value: string) => {
      if (!c.res.headers.has(name)) c.header(name, value)
    }
    set('Content-Security-Policy', CSP)
    set('X-Content-Type-Options', 'nosniff')
    set('Referrer-Policy', 'strict-origin-when-cross-origin')
    set('X-Frame-Options', 'DENY')
    set('Cross-Origin-Opener-Policy', 'same-origin')
    set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // Sem includeSubDomains: outros subdomínios do mesmo domínio podem não ter HTTPS.
    if (isHttps(c)) set('Strict-Transport-Security', 'max-age=31536000')
  }
}
