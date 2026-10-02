# Tasks

## 1. Persistência e política de sessão

- [x] 1.1 Adicionar migração SQLite para sessões com hash único, criação, última atividade e vencimento absoluto; verificar migração em banco novo e existente sem alterar campanhas, e persistência dos prazos após reabrir o banco.
- [x] 1.2 Implementar criação opaca, validação, renovação atômica, revogação e limpeza de sessões com relógio injetável; testar limite exato de inatividade, renovação antes do vencimento, impossibilidade de reviver sessão vencida, concorrência, logout e limite absoluto de sete dias.
- [x] 1.3 Adicionar `ADMIN_SESSION_IDLE_TIMEOUT_SECONDS` com padrão 1800 e validação de inteiro positivo; testar valores ausentes, válidos e inválidos e documentar configuração e política em `.env.example` e README.

## 2. API administrativa

- [x] 2.1 Substituir o cookie HMAC por sessão opaca no login e revogar no logout, preservando atributos de segurança e aplicando `no-store`; testar login, cookie adulterado/legado, expiração com limpeza do cookie e reutilização de cópia após logout.
- [x] 2.2 Integrar validação e renovação ao middleware sem renovar `GET /api/admin/session`; adicionar `POST /api/admin/session/activity` com proteção de Origin; testar consulta sem renovação, atividade válida, origem rejeitada sem renovação e isolamento da home pública.
- [x] 2.3 Verificar com testes de rotas que escrita após expiração retorna 401 sem efeitos em campanhas ou uploads; documentar endpoints, invalidação de cookies antigos e procedimento de implantação/rollback no README.

## 3. Interface administrativa

- [x] 3.1 Centralizar tratamento de 401 protegido no cliente de API e layout, desmontando telas, cancelando chamadas pendentes e redirecionando com mensagem de expiração; verificar que senha incorreta no login e erro de rede não acionam esse fluxo e que mutações não são reenviadas após login.
- [ ] 3.2 Adicionar verificação sem renovação na entrada, no retorno à aba e a cada 60 segundos quando visível, bloqueando ações durante verificação de retorno; verificar no navegador aba suspensa, indisponibilidade de rede e recuperação por nova tentativa.
- [ ] 3.3 Notificar atividade confiável de teclado/ponteiro apenas no admin visível, agrupando envios a cada 30 segundos e limpando listeners/timers ao sair; verificar que edição ativa renova, aba abandonada expira e uso em outra aba mantém a sessão compartilhada.
- [x] 3.4 Limpar a senha após login e documentar novo login e perda de edição não salva; verificar ausência de senha em armazenamento web/cookies/URLs e a mensagem "Sua sessão expirou. Entre novamente.".

## 4. Verificação integrada

- [ ] 4.1 Executar fluxo com timeout reduzido: login, atividade, inatividade, retorno à aba, escrita recusada, novo login, duas abas, logout e restart do servidor; confirmar resultados da spec e executar `npm test`, `npm run build` e `npm run lint`.

## Evidências da execução

- Backend implementado e verificado por `server/sessions.test.ts`: migração, restart do banco, relógio exato, limite absoluto, conexões compartilhadas e revogação.
- Controle do frontend implementado e verificado por `server/admin-client.test.ts`: interação agrupada, consultas sem renovação, retorno/foco, bloqueio durante verificação, erros de rede, retry, 401 e cancelamento.
- `npm test`, `npm run build`, `npm run lint` e `git diff --check` passaram.
- Fluxo HTTP com build de produção e timeout de 2 segundos passou: SPA, login, renovação, consulta sem renovação, inatividade, escrita recusada, novo login e logout com cópia do cookie.
- As tarefas 3.2, 3.3 e 4.1 permanecem abertas somente para concluir a verificação em navegador (aba suspensa, edição real, duas abas e fluxo visual). O inventário do Computer Use retornou nenhum navegador e a tentativa de abrir o navegador integrado retornou `Browser is not available: iab`.
