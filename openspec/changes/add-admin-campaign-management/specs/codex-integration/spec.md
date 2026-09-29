# Spec Delta

## Purpose

Define como o gateway lê o catálogo público do campaign-codex para oferecer campanhas disponíveis para vínculo e derivar os links do codex.

## ADDED Requirements

### Requirement: Fonte do catálogo configurável
O gateway SHALL ler as campanhas disponíveis do endpoint público `GET <CODEX_BASE_URL>/api/campanhas/catalogo` do campaign-codex, com `CODEX_BASE_URL` configurado no servidor. A leitura SHALL ser feita pelo servidor do gateway, e não pelo navegador. Quando `CODEX_BASE_URL` não estiver configurado, o modo vinculado SHALL ficar indisponível, sem impedir o cadastro manual.

#### Scenario: Codex não configurado
- **WHEN** `CODEX_BASE_URL` não está definido e o admin abre o formulário de nova campanha
- **THEN** apenas o modo manual é oferecido, com uma nota de que a integração com o codex não está configurada

### Requirement: Mapeamento de campos do catálogo
Cada item do catálogo (`slug`, `nome`, `sistema`, `genero`, `capa_url`) SHALL ser mapeado para uma campanha disponível com: slug de vínculo = `slug`, nome = `nome`, sistema = `sistema`, imagem = `capa_url` resolvida como URL absoluta contra `CODEX_BASE_URL` (quando presente), e link do codex = `<CODEX_BASE_URL>/c/<slug>`.

#### Scenario: Capa com caminho relativo
- **WHEN** o catálogo retorna `capa_url: "/uploads/wfrp-agazzi/covers/capa.jpg"`
- **THEN** a imagem pré-preenchida é `<CODEX_BASE_URL>/uploads/wfrp-agazzi/covers/capa.jpg`

#### Scenario: Link do codex derivado
- **WHEN** o admin vincula a campanha de slug `wfrp-agazzi`
- **THEN** o link do codex pré-preenchido é `<CODEX_BASE_URL>/c/wfrp-agazzi`

### Requirement: Somente campanhas listadas
O gateway SHALL oferecer para vínculo apenas o que o catálogo público do codex retorna (campanhas ativas com visibilidade "listada"). Campanhas "só com link" do codex SHALL ser cadastradas pelo modo manual, informando o link do codex diretamente.

#### Scenario: Campanha "só com link" não aparece
- **WHEN** uma campanha do codex tem visibilidade `so_link`
- **THEN** ela não aparece entre as disponíveis para vínculo

### Requirement: Tolerância a falhas do codex
Falhas ou lentidão do codex (timeout, erro HTTP, resposta inválida) NÃO SHALL afetar a home pública, que usa apenas os dados persistidos no gateway. Na área de gestão, a falha SHALL ser exibida como erro recuperável ("Não foi possível carregar o catálogo do codex"), mantendo o cadastro manual disponível.

#### Scenario: Codex fora do ar
- **WHEN** o codex não responde dentro do timeout
- **THEN** a home continua exibindo todas as campanhas cadastradas, e o seletor do admin mostra o erro com a opção de tentar novamente

#### Scenario: Resposta com formato inesperado
- **WHEN** o codex retorna um JSON sem o campo `campanhas`, ou itens sem `slug` ou `nome`
- **THEN** os itens inválidos são ignorados e, se nenhum item for válido, o admin vê o erro de catálogo
