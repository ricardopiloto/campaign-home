# Design

## Context

- O gateway hoje é um SPA estático (React 18 + Vite + TS estrito), sem estado, sem roteamento e sem backend. `Panel` é um único `<a>` que envolve o card inteiro, e a expansão é 100% CSS (`:hover` / `:focus-visible` em `.panel`).
- O campaign-codex (`ricardopiloto/interactive-map`, backend FastAPI) expõe `GET /api/campanhas/catalogo`, anônimo, que retorna `{ campanhas: [{ slug, nome, sistema, genero, capa_url }] }` somente com campanhas ativas e `listada`. As páginas de campanha seguem o padrão `/c/<slug>`, e `capa_url` pode ser relativa (servida em `/uploads/...` pela API do codex).
- A motivação e o escopo estão em proposal.md, e o comportamento está nos specs `campaign-catalog`, `admin-campaign-management` e `codex-integration`.

## Goals / Non-Goals

**Goals:**
- Um único processo Node que serve a API, o SPA buildado e os uploads, com deploy simples (um container e um volume).
- Manter o front leve: nada de biblioteca de estado nem UI kit.
- Admin utilizável no desktop e no mobile, no mesmo visual dark do portal.

**Non-Goals:**
- Múltiplos admins, papéis e troca de senha pela interface.
- Status "online" do Foundry em tempo real (ex.: `/api/status` do Foundry).
- Múltiplas instâncias do codex como fonte (apenas um `CODEX_BASE_URL`).
- Mudanças no repositório `interactive-map`.
- Migrar as 6 campanhas de exemplo.

## Decisions

### 1. Backend: Hono + `node:sqlite` em `server/`, no mesmo repositório
Monorepo simples: o front continua em `src/` e o servidor fica em `server/` (TS, com seu próprio `tsconfig`), compartilhando tipos e schemas via `shared/`. O Hono roda sobre `@hono/node-server`. Na implementação, o better-sqlite3 foi trocado pelo `node:sqlite` embutido, que também é síncrono e dispensa módulo nativo: o ambiente de dev usa Node 26, sem binários pré-compilados do better-sqlite3. Pelo mesmo motivo, o servidor roda TypeScript direto via type stripping nativo do Node (≥ 24), sem `tsx` nem etapa de build, e os testes usam o runner embutido (`node --test`) em vez do vitest, que exigiria Vite 6+.
- *Alternativas:* Express (mais verboso, tipagem pior); Fastify (bom, mas pesado para ~10 rotas); FastAPI igual ao codex (reaproveita conhecimento, mas adiciona uma segunda linguagem ao repo e duplica o toolchain). Manter tudo em TS vence pela simplicidade.
- Em produção, o Hono serve `dist/` com fallback para `index.html`, `/uploads/*` a partir de `DATA_DIR/uploads` e `/api/*`. Em dev, o Vite faz proxy de `/api` e `/uploads` para o servidor (`server.proxy` em `vite.config.ts`), e o script `dev` sobe os dois processos (`concurrently` + `node --watch`).

### 2. Modelo de dados: uma tabela `campaigns`, com os campos "materializados"
```
campaigns
  id            TEXT PK (uuid)
  source        TEXT  'codex' | 'manual'
  codex_slug    TEXT  NULL, UNIQUE           -- vínculo; NULL para manual
  title         TEXT  NOT NULL
  tagline       TEXT  NOT NULL DEFAULT ''
  system        TEXT  NOT NULL DEFAULT ''
  status        TEXT  NOT NULL DEFAULT ''
  ongoing       INTEGER NOT NULL DEFAULT 0
  image_url     TEXT  NULL                   -- externa (http/https) ou /uploads/<file>
  image_source  TEXT  'codex' | 'upload' | 'url' | NULL
  foundry_url   TEXT  NULL
  codex_url     TEXT  NULL
  sort_order    INTEGER NOT NULL
  created_at, updated_at TEXT
CHECK (foundry_url IS NOT NULL OR codex_url IS NOT NULL)
```
O pré-preenchimento vindo do codex é copiado no momento do vínculo (snapshot), e depois disso o registro é a fonte da verdade. Ver o trade-off abaixo.
- *Alternativa considerada:* "herdar com override" (campos NULL = ler do codex em tempo real). É mais fiel a "o máximo possível vem do codex", mas faz a home pública depender da disponibilidade do codex, exige cache e torna a UI de edição ambígua ("este campo está herdado?"). A ressincronização explícita cobre a necessidade com muito menos complexidade.
- `image_source` permite que a ressincronização só troque a imagem quando ela veio do codex (spec *Ressincronizar com o codex*).
- Migrações: um array versionado de SQL aplicado no boot, controlado por `PRAGMA user_version`. Não vale adotar um ORM para uma tabela.

