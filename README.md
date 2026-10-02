# Foundry Gateway

Portal de entrada para as campanhas de RPG do grupo. Cada campanha aparece como um painel que expande no hover/foco e oferece dois destinos: o jogo no **Foundry VTT** e a página da campanha no **campaign-codex**.

As campanhas são cadastradas por um admin em **`/admin`**, de dois jeitos:

- **Vinculada ao codex:** escolha uma campanha do catálogo público do codex. Nome, sistema, capa e link do codex vêm pré-preenchidos, e basta informar o link do Foundry. Todos os campos continuam editáveis, e **Ressincronizar com o codex** puxa de novo nome, sistema, link e capa (quando a capa veio do codex).
- **Manual:** informe o nome e ao menos um link (Foundry e/ou codex). Use este modo também para campanhas "só com link" no codex, que não aparecem no catálogo público.

## Requisitos

- Node.js ≥ 24. O servidor roda TypeScript direto (type stripping nativo) e usa o SQLite embutido (`node:sqlite`).

## Desenvolvimento

```bash
cp .env.example .env   # preencha ADMIN_PASSWORD e SESSION_SECRET
npm install
npm run dev            # Vite (5173) + API (3000) com proxy de /api e /uploads
```

Acesse http://localhost:5173 (portal) e http://localhost:5173/admin (gestão).

| Comando           | O que faz                                                  |
| ----------------- | ---------------------------------------------------------- |
| `npm run dev`     | Front (Vite) e servidor (`node --watch`) juntos            |
| `npm run build`   | Type-check (`tsc -b`: front, servidor e shared) + build do front em `dist/` |
| `npm start`       | Servidor de produção: API + `dist/` + uploads na mesma porta |
| `npm test`        | Testes do servidor (`node --test`)                         |
| `npm run lint`    | ESLint                                                     |

## Variáveis de ambiente

| Variável         | Obrigatória | Descrição |
| ---------------- | ----------- | --------- |
| `ADMIN_PASSWORD` | sim | Senha única da área de gestão. O servidor não sobe sem ela. |
| `SESSION_SECRET` | sim | Segredo legado (≥ 32 caracteres), mantido por compatibilidade de configuração. As sessões atuais são persistidas no banco. |
| `ADMIN_SESSION_IDLE_TIMEOUT_SECONDS` | não | Inteiro positivo em segundos. Padrão: `1800` (30 minutos sem atividade administrativa aceita pelo servidor). |
| `CODEX_BASE_URL` | não | URL base do campaign-codex (produção: `https://campaign-codex.1nodado.com.br`). Vazio desativa o modo vinculado. |
| `DATA_DIR`       | não | Onde ficam `gateway.db` e `uploads/`. Padrão: `./data`. |
| `PORT`           | não | Porta HTTP. Padrão: `3000`. |
| `TRUSTED_PROXY`  | não | `true` atrás de reverse proxy: usa `X-Forwarded-For`/`-Proto` para o IP (rate limit do login) e para o HTTPS. |
| `COOKIE_SECURE`  | não | Força (`true`) ou desliga (`false`) o atributo `Secure` do cookie. Vazio: decide pelo protocolo. |

## Sessão administrativa

A sessão expira após 30 minutos sem atividade aceita pelo servidor e, mesmo em uso contínuo, no máximo sete dias após o login. Interações na área admin são agrupadas em notificações a cada 30 segundos; consultas automáticas de validade e visitas ao portal não renovam a sessão. Abas do mesmo navegador compartilham a sessão. Ao voltar a uma aba aberta, a validade é conferida antes de liberar ações; enquanto visível, ela é conferida também a cada 60 segundos.

Ao expirar, a interface retorna ao login com “Sua sessão expirou. Entre novamente.”. Edições não salvas são perdidas e ações interrompidas não são reenviadas após novo login. Erros de conexão oferecem nova tentativa. A aplicação não persiste a senha; o preenchimento automático depende das preferências do navegador.

O cookie contém um identificador aleatório `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS. Apenas seu hash e os prazos ficam no SQLite. `POST /api/admin/logout` revoga a sessão no servidor; `GET /api/admin/session` verifica sem renovar e `POST /api/admin/session/activity` renova somente uma sessão válida. Rotas protegidas retornam 401 e limpam o cookie quando a sessão vence. Respostas administrativas usam `Cache-Control: no-store`.

Publique backend e frontend juntos. A migração adiciona a tabela `admin_sessions` sem alterar campanhas; cookies antigos exigem novo login. Reiniciar o servidor preserva os prazos. Para revogar todas as sessões atuais, execute `DELETE FROM admin_sessions` no banco do gateway. Em rollback, mantenha a tabela e troque `SESSION_SECRET` para impedir a reativação de cookies antigos; a versão anterior restaura sua política de sete dias.

## Integração com o campaign-codex

O servidor do gateway (e não o navegador) lê `GET <CODEX_BASE_URL>/api/campanhas/catalogo`, com timeout de 5 s e cache de 60 s. O catálogo só lista campanhas ativas com visibilidade "listada". O link do codex é derivado como `<CODEX_BASE_URL>/c/<slug>`, e `capa_url` relativa é resolvida contra `CODEX_BASE_URL`.

Validado contra produção em 2026-09-29: o catálogo retornou `{ campanhas: [{ slug, nome, sistema, genero, capa_url }] }`, com `capa_url` no formato `/api/c/<slug>/media/covers/<arquivo>` ou `null`. A capa e a página `/c/<slug>` são públicas (HTTP 200).

Se o codex estiver fora do ar, a home não é afetada (usa só os dados salvos no gateway), e o admin vê o erro com a opção de tentar novamente.

## Deploy (Docker)

```bash
docker build -t foundry-gateway .
docker run -d --name foundry-gateway -p 3000:3000 \
  -e ADMIN_PASSWORD=... -e SESSION_SECRET=... \
  -e CODEX_BASE_URL=https://campaign-codex.1nodado.com.br \
  -e TRUSTED_PROXY=true \
  -v foundry-gateway-data:/data \
  foundry-gateway
```

O volume `/data` guarda o banco e as imagens enviadas. Faça backup dele.

Exemplo de bloco do Caddy:

```caddy
gateway.exemplo.com.br {
	encode gzip
	reverse_proxy foundry-gateway:3000
}
```
