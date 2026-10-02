# Spec Delta

## Purpose

Restringe URLs externas armazenadas ou acessadas pelo servidor para evitar SSRF, rastreamento de visitantes e downgrade para HTTP.

## ADDED Requirements

### Requirement: Somente HTTPS em URLs de campanha
`imageUrl` externa, `foundryUrl` e `codexUrl` SHALL aceitar apenas `https:`. URLs com credenciais embutidas SHALL ser rejeitadas. Registros legados com `http:` SHALL continuar armazenados, mas não SHALL ser renderizados como link ou imagem pelo front público.

#### Scenario: URL http no cadastro
- **WHEN** o admin salva uma campanha com `foundryUrl` `http://exemplo.com`
- **THEN** o servidor responde 400 com campo `foundryUrl`

#### Scenario: Registro legado
- **WHEN** a home lista uma campanha com `codexUrl` `http:`
- **THEN** o botão correspondente não é exibido

### Requirement: Consulta de status do Foundry restrita
O servidor SHALL consultar o status apenas em portas 443 ou na lista configurada, resolver o host para endereços públicos cobrindo todas as faixas IPv4 e IPv6 reservadas, fixar o IP resolvido na conexão, não seguir redirecionamentos e limitar tamanho e tempo da resposta.

#### Scenario: Porta não permitida
- **WHEN** o admin informa `https://exemplo.com:8443` fora da lista
- **THEN** o servidor responde 400 com campo `foundryUrl`

#### Scenario: Host resolve para IP privado
- **WHEN** o DNS do host retorna `10.0.0.5`
- **THEN** o cadastro é rejeitado e nenhuma conexão é aberta

#### Scenario: Redirecionamento
- **WHEN** o endpoint de status responde 302
- **THEN** o servidor não o segue e trata o status como inválido

### Requirement: Imagens externas do codex hospedadas localmente
Ao vincular ou ressincronizar uma campanha do codex, o servidor SHALL baixar a capa, validá-la pelas regras de upload e armazená-la localmente, de modo que visitantes não contatem o host do codex.

#### Scenario: Vínculo com capa
- **WHEN** o admin vincula uma campanha cujo catálogo traz `capa_url`
- **THEN** a campanha guarda um caminho `/uploads/...` e a home não referencia o host do codex
