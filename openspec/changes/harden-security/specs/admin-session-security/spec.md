# Spec Delta

## Purpose

Define como a área administrativa autentica o admin, mantém e revoga a sessão, resiste a força bruta e CSRF e registra as ações realizadas.

## ADDED Requirements

### Requirement: Senha de admin forte
O servidor SHALL recusar iniciar quando `ADMIN_PASSWORD` tiver menos de 12 caracteres.

#### Scenario: Senha curta
- **WHEN** o servidor inicia com `ADMIN_PASSWORD` de 8 caracteres
- **THEN** o processo encerra com mensagem de configuração inválida, sem abrir a porta

### Requirement: Sessão revogável
Cada sessão SHALL ter um identificador único e expirar em no máximo 24 horas. O logout SHALL revogar a sessão no servidor, e a troca de `ADMIN_PASSWORD` SHALL invalidar todas as sessões anteriores. Sob HTTPS o cookie SHALL usar o prefixo `__Host-`, além de `HttpOnly`, `Secure` e `SameSite=Lax`.

#### Scenario: Token reutilizado após logout
- **WHEN** um token copiado antes do logout é enviado depois dele
- **THEN** o servidor responde 401

#### Scenario: Senha trocada
- **WHEN** o servidor reinicia com outra `ADMIN_PASSWORD`
- **THEN** tokens emitidos com a senha anterior são rejeitados com 401

### Requirement: Limite de login resistente a falsificação de IP
O limite de tentativas SHALL identificar o cliente pelo endereço adicionado pelo proxy confiável (contando `TRUSTED_PROXY_HOPS` saltos a partir do fim de `X-Forwarded-For`), nunca pelo valor escolhido pelo cliente. O servidor SHALL aplicar também um limite global de falhas e atraso progressivo entre tentativas falhas.

#### Scenario: Cabeçalho forjado
- **WHEN** um cliente envia `X-Forwarded-For` com um IP diferente a cada tentativa atrás de um proxy confiável
- **THEN** as tentativas continuam contadas contra o mesmo IP real e recebem 429 após o limite

#### Scenario: Ataque distribuído
- **WHEN** o total de falhas de login de todos os IPs excede o limite global na janela
- **THEN** novas tentativas recebem 429 até o fim da janela

### Requirement: Proteção CSRF nas escritas admin
Requisições admin com método diferente de GET/HEAD/OPTIONS SHALL ser aceitas somente se `Origin` (ou, na ausência, `Sec-Fetch-Site: same-origin`) indicar a origem pública do gateway. Rotas JSON SHALL exigir `Content-Type: application/json`. Requisições sem nenhuma dessas provas SHALL ser rejeitadas com 403.

#### Scenario: Escrita sem Origin
- **WHEN** um POST autenticado chega sem `Origin` nem `Sec-Fetch-Site`
- **THEN** o servidor responde 403 e nada é alterado

#### Scenario: Origem diferente
- **WHEN** um POST autenticado chega com `Origin` de outro host
- **THEN** o servidor responde 403

#### Scenario: Content-Type inesperado
- **WHEN** um PUT em rota JSON chega como `text/plain`
- **THEN** o servidor responde 415

### Requirement: Auditoria de ações administrativas
O servidor SHALL registrar em log estruturado (horário, IP, ação, id alvo) logins com sucesso e falha, logouts, criação, alteração, reordenação, remoção, ressincronização e uploads, sem registrar senhas, tokens ou corpos de requisição.

#### Scenario: Login falho registrado
- **WHEN** ocorre um login com senha incorreta
- **THEN** o log contém uma entrada com IP e ação de falha, e não contém a senha enviada
