# Política de segurança

## Reportar uma vulnerabilidade

Não abra uma issue pública. Envie os detalhes (passos para reproduzir, impacto e versão) por e-mail para o mantenedor do repositório ou use o recurso de *private vulnerability reporting* do GitHub, se estiver habilitado. A resposta inicial deve ocorrer em até 7 dias.

## Modelo de ameaças resumido

- **Superfície pública:** `GET /api/campaigns`, `/uploads/*` e a SPA. Sem autenticação, com limite de taxa por IP.
- **Superfície administrativa:** `/api/admin/*`, protegida por senha única, sessão revogável, limite de tentativas, checagem de origem (CSRF) e auditoria em log.
- **Saídas de rede do servidor:** catálogo do codex (`CODEX_BASE_URL`), status do Foundry e download de capas. Todas exigem https; as duas últimas só alcançam IPs públicos, fixam o IP resolvido, não seguem redirecionamentos e limitam tamanho e tempo.

## Checklist de implantação

- [ ] `ADMIN_PASSWORD` com 12+ caracteres, única e guardada em gerenciador de segredos; `SESSION_SECRET` com 32+ caracteres aleatórios.
- [ ] Serviço publicado somente por HTTPS (o cookie é `Secure` em produção).
- [ ] Atrás de proxy: `TRUSTED_PROXY=true`, `TRUSTED_PROXY_HOPS` igual ao número de proxies, `PUBLIC_ORIGIN` definido.
- [ ] Porta do app não exposta diretamente à internet.
- [ ] Container com `--read-only`, `--cap-drop ALL` e `no-new-privileges`; volume `/data` com backup.
- [ ] Imagem base e dependências atualizadas (`npm audit`, troca do digest no `Dockerfile`).
- [ ] Logs de auditoria (`"type":"audit"`) coletados e com retenção definida.

## Limitações conhecidas

- Há uma única conta administrativa, sem MFA. Para exposição ampla, coloque `/admin` atrás de VPN ou Cloudflare Access.
- Os limites de taxa e o bloqueio de login ficam em memória e valem por instância; reiniciar o processo os zera.
- O limite global de falhas de login protege contra ataques distribuídos, mas permite que um atacante force bloqueios temporários do login. A sessão já aberta do admin não é afetada.
- Imagens externas por URL (`imageSource: url`) continuam carregadas direto do host informado, o que expõe o IP do visitante a esse host. Prefira enviar o arquivo.
