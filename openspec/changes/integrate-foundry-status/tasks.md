# Tasks

## 1. Campaign Configuration and Persistence

- [x] 1.1 Remove `foundry_status_url` from shared types, schemas, repository reads/writes and admin form, keeping the nullable legacy DB column for rollback compatibility; verify only the Foundry address remains as the source for deriving `/api/status`.
- [x] 1.2 Remove manual status editing and derive the public `status` value from `active` (or legacy `world` fallback); verify `active: false` maps to `INATIVO`, missing Foundry URL maps to `NÃO CONFIGURADO`, and failures map to `INDISPONÍVEL`.

## 2. Foundry Status Integration

- [x] 2.1 Derive the Foundry status endpoint from the stored Foundry address and support `active` plus the existing `world`/`system` response format; verify against the observed ninho and piloto JSON responses.
- [x] 2.2 Return API-derived `status` and active system publicly without exposing the endpoint URL or raw payload; verify a failed upstream still leaves the campaign in the response.
- [x] 2.3 Update the public campaign card and admin form to show API-derived status and remove manual status/endpoint inputs; verify campaigns without a Foundry address display `NÃO CONFIGURADO` instead of stale status.
