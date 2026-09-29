# Spec Delta

## Purpose

Permite associar cada campanha a um endpoint de status do Foundry e exibir informações atuais da instância, incluindo a disponibilidade da mesa e o jogo ativo.

## ADDED Requirements

### Requirement: Derivar endpoint de status do Foundry
O gateway SHALL derivar o endpoint de status acrescentando `/api/status` ao caminho base da URL do Foundry salva para a campanha, preservando esquema, host, porta e eventual prefixo de caminho. O admin SHALL informar somente a URL base do Foundry, em HTTPS; a interface SHALL NOT pedir uma URL de status separada.

#### Scenario: Derivar endpoint para consultar Foundry
- **WHEN** a campanha tem URL do Foundry `https://piloto.1nodado.com.br/`
- **THEN** o gateway consulta `https://piloto.1nodado.com.br/api/status` sem solicitar ou persistir uma URL de status separada

#### Scenario: Atualizar o endpoint quando o endereço muda
- **WHEN** o admin altera a URL do Foundry de uma campanha
- **THEN** o próximo status é consultado no endpoint `/api/status` derivado do novo endereço

### Requirement: Consultar status e jogo ativo
O gateway SHALL consultar pelo servidor o endpoint derivado e SHALL definir o campo `status` exclusivamente pelo resultado dessa API, sem aceitar edição manual. Quando a resposta contém `active` booleano, `true` SHALL ser apresentado como `ATIVO` e `false` como `INATIVO`; quando `active` não existir, `world` preenchido SHALL indicar `ATIVO` e `world` ausente/vazio SHALL indicar `INATIVO`. O gateway SHALL disponibilizar o jogo/sistema ativo quando informado e SHALL usar `INDISPONÍVEL` para falha ou resposta inválida. A resposta pública SHALL conter somente valores normalizados, sem URL ou JSON bruto.

#### Scenario: Status não pode ser editado manualmente
- **WHEN** o admin cadastra ou edita uma campanha
- **THEN** a interface não oferece campo editável de `status`, que é preenchido pela integração

#### Scenario: Foundry informa mesa ativa
- **WHEN** o endpoint responde com JSON válido contendo `active: true` e, opcionalmente, `world` e `system`
- **THEN** o campo `status` da campanha exibe `ATIVO` e o sistema atual é informado quando disponível

#### Scenario: Foundry informa mesa inativa
- **WHEN** o endpoint responde com JSON válido contendo `active: false`
- **THEN** o campo `status` da campanha exibe `INATIVO`, como no retorno de `https://ninho.1nodado.com.br/api/status`

#### Scenario: API Foundry sem campo active
- **WHEN** o endpoint responde com JSON válido contendo `world` e `system`, mas sem `active`
- **THEN** `world` preenchido produz status `ATIVO`, enquanto `world` ausente ou vazio produz `INATIVO`, e o sistema é exibido quando há mesa ativa

#### Scenario: Foundry não está acessível
- **WHEN** o endpoint configurado falha, expira ou retorna uma resposta inválida
- **THEN** a campanha continua sendo exibida com `status` igual a `INDISPONÍVEL`, sem interromper a home

#### Scenario: Campanha sem endereço Foundry
- **WHEN** uma campanha não possui URL de status do Foundry
- **THEN** o gateway não tenta consultar uma instância e exibe `NÃO CONFIGURADO` em vez de um status manual legado

### Requirement: Proteger consultas a endpoints configurados
O servidor SHALL limitar as consultas externas aos endpoints HTTPS configurados, SHALL impor timeout e SHALL rejeitar redirecionamentos ou destinos de rede locais/privados para impedir que a integração seja usada para acessar serviços internos.

#### Scenario: Endpoint tenta redirecionar a consulta
- **WHEN** o endpoint configurado responde com redirecionamento para outro destino
- **THEN** o gateway não segue o redirecionamento e trata o status como indisponível

#### Scenario: URL aponta para rede privada
- **WHEN** o admin tenta salvar uma URL cujo destino resolve para endereço local ou privado
- **THEN** o servidor rejeita a URL e não realiza a consulta
