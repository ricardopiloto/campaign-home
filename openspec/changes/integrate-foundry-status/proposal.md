# Proposal

## Why

As campanhas atualmente podem exibir um status digitado manualmente, que fica desatualizado em relação à mesa. O gateway deve derivar a consulta de status do endereço Foundry já informado e refletir o estado e o sistema retornados pela API.

## What Changes

- Derivar automaticamente a URL da API de status como `<endereço do Foundry>/api/status`, sem pedir ao admin um segundo endereço.
- Remover o preenchimento manual de `status`; apresentar `ATIVO` ou `INATIVO` conforme o resultado da API e manter o jogo/sistema ativo sincronizado.
- Tratar endpoint indisponível ou resposta inválida sem impedir a exibição da campanha.

## Capabilities

### New Capabilities
- `foundry-status`: Configuração e consulta do status e jogo ativo da instância Foundry associada a uma campanha.

### Modified Capabilities

## Impact

- Formulário administrativo e modelos de campanha compartilhados, eliminando a configuração duplicada do endpoint e o status manual.
- API e persistência do gateway para derivar o endpoint do endereço Foundry e obter os dados atuais da instância.
- Exibição pública dos dados atuais de status e sistema da campanha.
- Integração de rede do servidor com endpoints Foundry configurados pelo admin.
