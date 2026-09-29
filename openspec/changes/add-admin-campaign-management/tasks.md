# Tasks

## 1. Estrutura do servidor e toolchain

- [x] 1.1 Criar `server/` (entry `server/index.ts`, `server/tsconfig.json`) e `shared/types.ts` com `PublicCampaign`, `AdminCampaign` e `CodexCampaign`; ajustar `tsconfig.json` (references) e `eslint.config.js` para cobrir `server/` e `shared/`; verificar que `npm run build` e `npm run lint` passam
- [x] 1.2 Adicionar as dependências `hono`, `@hono/node-server`, `zod` e `react-router-dom`, e as dev deps `concurrently` e `@types/node` (`node:sqlite`, type stripping e `node --test` substituem better-sqlite3, tsx e vitest; ver design); verificar com `npm install` sem erros
- [x] 1.3 Criar os scripts `dev` (Vite e servidor via `concurrently`), `dev:server` (`node --watch`), `build` (type-check de front e servidor + build do front), `start` (`node server/index.ts`) e `test` (`node --test`); configurar `server.proxy` de `/api` e `/uploads` em `vite.config.ts`; verificar que `npm run dev` sobe os dois e que `curl localhost:5173/api/health` responde 200
- [x] 1.4 Carregar a configuração a partir do env (`PORT`, `DATA_DIR`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `CODEX_BASE_URL`, `COOKIE_SECURE`, `TRUSTED_PROXY`), falhando no boot quando faltar `ADMIN_PASSWORD` ou `SESSION_SECRET`; criar `.env.example`; verificar com um teste que o boot sem senha lança erro

## 2. Persistência

- [x] 2.1 Implementar `server/db.ts` com migrações versionadas via `PRAGMA user_version` e a tabela `campaigns` conforme o design (incluindo `UNIQUE codex_slug` e o `CHECK` de ao menos um link); verificar com um teste que um banco novo é criado e que um segundo boot não reaplica a migração
- [x] 2.2 Implementar o repositório (list ordenado, get, create com `sort_order` no fim, update, delete, reorder transacional); verificar com testes usando SQLite `:memory:`, incluindo o conflito de `codex_slug` duplicado

## 3. API pública e validação

- [x] 3.1 Criar os schemas zod compartilhados (nome obrigatório, URLs só `http`/`https`, limites de tamanho, ao menos um link) com mensagens em pt-BR; verificar com testes cobrindo `javascript:`, URL relativa e cadastro sem links
- [x] 3.2 Implementar `GET /api/campaigns` retornando apenas os campos públicos, ordenados; verificar com um teste de rota (`app.request`) que `source` e `codex_slug` não aparecem na resposta
- [x] 3.3 Servir `dist/` com fallback SPA para `index.html` (exceto `/api` e `/uploads`) e servir `/uploads/*` a partir de `DATA_DIR/uploads`, com `CSP: sandbox` para SVG; verificar via `npm run build && npm start` que `/` e `/admin` retornam o SPA

## 4. Autenticação do admin

- [x] 4.1 Implementar login, logout e session com um cookie HMAC sem estado (`httpOnly`, `SameSite=Lax`, `Secure` condicional, 7 dias) e comparação em tempo constante; verificar com testes de senha certa (204 + cookie), senha errada (401), cookie adulterado (401) e cookie expirado (401)
- [x] 4.2 Criar o middleware que protege `/api/admin/*` (exceto login) e checa `Origin` em métodos de escrita; verificar com testes de acesso sem cookie (401) e de POST com `Origin` diferente (403)
- [x] 4.3 Implementar o rate limit do login em memória por IP (5 falhas a cada 15 min, `X-Forwarded-For` só com `TRUSTED_PROXY`); verificar com um teste em que a 6ª tentativa recebe 429 mesmo com a senha certa

## 5. Integração com o codex

- [x] 5.1 Implementar `server/codex.ts`: fetch de `<CODEX_BASE_URL>/api/campanhas/catalogo` com timeout de 5 s, validação zod descartando itens inválidos, mapeamento (capa absoluta e link `/c/<slug>`) e cache de 60 s; verificar com testes com `fetch` mockado para sucesso, `capa_url` relativa, item sem `slug`, timeout e JSON sem `campanhas`
- [x] 5.2 Implementar `GET /api/admin/codex/available` (exclui slugs já vinculados; 503 sem `CODEX_BASE_URL`; 502 em falha); verificar com testes de rota nos três casos
- [x] 5.3 Validar manualmente contra o codex real (`curl <CODEX_BASE_URL>/api/campanhas/catalogo`) que o formato bate com o mapeamento e anotar o resultado no README