### 3. API
```
Público
  GET    /api/campaigns                  -> PublicCampaign[] (ordenado)
Admin (cookie de sessão obrigatório, exceto login)
  POST   /api/admin/login   {password}   -> 204 + Set-Cookie | 401 | 429
  POST   /api/admin/logout               -> 204
  GET    /api/admin/session              -> 204 | 401
  GET    /api/admin/campaigns            -> AdminCampaign[] (+ missingInCodex)
  POST   /api/admin/campaigns            -> 201 | 400 | 409
  PUT    /api/admin/campaigns/:id        -> 200 | 400 | 404 | 409
  DELETE /api/admin/campaigns/:id        -> 204
  PUT    /api/admin/campaigns/order {ids: string[]} -> 204
  POST   /api/admin/campaigns/:id/resync -> 200 | 502
  POST   /api/admin/uploads (multipart)  -> {url} | 400
  GET    /api/admin/codex/available      -> CodexCampaign[] (não vinculadas) | 502 | 503 (não configurado)
```
A validação usa `zod`, com schemas compartilhados entre o servidor e os formulários (mesmas mensagens). As mensagens de erro saem em pt-BR no formato `{ error, field? }`.

### 4. Autenticação: senha única via env e cookie assinado sem estado
- `ADMIN_PASSWORD` é comparada com `crypto.timingSafeEqual` sobre os digests SHA-256 dos dois lados, o que evita vazar o tamanho da senha.
- A sessão é um cookie `gw_admin` com valor `exp.HMAC(SESSION_SECRET, exp)`, `httpOnly`, `SameSite=Lax`, `Secure` quando `COOKIE_SECURE`/HTTPS e expiração de 7 dias. Não há tabela de sessões. O logout apaga o cookie, e trocar `SESSION_SECRET` invalida todas as sessões.
- CSRF: `SameSite=Lax` junto com a checagem de `Origin` (precisa bater com o host) em métodos de escrita, o mesmo padrão do `CsrfOriginMiddleware` do codex.
- Rate limit do login: um mapa em memória por IP (ex.: 5 falhas a cada 15 min). Isso basta para um único processo. O IP vem de `X-Forwarded-For` apenas quando `TRUSTED_PROXY=true`.
- *Alternativas:* reusar a auth do codex (o cookie exige o mesmo domínio-pai e acopla os dois deploys); basicauth no Caddy (não daria uma tela de login e ainda deixaria a API sem proteção própria).

### 5. Integração com o codex feita pelo servidor
`server/codex.ts` faz o `fetch` com timeout de 5 s, valida a resposta com zod (descartando itens inválidos) e aplica o mapeamento do spec. Um cache em memória de 60 s evita martelar o codex ao abrir o formulário várias vezes. Chamar pelo servidor evita CORS: o `CORS_ORIGINS` do codex não inclui o gateway.
`missingInCodex` na listagem admin reaproveita o mesmo cache. Se o codex falhar, o campo vem como `null` (desconhecido) e não como `true`.

