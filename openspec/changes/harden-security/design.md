# Design

## Context

Hono + SQLite em Node ≥ 24, sem build do servidor. Hoje: sessão é `exp.hmac` sem estado (`server/auth.ts`), o IP de cliente vem do primeiro valor de `X-Forwarded-For` (`server/app.ts`), o CSRF compara `Origin` com `Host` e aceita requisições sem `Origin`, o SVG é aceito com validação superficial (`server/uploads.ts`), e `isHttpUrl` aceita `http:` (`shared/schemas.ts`). Motivação em proposal.md.

## Goals / Non-Goals

**Goals:**
- Fechar os achados de alta e média prioridade da revisão, cada um com teste automatizado.
- Manter a injeção de dependências de `createApp` para testar sem rede.

**Non-Goals:**
- MFA/TOTP, múltiplos usuários ou RBAC (registrado como evolução futura).
- Migrar uploads para domínio/CDN separado.
- WAF ou proteção de rede (responsabilidade do proxy/Cloudflare).

## Decisions

1. **Cabeçalhos via `hono/secure-headers`** em middleware global, com CSP montada em `server/security-headers.ts`. Alternativa: configurar só no proxy — rejeitada, pois o app deve ser seguro sozinho. O front usa `style` inline do React em poucos pontos: se necessário, `style-src 'unsafe-inline'` apenas para estilos, nunca para scripts.
2. **Sessões em SQLite** (migração nova em `MIGRATIONS`, tabela `sessions(id, expires_at, revoked_at)`), token `id.hmac`, com a chave HMAC derivada de `HMAC(SESSION_SECRET, hash(ADMIN_PASSWORD))` para que trocar a senha invalide tudo. Alternativa: lista de revogação em memória — perde-se no restart. Limpeza de expiradas na inicialização e periódica.
3. **IP do cliente por saltos**: `TRUSTED_PROXY_HOPS` (padrão 1) lê `X-Forwarded-For` a partir do fim. Substitui o booleano para uso do cabeçalho, mantendo `TRUSTED_PROXY` para ativar. Limiter ganha backoff exponencial por chave e contador global.
4. **Origem pública**: nova `PUBLIC_ORIGIN` opcional; se ausente, usa o `Host` validado. CSRF exige `Origin` ou `Sec-Fetch-Site`. Como o front só faz `fetch` same-origin com `application/json` ou `FormData`, nada muda para o usuário.
5. **Uploads**: remover SVG do aceite; usar `sharp` para ler metadados (limite de pixels via `limitInputPixels`), reencodar e descartar EXIF. Alternativa: só checar cabeçalhos — não remove payloads poliglotas. `bodyLimit` do Hono antes do `parseBody`. Cota por soma de tamanhos no diretório. Limpeza: varredura a cada hora comparando com `repo` (novo método `referencedUploads()`).
6. **Validação de IP** com `ipaddr.js` (range `unicast` apenas) em vez de listas manuais; portas permitidas via `FOUNDRY_ALLOWED_PORTS` (padrão `443`).
7. **Capas do codex** baixadas por cliente fetch com os mesmos limites do cliente de status (https, IP público, tamanho, timeout) e passadas pelo pipeline de upload.
8. **Rate limit geral**: middleware em memória por IP (janela deslizante), reutilizando o limiter; limites configuráveis por env.
9. **Auditoria**: função `audit(event)` que emite uma linha JSON no stdout; nunca recebe corpos de requisição.
10. **Registros legados**: sem migração destrutiva; o schema rejeita `http:` em novas escritas e o front filtra `http:` na renderização.

## Risks / Trade-offs

- [CSP quebrar a SPA ou as fontes] → testar com `npm run build && npm start` no navegador; ativar primeiro em `Content-Security-Policy-Report-Only` no ambiente real se houver dúvida.
- [`sharp` adiciona binário nativo à imagem Docker] → usar imagem `node:24-slim` (glibc), verificar build; fallback é rejeitar apenas o que não decodifica.
- [`TRUSTED_PROXY_HOPS` errado bloqueia todos os usuários atrás de um único IP] → documentar no README e logar o IP resolvido no primeiro login.
- [Invalidar sessões no deploy] → admin precisa logar de novo; aceitável e comunicado.
- [Bloquear `http:` exige edição manual de registros legados] → o front oculta o link e o admin vê aviso na listagem.
- [Rate limit em memória não é compartilhado entre réplicas] → o deploy atual tem uma única instância; documentado.

## Migration Plan

1. Deploy com nova migração (tabela `sessions`); sessões antigas deixam de valer.
2. Definir `ADMIN_PASSWORD` ≥ 12 caracteres, `TRUSTED_PROXY_HOPS` e `COOKIE_SECURE` conforme o proxy.
3. Reenviar imagens SVG, se houver, como PNG/WebP (legados seguem servidos com sandbox).
4. Rollback: voltar a imagem anterior; a tabela `sessions` extra é inofensiva.

## Open Questions

- Valores finais dos limites de taxa e da cota de uploads (propostos: 120 req/min público, 60 req/min admin, 200 MB).
