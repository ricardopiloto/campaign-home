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
| `ADMIN_PASSWORD` | sim | Senha única da área de gestão, com ao menos 12 caracteres. O servidor não sobe sem ela. Trocar a senha encerra todas as sessões. |
| `SESSION_SECRET` | sim | Segredo (≥ 32 caracteres) que assina o cookie de sessão. Trocar invalida todas as sessões. |
| `CODEX_BASE_URL` | não | URL base do campaign-codex (produção: `https://campaign-codex.1nodado.com.br`). Vazio desativa o modo vinculado. |
| `DATA_DIR`       | não | Onde ficam `gateway.db` e `uploads/`. Padrão: `./data`. |
| `PORT`           | não | Porta HTTP. Padrão: `3000`. |
| `TRUSTED_PROXY`  | não | `true` atrás de reverse proxy: usa `X-Forwarded-For`/`-Proto` para o IP (rate limits) e para o HTTPS. |
| `TRUSTED_PROXY_HOPS` | não | Quantos proxies confiáveis existem à frente do app (padrão `1`). O IP do cliente é a entrada de `X-Forwarded-For` contada **do fim**; um valor errado faz todos os usuários compartilharem um IP (ou permite forjá-lo). Caddy sozinho: `1`; Cloudflare + Caddy: `2`. |
| `PUBLIC_ORIGIN`  | não | Origem pública (ex.: `https://gateway.exemplo.com.br`) usada na checagem CSRF. Vazio: compara `Origin` com o cabeçalho `Host`. |
| `COOKIE_SECURE`  | não | Força (`true`) ou desliga (`false`) o atributo `Secure` do cookie. Vazio: decide pelo protocolo; com `NODE_ENV=production` (imagem Docker) o padrão é `true`, então o admin exige HTTPS. |
| `RATE_LIMIT_PUBLIC` / `RATE_LIMIT_ADMIN` | não | Requisições por IP por minuto em `/api/campaigns` e `/uploads/*` (padrão `120`) e em `/api/admin/*` (padrão `60`). Em memória: valem por instância. |
| `UPLOAD_QUOTA_MB` | não | Cota de disco das imagens enviadas (padrão `200`). Acima dela o upload responde 507. |
| `NODE_ENV` | não | `production` (já definido na imagem Docker) exige `CODEX_BASE_URL` https e torna o cookie `Secure` por padrão. |
| `DIST_DIR` | não | Diretório do front buildado. Padrão: `./dist`. |
| `FOUNDRY_ALLOWED_PORTS` | não | Portas aceitas nas URLs do Foundry (padrão `443`). Se a sua instância usa outra porta HTTPS, liste-a aqui. |

## Segurança

Resumo das defesas (detalhes e como reportar falhas em [`SECURITY.md`](SECURITY.md)):

- **Sessão:** cookie `HttpOnly` + `SameSite=Lax` (`__Host-` e `Secure` sob HTTPS), sessões guardadas no SQLite com validade de 24 h, revogadas no logout e invalidadas ao trocar `ADMIN_PASSWORD` ou `SESSION_SECRET`.
- **Login:** limite por IP com atraso progressivo e limite global. Atrás de proxy, configure `TRUSTED_PROXY=true` e `TRUSTED_PROXY_HOPS` corretamente.
- **CSRF:** escritas do admin exigem `Origin` (ou `Sec-Fetch-Site: same-origin`) da origem pública e `Content-Type: application/json` nas rotas JSON. Clientes sem esses cabeçalhos (ex.: `curl` puro) recebem 403: envie `-H 'Sec-Fetch-Site: same-origin'`.
- **Cabeçalhos:** CSP restritiva, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` e HSTS sob HTTPS em todas as respostas.
- **Uploads:** só JPEG, PNG e WebP (SVG não é mais aceito), reencodados para remover metadados, até 4096 px e 5 MB, com cota de disco e limpeza de envios abandonados há mais de 24 h. SVGs antigos continuam sendo servidos em sandbox.
- **URLs:** `foundryUrl`, `codexUrl` e imagens externas precisam ser `https:` (sem credenciais). Registros antigos com `http:` ficam guardados, mas o portal não os exibe: edite-os para `https:`. A consulta de status do Foundry só acessa IPs públicos, nas portas permitidas, e nunca segue redirecionamentos.
- **Capas do codex** são copiadas para `/uploads` ao vincular/ressincronizar, então os visitantes não contatam o codex.
- **Auditoria:** login, logout e alterações do admin saem no stdout como JSON (`"type":"audit"`), sem senhas nem corpos de requisição.

Recomendações de operação no Docker (além do `USER node` já usado): `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges` (o app só grava em `/data`). Atualize a imagem base periodicamente (`docker pull node:24-slim` e troque o digest no `Dockerfile`).

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
  -e TRUSTED_PROXY=true -e TRUSTED_PROXY_HOPS=1 \
  -e PUBLIC_ORIGIN=https://gateway.exemplo.com.br \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
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
