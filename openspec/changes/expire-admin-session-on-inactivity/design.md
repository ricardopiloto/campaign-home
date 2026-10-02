# Design

## Context

`server/auth.ts` emite um token HMAC sem estado válido por sete dias. `server/app.ts` define `Max-Age` pelo mesmo prazo e valida o token antes das rotas protegidas. `AdminLayout` verifica a sessão apenas na montagem e `src/api.ts` lança erros sem coordenar o redirecionamento global. A senha fica somente no estado do formulário de login. O backend já usa SQLite; não há specs principais publicadas, e o contrato de autenticação anterior está na mudança `add-admin-campaign-management`.

## Goals / Non-Goals

**Goals:** tornar o relógio do servidor a autoridade sobre validade; permitir revogação efetiva; manter o comportamento coerente entre abas e após suspensão do navegador.

**Non-Goals:** contas individuais, recuperação de senha, MFA e controle do gerenciador de senhas do navegador. Autofill é uma preferência do navegador e não substitui a exigência de novo login.

## Decisions

### Sessões opacas persistidas em SQLite

Gerar 32 bytes aleatórios por login e guardar apenas o hash do identificador na tabela de sessões, com criação, última atividade e vencimento absoluto. Consultar e atualizar a atividade atomicamente, exigindo `now < last_activity + timeout` e `now < absolute_expiry` antes de renovar. Excluir a sessão no logout. Usar relógio injetável em testes e limpeza oportunista dos registros vencidos. Preservar `SESSION_SECRET` nesta mudança para compatibilidade da configuração, mesmo sem usá-lo para assinar o novo cookie.

Uma janela deslizante com tokens assinados foi considerada, mas cópias antigas continuam válidas e logout não as revoga. Uma tabela permite invalidar todas as cópias e compartilhar atividade entre abas e processos que usam o mesmo banco.

### Configuração e cookie

Introduzir `ADMIN_SESSION_IDLE_TIMEOUT_SECONDS` com padrão 1800, inteiro positivo e validação no boot. Preservar o limite absoluto de sete dias. Cookie mantém atributos atuais e `Max-Age` limitado ao vencimento absoluto; a validade por inatividade sempre vem do banco. Cookies antigos não correspondem a registros e são recusados. Definir `no-store` também em login, logout e respostas 401.

### Separar consulta de validade e atividade

`GET /api/admin/session` verifica sem renovar e continua respondendo 204 quando válido. Adicionar `POST /api/admin/session/activity`, protegido por sessão e pela checagem existente de Origin, respondendo 204 quando renova e 401 quando vencido. As demais requisições protegidas iniciadas pelo usuário renovam após autenticação e validação de Origin; logout apenas revoga. A ordem evita que uma escrita de origem rejeitada renove a sessão.

O frontend envia notificações somente após eventos confiáveis de teclado ou ponteiro na área admin visível, agrupados em no máximo uma chamada a cada 30 segundos, com envio pendente enquanto houver atividade. Nenhum heartbeat de renovação roda sem interação. A precisão da janela é baseada na última atividade aceita pelo servidor; falhas de rede não garantem renovação. Consultas de validade rodam na montagem, em `visibilitychange`/foco e a cada 60 segundos enquanto a aba está visível, sem renovar.

### Tratamento central de expiração

O cliente de API sinaliza 401 apenas de rotas protegidas; senha incorreta em login não dispara esse fluxo. Um controlador no layout desmonta o conteúdo, cancela chamadas pendentes e navega ao login com motivo de expiração. Na volta à aba, suspende ações até terminar a verificação. Erros de rede exibem estado recuperável com nova tentativa, sem classificá-los como sessão vencida. O formulário de senha é limpo após login. Não persistir rascunhos nem reenviar mutações automaticamente.

## Risks / Trade-offs

- Perda de edição não salva após expiração → mensagem explícita de novo login; não prometer recuperação de rascunhos.
- Mais consultas e escritas SQLite → agrupar notificações de interação e indexar hash e vencimento.
- Aba suspensa impede timers → verificar no retorno; servidor rejeita qualquer operação vencida independentemente do frontend.
- Requisições concorrentes próximas ao vencimento → validação e renovação atômicas no banco; testar limite exato e revogação.
- Atividade em outra aba mantém a sessão compartilhada → consultar o servidor antes de concluir expiração, sem usar um relógio local como autoridade.

## Migration Plan

Adicionar tabela via migração versionada sem modificar campanhas. Publicar backend e frontend juntos e documentar que sessões existentes exigem novo login. Sessões persistidas sobrevivem ao restart sem reiniciar seus prazos. Em rollback, manter a tabela para compatibilidade e rotacionar `SESSION_SECRET` para impedir reativação de tokens legados; o rollback restaura a política anterior de sete dias.
