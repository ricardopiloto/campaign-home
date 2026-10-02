# Spec Delta

## Purpose

Controlar a duração e revogação do acesso administrativo, exigindo novo login após inatividade mesmo quando o navegador conserva o cookie ou uma aba aberta.

## ADDED Requirements

### Requirement: Expiração por inatividade validada no servidor
O servidor SHALL expirar a sessão após o intervalo configurado desde a última atividade administrativa aceita, com padrão de 30 minutos. No instante do vencimento ou depois, qualquer acesso protegido SHALL receber 401, limpar o cookie e não executar a operação solicitada. Um cliente sem JavaScript SHALL estar sujeito à mesma regra. O intervalo SHALL ser um número inteiro positivo em segundos; configuração inválida SHALL impedir o boot.

#### Scenario: Retorno após inatividade
- **WHEN** o admin retorna após 30 minutos sem atividade aceita, usando a configuração padrão
- **THEN** o acesso protegido recebe 401 e exige novo login

#### Scenario: Escrita com sessão expirada
- **WHEN** um cliente envia uma alteração no instante do vencimento ou depois
- **THEN** o servidor responde 401 sem alterar os dados e limpa o cookie

### Requirement: Renovação somente por atividade administrativa
Requisições administrativas autenticadas decorrentes de ações do usuário e notificações de interação na área admin SHALL renovar a janela de inatividade somente se a sessão ainda estiver válida. Consultas automáticas de validade, timers sem interação, foco da aba e visitas à home pública SHALL NOT renovar a sessão. A sessão SHALL vencer em no máximo sete dias desde o login, independentemente de atividade. Abas do mesmo navegador SHALL compartilhar a atividade da sessão.

#### Scenario: Uso ativo da área admin
- **WHEN** o admin interage com o formulário antes do vencimento e a atividade é aceita pelo servidor
- **THEN** a janela de inatividade é renovada sem exigir novo login

#### Scenario: Aba abandonada
- **WHEN** a aba permanece aberta sem interação, mesmo realizando consultas automáticas de validade
- **THEN** a sessão vence ao fim da janela de inatividade

#### Scenario: Sessão já vencida não revive
- **WHEN** uma notificação de atividade chega após o vencimento
- **THEN** o servidor responde 401 sem renovar a sessão

#### Scenario: Limite absoluto
- **WHEN** passaram sete dias desde o login apesar de atividade contínua
- **THEN** o servidor exige novo login

### Requirement: Retorno ao login na interface
A interface SHALL verificar a validade ao entrar no admin, ao retornar à aba e durante sua exibição, com verificações automáticas no máximo a cada 60 segundos enquanto visível. Um 401 em qualquer chamada protegida SHALL remover a tela administrativa e redirecionar para `/admin/login`, exibindo "Sua sessão expirou. Entre novamente.". Erros de rede SHALL NOT ser tratados como confirmação de expiração. Ações bloqueadas SHALL NOT ser reenviadas automaticamente após novo login.

#### Scenario: Retorno a aba suspensa
- **WHEN** o usuário retorna a uma aba administrativa após a sessão vencer
- **THEN** a interface verifica a sessão sem renová-la e redireciona ao login antes de permitir novas ações

#### Scenario: Expiração durante edição
- **WHEN** uma chamada protegida recebe 401 durante a edição
- **THEN** a tela protegida é desmontada e o login apresenta a mensagem de expiração

#### Scenario: Servidor inacessível
- **WHEN** a verificação de sessão falha por indisponibilidade de rede
- **THEN** a interface informa a indisponibilidade sem afirmar que a sessão expirou

### Requirement: Credenciais e revogação
A aplicação SHALL NOT persistir a senha em cookies, armazenamento web ou URLs. O cookie SHALL conter somente um identificador opaco de sessão com `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS. Logout SHALL revogar a sessão no servidor, inclusive para cópias do cookie em outras abas. Cookies do mecanismo anterior SHALL ser recusados após a implantação. Respostas de autenticação e rotas protegidas SHALL usar `Cache-Control: no-store`.

#### Scenario: Logout com cópia do cookie
- **WHEN** o admin faz logout e um cliente reutiliza uma cópia do cookie anterior
- **THEN** o servidor responde 401

#### Scenario: Cookie legado
- **WHEN** um navegador apresenta o token anterior com expiração assinada
- **THEN** o servidor exige novo login
