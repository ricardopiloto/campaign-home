# Spec Delta

## Purpose

Exibe publicamente as campanhas ativas do grupo no Foundry Gateway, oferecendo para cada uma o acesso ao jogo no Foundry VTT e ao campaign-codex.

## ADDED Requirements

### Requirement: Lista pública de campanhas vem da API
A home SHALL exibir as campanhas obtidas de um endpoint público do gateway (`GET /api/campaigns`), sem autenticação, e NÃO SHALL depender de dados de campanha embutidos no bundle do front.

#### Scenario: Home carrega campanhas cadastradas
- **WHEN** um visitante abre a home e existem campanhas cadastradas
- **THEN** a home exibe um painel para cada campanha retornada pela API

#### Scenario: Endpoint público não expõe dados administrativos
- **WHEN** um cliente anônimo chama `GET /api/campaigns`
- **THEN** a resposta contém apenas os campos de exibição (id, título, tagline, sistema, status, ongoing, URL da imagem, link do Foundry, link do codex) e não contém a origem interna nem metadados de gestão

### Requirement: Ordenação definida pelo admin
A lista pública SHALL respeitar a ordem definida pelo admin e, em caso de empate, a ordem de cadastro.

#### Scenario: Ordem reflete o cadastro do admin
- **WHEN** o admin define que a campanha B vem antes da campanha A
- **THEN** a home exibe B antes de A

### Requirement: Card oferece acesso ao Foundry e ao codex
Cada painel SHALL oferecer uma ação distinta para cada link cadastrado: "Foundry", que abre a instância do Foundry VTT, e "Codex", que abre a campanha no campaign-codex. Uma ação SHALL ser omitida quando o respectivo link não existir. Os links SHALL abrir em nova aba com `rel="noopener noreferrer"`.

#### Scenario: Campanha com os dois links
- **WHEN** uma campanha tem link do Foundry e link do codex
- **THEN** o painel expandido mostra as duas ações, cada uma apontando para o respectivo destino

#### Scenario: Campanha sem link do codex
- **WHEN** uma campanha tem apenas link do Foundry
- **THEN** o painel mostra somente a ação "Foundry"

#### Scenario: Campanha sem link do Foundry
- **WHEN** uma campanha tem apenas link do codex
- **THEN** o painel mostra somente a ação "Codex"

### Requirement: Acessibilidade da expansão e das ações
A expansão do painel SHALL ocorrer tanto por hover quanto por foco de teclado em qualquer elemento dentro do painel, e as ações SHALL ser alcançáveis via Tab com nomes acessíveis que incluam o título da campanha.

#### Scenario: Navegação por teclado
- **WHEN** um usuário navega com Tab até a ação "Foundry" de uma campanha
- **THEN** o painel dessa campanha está expandido e a ação tem nome acessível como "Abrir <título> no Foundry VTT"

### Requirement: Estados vazio, de carregamento e de erro
A home SHALL mostrar uma mensagem em pt-BR quando não houver campanhas cadastradas, SHALL mostrar um indicador enquanto carrega e SHALL mostrar uma mensagem de erro quando a API falhar, sem quebrar o header e o footer.

#### Scenario: Nenhuma campanha cadastrada
- **WHEN** a API retorna uma lista vazia
- **THEN** a home exibe uma mensagem de estado vazio no lugar dos painéis

#### Scenario: API indisponível
- **WHEN** a chamada `GET /api/campaigns` falha
- **THEN** a home exibe uma mensagem de erro e o header e o footer continuam visíveis

### Requirement: Imagem de fallback
Quando uma campanha não tiver imagem, ou a imagem não carregar, o painel SHALL exibir um fundo padrão, sem ícone de imagem quebrada.

#### Scenario: Campanha sem imagem
- **WHEN** uma campanha não tem URL de imagem
- **THEN** o painel é renderizado com o fundo padrão do tema

