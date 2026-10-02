# Spec Delta

## Purpose

Garante que todas as respostas HTTP do gateway levem defesas de navegador e que os endpoints tenham limites de taxa e de tamanho contra abuso.

## ADDED Requirements

### Requirement: Cabeçalhos de segurança
Toda resposta SHALL incluir `Content-Security-Policy` restritiva (incluindo `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`), `X-Content-Type-Options: nosniff` e `Referrer-Policy: strict-origin-when-cross-origin`. Quando servido sob HTTPS, SHALL incluir `Strict-Transport-Security`. A CSP SHALL permitir apenas os recursos que a aplicação usa (scripts e estilos próprios, fontes do Google Fonts, imagens `self` e `https:`).

#### Scenario: Página inicial
- **WHEN** um cliente requisita `/`
- **THEN** a resposta contém CSP com `frame-ancestors 'none'` e `nosniff`

#### Scenario: Incorporação em iframe
- **WHEN** outra origem tenta exibir `/admin` em um iframe
- **THEN** o navegador bloqueia a exibição pela política de ancestrais

#### Scenario: HSTS sob HTTPS
- **WHEN** a requisição é HTTPS (direta ou via proxy confiável)
- **THEN** a resposta contém `Strict-Transport-Security`

### Requirement: Limite de taxa geral
Os endpoints `/api/campaigns`, `/uploads/*` e `/api/admin/*` SHALL ter limite de requisições por cliente numa janela, respondendo 429 com `Retry-After` ao exceder.

#### Scenario: Excesso em endpoint público
- **WHEN** um cliente excede o limite em `/api/campaigns`
- **THEN** as requisições seguintes recebem 429 com `Retry-After` até o fim da janela

### Requirement: Limite de tamanho de corpo
O servidor SHALL rejeitar com 413, antes de carregar o corpo em memória, requisições JSON maiores que 64 KB e uploads maiores que o limite de imagem acrescido de overhead multipart.

#### Scenario: Corpo JSON gigante
- **WHEN** um admin autenticado envia um JSON de 10 MB
- **THEN** o servidor responde 413

### Requirement: Escuta e cookie seguros por padrão em produção
Com `NODE_ENV=production`, o cookie de sessão SHALL ser `Secure` salvo configuração explícita em contrário, e `CODEX_BASE_URL` SHALL exigir `https:`.

#### Scenario: Codex em http em produção
- **WHEN** o servidor inicia em produção com `CODEX_BASE_URL=http://...`
- **THEN** o processo encerra com erro de configuração
