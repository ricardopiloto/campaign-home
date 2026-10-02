# Spec Delta

## Purpose

Define quais imagens o admin pode enviar, como são validadas, armazenadas e servidas, e como o armazenamento é mantido limpo e limitado.

## ADDED Requirements

### Requirement: Formatos aceitos
O servidor SHALL aceitar apenas JPEG, PNG e WebP. SVG SHALL ser rejeitado em novos uploads. Uploads SHALL ser validados por tipo declarado, extensão e assinatura de conteúdo, e reencodados para remover metadados e payloads embutidos.

#### Scenario: SVG enviado
- **WHEN** o admin envia um arquivo `.svg`
- **THEN** o servidor responde 400 com mensagem de formato não permitido

#### Scenario: Imagem com metadados
- **WHEN** o admin envia um JPEG com EXIF de geolocalização
- **THEN** o arquivo armazenado não contém metadados EXIF

### Requirement: Limites de dimensão e cota
O servidor SHALL rejeitar imagens com mais de 4096 px de largura ou altura e SHALL recusar novos uploads quando o diretório de uploads exceder a cota configurada, respondendo 400 e 507 respectivamente.

#### Scenario: Imagem enorme em pixels
- **WHEN** uma imagem de 20000x20000 px e poucos KB é enviada
- **THEN** o servidor a rejeita sem decodificá-la por inteiro

#### Scenario: Cota esgotada
- **WHEN** o uso de disco dos uploads atingiu a cota
- **THEN** o upload recebe 507 e nada é gravado

### Requirement: Limpeza de uploads órfãos
O servidor SHALL remover periodicamente uploads com mais de 24 horas que não sejam referenciados por nenhuma campanha.

#### Scenario: Upload abandonado
- **WHEN** um arquivo foi enviado e o formulário nunca foi salvo
- **THEN** após 24 horas a rotina de limpeza remove o arquivo

### Requirement: Serviço seguro de arquivos enviados
Arquivos em `/uploads` SHALL ser servidos com `Content-Type` fixo pelo tipo validado, `nosniff` e `Content-Disposition: inline` somente para imagens raster; SVGs legados ainda armazenados SHALL ser servidos com CSP de sandbox até serem substituídos.

#### Scenario: SVG legado
- **WHEN** um SVG armazenado antes da mudança é requisitado
- **THEN** a resposta inclui CSP `sandbox` e `nosniff`