### 6. Front: roteamento mínimo e o card com duas ações
- Roteamento: com só duas áreas (`/` e `/admin/*`), um roteador próprio com `history.pushState` resolveria com cerca de 30 linhas, mas `react-router-dom` já é conhecido do codex e custa pouco. Decisão: **react-router-dom**, com `/`, `/admin/login`, `/admin`, `/admin/new` e `/admin/:id`.
- `Panel` deixa de ser um `<a>` e vira um `<article class="panel" tabindex="0">`, com as ações `<a class="panel__action">` dentro de `.panel-detail`. Não é possível aninhar âncoras, então o card inteiro não pode continuar clicável. O `tabindex="0"` (e não `-1`) é necessário porque no mobile as ações ficam com `display: none` até o painel expandir: sem o painel no Tab, elas seriam inalcançáveis por teclado.
- O estado ativo no desktop é `.panel:is(:hover, :focus-visible, :has(:focus-visible))`. `:focus-within` puro foi descartado no desktop porque um clique de mouse deixava o painel focado e expandido junto com o que estava sob hover (dois expandidos ao mesmo tempo). O layout, as fontes e os tokens continuam os mesmos.
- No mobile (< 900px) o hover não existe, então o estado ativo inclui `:focus-within`: o primeiro toque expande e as ações ficam visíveis. O conteúdo expandido passa a ser alinhado ao rodapé do painel (`justify-content: flex-end`), o que também corrige a sobreposição do badge com o título.
- `useCampaigns()`: um hook com `fetch` e o estado `loading | error | data`. Não entra React Query.
- Admin: formulários controlados simples e reordenação por botões ↑/↓ (sem drag-and-drop), que é acessível e sem dependência. Os estilos ficam em `global.css`, sob o prefixo `admin-`, reaproveitando os tokens.

### 7. Uploads
Os uploads ficam em `DATA_DIR/uploads/<uuid>.<ext>`. O tipo é validado pela extensão e pelo MIME declarado, com limite de 5 MB. SVG é aceito, mas servido com `Content-Security-Policy: sandbox` e `Content-Type: image/svg+xml` para neutralizar scripts. Quando a imagem é trocada ou a campanha é removida, o arquivo antigo é apagado. A imagem é renderizada só via `<img>`, nunca inline.

## Risks / Trade-offs

- [O snapshot diverge do codex (renomeou lá e o gateway não atualizou)] → Ação "Ressincronizar" por campanha, mais o aviso "Não encontrada no codex" na listagem.
- [O deploy deixa de ser estático e passa a precisar de um processo e um volume] → Dockerfile único, com `DATA_DIR` num volume e documentação no README.
- [Uma senha única compartilhada e sem 2FA] → Rate limit, cookie `httpOnly`/`Secure`, e o servidor não sobe sem senha. É aceitável para um portal de grupo, e múltiplos admins ficam como non-goal.
- [`node:sqlite` ainda emite aviso de API experimental em algumas versões do Node] → A interface usada é mínima (`prepare`/`run`/`get`/`all`/`exec`). A imagem fixa `node:24-slim`.
- [Imagens do codex apontam para `/uploads/...` do codex e podem exigir auth por ACL de mídia] → Capas do catálogo público são públicas no codex. Se alguma falhar, o painel cai no fallback visual (spec *Imagem de fallback*) e o admin pode fazer upload.
- [Trocar `<a>` por `<article>` e mudar a expansão para `:focus-within` pode regredir a navegação por teclado] → Validar manualmente com Tab e no mobile (tarefa explícita).

## Migration Plan

1. Fazer o deploy da nova versão com `ADMIN_PASSWORD`, `SESSION_SECRET`, `CODEX_BASE_URL` e o volume em `DATA_DIR`. O banco é criado vazio no boot.
2. A home mostra o estado vazio até o admin cadastrar as campanhas reais em `/admin`.
3. O reverse proxy (Caddy) passa a apontar para o processo Node, em vez de servir `dist/` como arquivos estáticos.
4. Rollback: voltar a imagem ou versão anterior (estática). O volume de dados é ignorado por ela e não sofre alteração.

## Open Questions

- Domínio final do gateway (o `CODEX_BASE_URL` de produção foi confirmado: `https://campaign-codex.1nodado.com.br`). É configuração e não muda o design.
