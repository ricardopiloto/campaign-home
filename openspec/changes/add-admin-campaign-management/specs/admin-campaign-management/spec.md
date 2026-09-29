# Spec Delta

## Purpose

Permite que um único admin autenticado cadastre, edite, ordene e remova as campanhas exibidas no gateway, vinculando-as ao campaign-codex ou informando os dados manualmente.

## ADDED Requirements

### Requirement: Autenticação por senha única
A área de gestão (`/admin`) e todos os endpoints de escrita (`/api/admin/*`) SHALL exigir autenticação. O login SHALL validar uma senha única configurada no servidor e SHALL estabelecer uma sessão via cookie `httpOnly`, `SameSite=Lax` e `Secure` quando o gateway for servido por HTTPS. O servidor NÃO SHALL iniciar se a senha de admin ou o segredo de sessão não estiverem configurados.

#### Scenario: Login com senha correta
- **WHEN** o admin envia a senha correta em `/admin/login`
- **THEN** o servidor define o cookie de sessão e o admin é levado à lista de campanhas

#### Scenario: Login com senha incorreta
- **WHEN** alguém envia uma senha incorreta
- **THEN** o servidor responde 401, não define cookie e a tela mostra "Senha inválida"

#### Scenario: Acesso sem sessão
- **WHEN** um cliente sem sessão válida chama qualquer endpoint `/api/admin/*` (exceto login)
- **THEN** o servidor responde 401

#### Scenario: Logout
- **WHEN** o admin clica em "Sair"
- **THEN** a sessão é invalidada e acessos posteriores a `/admin` redirecionam ao login

### Requirement: Proteção contra força bruta
O endpoint de login SHALL limitar tentativas falhas por IP, respondendo 429 quando o limite for excedido dentro da janela configurada.

#### Scenario: Excesso de tentativas
- **WHEN** um mesmo IP falha o login mais vezes que o limite na janela
- **THEN** as próximas tentativas recebem 429 até o fim da janela, mesmo com a senha correta

### Requirement: Listagem administrativa
A área de gestão SHALL listar todas as campanhas cadastradas na ordem de exibição, indicando para cada uma a origem ("Codex" ou "Manual"), os links presentes e se a campanha vinculada não foi encontrada no catálogo atual do codex.

#### Scenario: Campanha vinculada removida do codex
- **WHEN** uma campanha vinculada tem um slug que não aparece mais no catálogo do codex
- **THEN** a listagem exibe um aviso "Não encontrada no codex" para essa campanha, e a campanha continua visível na home

### Requirement: Cadastro vinculado ao codex
O admin SHALL poder cadastrar uma campanha escolhendo-a entre as campanhas disponíveis no catálogo do codex que ainda não estão vinculadas. Ao escolher, o formulário SHALL ser pré-preenchido com nome, sistema e imagem do codex, e com o link do codex derivado do slug. O admin SHALL informar o link do Foundry e PODE ajustar qualquer campo antes de salvar.

#### Scenario: Vincular campanha disponível
- **WHEN** o admin seleciona a campanha "wfrp-agazzi" do catálogo, informa o link do Foundry e salva
- **THEN** a campanha é criada com origem "Codex", slug de vínculo "wfrp-agazzi", link do codex derivado e os campos pré-preenchidos (ou editados), e passa a aparecer na home

#### Scenario: Campanha já vinculada não é oferecida
- **WHEN** o admin abre o seletor de campanhas do codex
- **THEN** campanhas cujo slug já está vinculado a um cadastro existente não aparecem como disponíveis

#### Scenario: Vínculo duplicado rejeitado
- **WHEN** uma requisição tenta criar um segundo cadastro com um slug do codex já vinculado
- **THEN** o servidor responde 409 e nada é criado

### Requirement: Cadastro manual
O admin SHALL poder cadastrar uma campanha manualmente, informando ao menos o nome e um link (Foundry e/ou codex), sem vínculo com o catálogo do codex.

#### Scenario: Cadastro manual válido
- **WHEN** o admin informa o nome "Iron & Dust" e um link do Foundry e salva
- **THEN** a campanha é criada com origem "Manual" e aparece na home

#### Scenario: Cadastro sem nenhum link
- **WHEN** o admin tenta salvar uma campanha sem link do Foundry e sem link do codex
- **THEN** o servidor responde 400 e o formulário indica que ao menos um link é obrigatório

### Requirement: Validação de campos
O servidor SHALL validar que o nome não está vazio, que os links (quando informados) e a URL de imagem externa são URLs absolutas `http` ou `https`, e SHALL aplicar limites de tamanho aos campos de texto. Erros de validação SHALL retornar 400 com a indicação do campo inválido.

#### Scenario: Link com esquema inválido
- **WHEN** o admin informa `javascript:alert(1)` como link do Foundry
- **THEN** o servidor responde 400 indicando o campo do link do Foundry

### Requirement: Edição de todos os campos
O admin SHALL poder editar nome, tagline, sistema, status, imagem, "ongoing", link do Foundry e link do codex de qualquer campanha. As edições SHALL ser persistidas no gateway e NÃO SHALL ser sobrescritas automaticamente por mudanças no codex.

#### Scenario: Editar tagline de campanha vinculada
- **WHEN** o admin altera a tagline de uma campanha vinculada e salva
- **THEN** a home passa a exibir a nova tagline, mesmo que o codex não tenha tagline

### Requirement: Ressincronizar com o codex
Para campanhas vinculadas, o admin SHALL poder acionar "Ressincronizar com o codex", que substitui nome, sistema, imagem (quando a imagem atual veio do codex) e link do codex pelos valores atuais do catálogo, mantendo os demais campos.

#### Scenario: Ressincronização após renomear no codex
- **WHEN** a campanha foi renomeada no codex e o admin aciona a ressincronização
- **THEN** o nome no gateway passa a ser o nome atual do codex, e a tagline, o status e o link do Foundry permanecem inalterados

#### Scenario: Ressincronização com codex indisponível
- **WHEN** o admin aciona a ressincronização e o codex não responde
- **THEN** nada é alterado e a interface mostra um erro

### Requirement: Imagem por upload ou URL
O admin SHALL poder definir a imagem da campanha por upload de arquivo (JPEG, PNG, WebP ou SVG, limitado em tamanho) ou por URL externa, ou SHALL poder removê-la. Imagens enviadas SHALL ser servidas publicamente pelo gateway.

#### Scenario: Upload de imagem válida
- **WHEN** o admin envia um PNG dentro do limite de tamanho
- **THEN** a imagem é armazenada e a campanha passa a exibi-la na home

#### Scenario: Upload de tipo não permitido
- **WHEN** o admin envia um arquivo `.exe` ou um arquivo acima do limite
- **THEN** o servidor responde 400 e a imagem atual não muda

### Requirement: Reordenar e remover
O admin SHALL poder alterar a ordem de exibição das campanhas e SHALL poder remover uma campanha após confirmação. A remoção de uma campanha vinculada SHALL torná-la novamente disponível no seletor do codex.

#### Scenario: Remover campanha
- **WHEN** o admin remove uma campanha e confirma
- **THEN** ela deixa de aparecer na home e na listagem administrativa

#### Scenario: Mover campanha para cima
- **WHEN** o admin move a terceira campanha uma posição para cima
- **THEN** ela passa a ser a segunda na home
