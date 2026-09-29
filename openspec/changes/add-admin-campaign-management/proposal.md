# Proposal

## Why

Hoje as campanhas do Foundry Gateway estão hardcoded em `src/data/campaigns.ts`, com links placeholder, e qualquer alteração exige editar código e fazer rebuild. O grupo já mantém suas campanhas no campaign-codex (`interactive-map`), que expõe um catálogo público. O gateway deve passar a ser o ponto único de entrada: para cada campanha, o jogador encontra tanto o link do jogo no Foundry quanto o link do codex, e um admin gerencia a lista sem tocar no código.

## What Changes

- **Novo backend mínimo** no próprio `campaign-home` (API HTTP + SQLite) que persiste as campanhas do gateway, serve a lista pública e o SPA buildado.
- **Nova área de gestão (`/admin`)** protegida por senha única configurada via env (sessão em cookie httpOnly).
- **Cadastro de campanha em dois modos:**
  - **Vinculada ao codex:** o admin escolhe uma campanha disponível no catálogo público do campaign-codex (`GET /api/campanhas/catalogo`) e informa o link do Foundry. Nome, sistema e capa são pré-preenchidos a partir do codex, e o link do codex é derivado (`<CODEX_BASE_URL>/c/<slug>`).
  - **Manual:** o admin informa o nome e os links (Foundry e/ou codex) diretamente.
- Todos os campos do card (nome, tagline, sistema, status, imagem, "ongoing", ordem, links) são editáveis pelo admin. Campanhas vinculadas podem ser **ressincronizadas** com o codex sob demanda.
- **Card com dois destinos:** cada painel passa a oferecer ações separadas, "Foundry" e "Codex" (esta apenas quando houver link), em vez de o painel inteiro ser um único link.
- **BREAKING:** remoção da lista hardcoded (`src/data/campaigns.ts`) e das artes SVG em `src/assets/art/`. O front passa a buscar as campanhas da API e o deploy passa de site estático para um processo Node.
- Estado vazio e estado de erro na home quando não houver campanhas ou a API falhar.

## Capabilities

### New Capabilities
- `campaign-catalog`: lista pública de campanhas do gateway (dados expostos, ordenação, card com links para o Foundry e o codex, estados vazio e de erro).
- `admin-campaign-management`: autenticação do admin e CRUD de campanhas na área de gestão, incluindo os modos vinculado ao codex e manual, a edição de campos, a ressincronização e o upload de imagem.
- `codex-integration`: consumo do catálogo público do campaign-codex (configuração da URL base, mapeamento de campos, derivação do link, comportamento quando o codex está indisponível).

### Modified Capabilities
<!-- Nenhuma: o projeto ainda não tem specs em openspec/specs/. -->

## Impact

- **Código:** `src/data/campaigns.ts` e `src/assets/art/*` removidos. `App`, `PanelsBoard` e `Panel` passam a consumir dados da API. Novas páginas de admin (login, lista e formulário). `global.css` ganha estilos para as ações do card e para o admin.
- **Novo diretório `server/`:** API em Node/TypeScript com SQLite e um diretório de uploads.
- **Dependências:** framework HTTP (Hono), driver SQLite (better-sqlite3), um roteamento mínimo no front e hashing/assinatura de sessão.
- **Configuração/Deploy:** novas variáveis de ambiente (`ADMIN_PASSWORD`, `SESSION_SECRET`, `CODEX_BASE_URL`, `DATA_DIR`, `PORT`). O deploy passa a exigir um processo Node persistente e um volume para os dados, com o dev server do Vite fazendo proxy de `/api`.
- **Sistemas externos:** leitura (somente GET, sem autenticação) do endpoint público do campaign-codex. Nenhuma mudança é necessária no repositório `interactive-map`.
