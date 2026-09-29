# Design

## Context

O gateway já persiste campanhas em SQLite e possui API pública e área administrativa. A configuração administrativa já tem `foundry_url`; a implementação atual adicionou também uma URL de status separada e mantém status digitado manualmente. Esta revisão remove esses dois pontos de duplicação e deriva `/api/status` do endereço Foundry. Ver `proposal.md` e `specs/foundry-status/spec.md` para o comportamento pretendido.

## Goals / Non-Goals

**Goals:**
- Derivar um endpoint por campanha e consultar o status sem depender do navegador nem de CORS.
- Expor à home somente dados normalizados de disponibilidade, mesa e jogo ativo.
- Preservar a campanha quando a instância não responder e indicar indisponibilidade, sem exibir status legado como atual.

**Non-Goals:**
- Controlar ou autenticar usuários dentro do Foundry.
- Consultar dados privados do mundo, personagens ou sessões.
- Alterar ou instalar módulos no Foundry.

## Decisions

### URL de status derivada

Não persistir `foundry_status_url`. Derivar a URL acrescentando `/api/status` ao caminho base, removendo barras finais antes de acrescentar o sufixo para evitar duplicação. Preservar esquema, host, porta e prefixo de caminho. A URL base segue validada como HTTPS; destinos locais/privados são rejeitados antes de salvar e antes das consultas.

### Consulta feita pelo servidor e cacheada

Adicionar um adaptador no servidor para consultar a URL derivada com timeout curto, limite de tamanho de resposta e sem seguir redirecionamentos. Reutilizar o padrão de cache em memória já usado para o catálogo do Codex, evitando uma chamada externa por visitante; após expirar o cache, atualizar em segundo plano ou na próxima leitura. Uma falha não invalida nem remove a campanha.

### Contrato público normalizado

Preencher o campo público existente `status` com `ATIVO`, `INATIVO`, `INDISPONÍVEL` ou `NÃO CONFIGURADO`, e o campo existente `system` com o sistema ativo quando retornado pela API. Não adicionar campos de resposta específicos da integração nem retornar a URL derivada ou o JSON bruto. A interpretação deve tolerar campos opcionais do endpoint Foundry.

Os endpoints consultados têm dois formatos válidos: `ninho` retorna `active` booleano (por exemplo `false`); `piloto` retorna `world` (slug da mesa), `system` (id do sistema), `systemVersion`, `users` e `uptime`. Usar `active` quando presente; nos formatos sem esse campo, inferir atividade de `world`. Mapear o resultado para `ATIVO`, `INATIVO` ou `INDISPONÍVEL`, e não expor JSON bruto, URL, contagem de usuários ou uptime.

O campo manual de `status` deixa de ser fonte de dados. A API pública preenche `status` do adaptador de forma dinâmica; campanhas sem endereço Foundry não devem tratar o valor legado persistido como estado atual.

### Segurança de rede

O cliente HTTP deve rejeitar redirecionamentos e destinos loopback, link-local, privados e reservados após resolução DNS. A resolução e a conexão precisam usar o mesmo endereço validado para evitar DNS rebinding. Limitar método a GET, tempo, tamanho do corpo e tipo JSON. Não registrar conteúdo da resposta nem credenciais em logs.

## Risks / Trade-offs

- [O formato de `/api/status` pode variar entre versões do Foundry] → Validar somente os campos necessários, aceitar os formatos observados (`active` e `world`) e usar `INDISPONÍVEL` para respostas inválidas.
- [Consultas externas podem aumentar latência ou indisponibilizar parcialmente a API pública] → Cachear por instância e manter timeout curto; retornar a campanha com `INDISPONÍVEL`.
- [URL controlada por admin ainda pode ser usada para SSRF] → Bloquear redirecionamentos e endereços locais/privados e fixar a conexão ao IP público validado.

## Migration Plan

Parar de ler e escrever `foundry_status_url` na aplicação; manter a coluna SQLite anulável já criada como sobra inerte para permitir rollback direto à versão anterior. Campanhas existentes mantêm os demais dados; seus valores legados de `status` deixam de ser usados como estado atual e passam a ser derivados da API (ou `NÃO CONFIGURADO` sem endereço Foundry).
