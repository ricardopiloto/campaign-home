# Proposal

## Why

A sessão administrativa atual permanece válida por sete dias, independentemente de uso. Um navegador deixado autenticado permite retomar a gestão muito tempo depois sem informar a senha novamente.

## What Changes

- Expirar a sessão no servidor após 30 minutos sem atividade administrativa, com intervalo configurável.
- Manter um limite absoluto de sete dias desde o login, mesmo durante uso contínuo.
- Invalidar a sessão no logout e recusar cookies anteriores ao novo mecanismo.
- Redirecionar ao login quando a sessão expirar, inclusive ao retornar a uma aba aberta, mostrando uma mensagem de expiração.
- Não persistir a senha na aplicação; armazenar no navegador somente um identificador opaco de sessão em cookie protegido.

## Capabilities

### New Capabilities

- `admin-session-lifecycle`: criação, renovação por atividade, expiração e revogação das sessões administrativas.

### Modified Capabilities

Nenhuma spec principal foi publicada em `openspec/specs/`. A autenticação existente está descrita na mudança concluída `add-admin-campaign-management`; esta capacidade complementa seus requisitos sem duplicar o CRUD.

## Impact

- Backend: autenticação, middleware admin, configuração e migração SQLite para sessões.
- Frontend: guard administrativo, tratamento de 401, atividade e retorno à aba, limpeza de estado autenticado.
- Documentação e testes: configuração do intervalo e cenários de expiração, concorrência e logout.
- A implantação encerra sessões antigas e exige novo login. Nenhuma dependência nova é necessária.
