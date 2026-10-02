# Tasks

## 1. Cabeçalhos de segurança e limites de requisição

- [x] 1.1 Adicionar middleware global de cabeçalhos (CSP, `frame-ancestors`, `nosniff`, Referrer-Policy, HSTS sob HTTPS) e testes em `server/app.test.ts` cobrindo `/`, `/api/*` e `/uploads/*`; verificar com `npm test`.
- [x] 1.2 Validar a CSP no navegador (`npm run build && npm start`): home e `/admin` carregam fontes, estilos e imagens sem erros no console. Validado em 2026-10-02 com campanha e imagem temporárias: CSS aplicado, fontes Cormorant Garamond/Inter/JetBrains Mono carregadas, imagem `/uploads/*` com dimensões naturais e console sem erros ou avisos nas duas páginas.
- [x] 1.3 Adicionar `bodyLimit` (JSON 64 KB, upload 5 MB + overhead) e teste de 413 para JSON gigante e multipart acima do limite.
- [x] 1.4 Criar middleware de rate limit geral com `Retry-After` para `/api/campaigns`, `/uploads/*` e `/api/admin/*`, configurável por env; testar o 429 com relógio injetado.

## 2. Autenticação, sessão e CSRF

- [x] 2.1 Exigir `ADMIN_PASSWORD` ≥ 12 caracteres e `CODEX_BASE_URL` https em produção em `server/config.ts`; testes unitários de `loadConfig` para os casos válidos e inválidos.
- [x] 2.2 Adicionar migração `sessions` em `server/db.ts` e reescrever `server/auth.ts` com sessões revogáveis (id + HMAC derivado também da senha, TTL 24 h, cookie `__Host-` sob HTTPS); testar token após logout, expirado e após troca de senha.
- [x] 2.3 Implementar `TRUSTED_PROXY_HOPS` e extração do IP pelo fim de `X-Forwarded-For`, com backoff e limite global no login; testar cabeçalho forjado e ataque distribuído.
- [x] 2.4 Endurecer CSRF (exigir `Origin` ou `Sec-Fetch-Site`, `PUBLIC_ORIGIN` opcional, `Content-Type: application/json` nas rotas JSON → 415); testar POST sem Origin, origem distinta e `text/plain`, e confirmar que o front admin continua funcionando.
- [x] 2.5 Criar `audit()` e registrar as ações admin; testar que o log de login falho contém o IP e não contém a senha.

## 3. Uploads

- [x] 3.1 Remover SVG do aceite em `server/uploads.ts` e do formulário em `src/admin/CampaignForm.tsx`; manter o serviço legado com CSP sandbox. Testar 400 para `.svg` e sandbox para legado.
- [x] 3.2 Reencodar raster com `sharp` (limite de pixels 4096, remoção de EXIF) e testar imagem com EXIF e imagem de dimensões absurdas; verificar `npm run build` e a imagem Docker.
- [x] 3.3 Implementar cota de disco (507) e limpeza periódica de órfãos via `repo.referencedUploads()`; testar os dois comportamentos com diretório temporário.

## 4. URLs externas

- [x] 4.1 Restringir `imageUrl`, `foundryUrl` e `codexUrl` a `https:` sem credenciais em `shared/schemas.ts` (mensagens pt-BR) e filtrar `http:` legado em `Panel.tsx`; testar schemas e renderização.
- [x] 4.2 Substituir as listas de IP de `server/foundry.ts` por `ipaddr.js` e restringir portas (`FOUNDRY_ALLOWED_PORTS`); testes para IPv4/IPv6 reservados, IPv4 mapeado em IPv6, porta não permitida e redirecionamento.
- [x] 4.3 Baixar a capa do codex no vínculo e na ressincronização via upload seguro; testar com fetch injetado que a campanha guarda `/uploads/...`, e que falha de download não impede o vínculo.

## 5. Documentação e integração

- [x] 5.1 Documentar novas variáveis no `.env.example` e README, e criar `SECURITY.md`; verificar que o README lista todas as variáveis lidas em `server/config.ts`.
- [x] 5.2 Endurecer o Dockerfile (digest da imagem base, recomendações `read_only`/`cap_drop` no README) e verificar `docker build` e o healthcheck.
- [x] 5.3 Rodar `npm run build`, `npm run lint`, `npm test` e um passeio manual (login, CRUD, upload, logout) confirmando que não há regressões.