## 6. CRUD administrativo

- [x] 6.1 Implementar `GET /api/admin/campaigns` com `missingInCodex` (`true`/`false`, ou `null` quando o codex falhar); verificar com testes para os três valores
- [x] 6.2 Implementar `POST` e `PUT /api/admin/campaigns[/:id]` para os modos `codex` e `manual` (409 em slug duplicado, 400 com `field`, 404); verificar com testes de rota cobrindo os cenários do spec `admin-campaign-management`
- [x] 6.3 Implementar `DELETE` (removendo o upload associado) e `PUT /api/admin/campaigns/order`; verificar com testes que a remoção libera o slug no `available` e que a ordem persiste
- [x] 6.4 Implementar `POST /api/admin/campaigns/:id/resync` (atualiza nome, sistema, codex_url e a imagem só se `image_source = codex`; 502 sem alterar nada em falha); verificar com testes para os dois casos
- [x] 6.5 Implementar `POST /api/admin/uploads` (JPEG/PNG/WebP/SVG, até 5 MB, nome UUID) e a limpeza do arquivo antigo ao trocar a imagem; verificar com testes de tipo inválido (400), arquivo grande (400) e sucesso (URL servível)

## 7. Home pública consumindo a API

- [x] 7.1 Remover `src/data/campaigns.ts` e `src/assets/art/`; criar o hook `useCampaigns()` (`loading`/`error`/`data`) e integrá-lo em `App`/`PanelsBoard`, com os estados vazio, de carregamento e de erro em pt-BR; verificar no browser com o banco vazio, com dados e com o servidor parado
- [x] 7.2 Refatorar `Panel` para `<article>` com as ações "Foundry" e "Codex" (renderizadas condicionalmente, nova aba, `rel="noopener noreferrer"`, aria-label com o título) e a imagem com fallback via `onError`; verificar no browser os três casos de links do spec
- [x] 7.3 Atualizar `global.css`: expansão com `.panel:hover, .panel:focus-within`, estilos de `.panel__action` e fallback de imagem; verificar com navegação por Tab no desktop (≥ 900px) e com toque/viewport mobile (< 900px) que o painel expande e que as ações são alcançáveis
- [x] 7.4 Adicionar o roteamento (`react-router-dom`) com `/` e `/admin/*`; verificar que o reload em `/admin` funciona no dev e no `npm start`

## 8. Área de gestão (front)

- [x] 8.1 Criar a tela de login (`/admin/login`) e um guard que consulta `/api/admin/session` e redireciona; verificar no browser a senha errada ("Senha inválida"), o login e o logout ("Sair")
- [x] 8.2 Criar a listagem (`/admin`) com a origem, os links, o aviso "Não encontrada no codex", os botões ↑/↓ de ordem e a remoção com confirmação; verificar no browser que reordenar e remover se refletem na home
- [x] 8.3 Criar o formulário novo/editar com a escolha de modo (Codex/Manual), o seletor de campanhas disponíveis com pré-preenchimento, a mensagem quando o codex não está configurado ou falha (com "Tentar novamente"), todos os campos editáveis, a imagem por upload/URL/remoção e os erros por campo; verificar no browser o vínculo, o cadastro manual e os erros de validação
- [x] 8.4 Adicionar o botão "Ressincronizar com o codex" na edição de campanhas vinculadas; verificar no browser que o nome é atualizado e que a tagline e o link do Foundry são preservados
- [x] 8.5 Estilizar o admin em `global.css` (prefixo `admin-`, tokens existentes, responsivo); verificar visualmente em 375px e 1280px

## 9. Deploy e documentação

- [x] 9.1 Criar um `Dockerfile` (build multi-stage, `node:*-slim`, `VOLUME DATA_DIR`) e `.dockerignore`; verificar que `docker build` e `docker run -e ADMIN_PASSWORD=... -e SESSION_SECRET=... -v data:/data` servem a home e o admin
- [x] 9.2 Atualizar o `CLAUDE.md` (arquitetura com servidor, comandos, env, `npm test`, remoção da seção "Data-driven" hardcoded) e criar um README com setup, variáveis de ambiente e um exemplo de bloco do Caddy; verificar que os comandos documentados rodam como descritos

## 10. Verificação integrada

- [x] 10.1 Fazer um fluxo ponta a ponta com o build de produção apontando para o codex real: login, vincular uma campanha do catálogo, cadastrar uma manual, reordenar, ressincronizar, remover e logout; confirmar na home os cards, os dois links e o comportamento com o codex fora do ar (ex.: `CODEX_BASE_URL` inválido); garantir que `npm run build`, `npm run lint` e `npm test` passam
