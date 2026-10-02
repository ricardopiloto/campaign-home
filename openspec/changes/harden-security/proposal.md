# Proposal

## Why

A revisão de segurança do gateway encontrou lacunas relevantes na área administrativa exposta à internet: ausência de cabeçalhos de segurança (clickjacking, sem CSP), sessão sem revogação, limite de login contornável via `X-Forwarded-For`, CSRF dependente de um único mecanismo, SVG não sanitizado e URLs externas sem restrição de esquema/porta. Corrigir agora reduz o risco de tomada da conta admin e de abuso do servidor antes de a exposição crescer.

## What Changes

- Enviar cabeçalhos de segurança HTTP (CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy`, HSTS sob HTTPS) em todas as respostas.
- Tornar a sessão admin revogável (logout e troca de senha invalidam tokens), com TTL menor e cookie `__Host-` sob HTTPS.
- Exigir senha de admin forte na inicialização e endurecer o rate limit de login (IP do cliente correto atrás de proxy, backoff e limite global).
- Reforçar CSRF nas escritas admin: exigir `Origin` ou `Sec-Fetch-Site` same-origin e `Content-Type: application/json` nas rotas JSON.
- Remover SVG dos uploads aceitos, limitar corpo do upload antes de lê-lo, limitar dimensões de imagem e impor cota de disco; remover uploads órfãos.
- Exigir `https:` para `imageUrl`, `foundryUrl`, `codexUrl` e `CODEX_BASE_URL` em produção; restringir porta e completar as faixas de IP bloqueadas na consulta de status do Foundry.
- Adicionar rate limit geral nos endpoints públicos e admin, e log de auditoria das ações administrativas.
- **BREAKING**: senhas de admin com menos de 12 caracteres impedem o start; uploads SVG e URLs `http:` deixam de ser aceitos em novos cadastros; sessões existentes são invalidadas no deploy.

## Capabilities

### New Capabilities
- `admin-session-security`: autenticação, sessão revogável, proteção contra força bruta, CSRF e auditoria da área admin.
- `http-hardening`: cabeçalhos de segurança, limites de taxa e de corpo de requisição nos endpoints públicos e admin.
- `upload-security`: regras de aceitação, armazenamento e serviço de imagens enviadas.
- `outbound-url-safety`: restrições a URLs externas persistidas ou acessadas pelo servidor (Foundry, Codex, imagens).

### Modified Capabilities

## Impact

- Código: `server/app.ts`, `auth.ts`, `config.ts`, `uploads.ts`, `foundry.ts`, `codex.ts`, `db.ts` (migração para sessões revogadas e cota), `shared/schemas.ts`, formulários admin em `src/admin/`.
- Dependências: possível adição de biblioteca de processamento de imagem e de parsing de IP; sem novas dependências obrigatórias de runtime além dessas.
- Operação: novas variáveis (`TRUSTED_PROXY_HOPS`, limites), exigência de HTTPS em produção, documentação no README e `SECURITY.md`.
- Testes: `server/app.test.ts` e `unit.test.ts` ampliados.
