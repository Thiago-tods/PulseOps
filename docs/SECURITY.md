# Segurança

## Já implementado

- Helmet, CORS por lista de origens, rate limit global, filtro de erros sem vazamento de detalhes internos.
- Configuração validada na inicialização; `.env` ignorado pelo Git; `.env.example` sem segredos.
- `npm audit --omit=dev`: 0 vulnerabilidades (no momento da fase).

## Implementado na Fase 2

- Senhas com argon2id (nativo do Node). Login com resposta idêntica para e-mail inexistente e senha errada, e verificação fictícia para igualar o tempo.
- Access token JWT de 15 min; refresh token opaco com hash no banco, rotação e detecção de reuso (revoga a família).
- Cookie `HttpOnly`, `SameSite=Strict`, restrito a `/api/v1/auth`; verificação de `Origin` nas rotas de sessão.
- Isolamento: `organizationId` sempre do banco, nunca do cliente; papéis aplicados por guard; auditoria de cadastro, login e renomeação.
- Rate limit específico em cadastro (5/min), login (10/min) e refresh (30/min).
- Pendente: verificação de e-mail, recuperação de senha, bloqueio por tentativas por conta. Ver `docs/PHASE-2-REPORT.md`.

## Implementado na Fase 3 (SSRF)

- Pacote `@pulseops/http-guard`: IPs privados/reservados bloqueados (IPv4 e IPv6, incluindo IPv4-mapped e NAT64), URLs ofuscadas normalizadas, esquemas e portas restritos, sem credenciais na URL.
- DNS rebinding: o DNS é resolvido uma vez por salto, todos os endereços precisam ser públicos e a conexão vai ao IP validado.
- Redirecionamentos manuais (máx. 3), cada destino revalidado; corpo da resposta nunca lido; tempo limite total.
- Cadastro de monitores valida a URL (estática + DNS) e limita 20 monitores por organização.
- Regra: toda requisição a alvo de monitor deve passar por `safeRequest`.

## Implementado na Fase 5 (alertas e página pública)

- Webhooks usam apenas `safeRequest` (POST, sem seguir redirecionamentos). O destino é validado ao cadastrar e a cada envio.
- O destino de webhook é tratado como segredo: nunca retorna na API (só o servidor), não entra na auditoria nem em mensagens de erro.
- Página pública mostra apenas o nome público, estado e disponibilidade; não expõe URLs, ids, erros nem dados da organização. Página privada e inexistente são indistinguíveis. Limite de 60 req/min.
- Pendente: assinatura HMAC dos webhooks, canal de e-mail.

## Preparação de produção (Fase 6)

- Em produção a API não inicia sem `DATABASE_URL` e `JWT_ACCESS_SECRET`, nem com `CORS_ORIGINS` não-HTTPS ou local.
- Proxy do Cloudflare Pages: só `/api/v1/*`, métodos limitados, corpo de até 1 MiB, descarta cabeçalhos de IP forjados (`x-forwarded-for`, `x-real-ip`, `forwarded`...) e define o IP real a partir de `cf-connecting-ip`; erros viram 502 genérico.
- Cabeçalhos do frontend (`_headers`): CSP restritiva (sem scripts/estilos inline), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Verificada no navegador sem violações.
- Health: `/health` (liveness, sem banco) e `/health/ready` (readiness; 503 genérico se o banco falhar).
- **Corrigido e verificado em produção:** o limite de login não funcionava atrás do Render com `TRUST_PROXY=2` (IP da Cloudflare instável); com `TRUST_PROXY=3` identifica o IP real e não é burlado por `X-Forwarded-For` forjado. O limitador tem testes próprios. Para o proxy do Cloudflare Pages: o IP real vai em cabeçalho próprio com segredo compartilhado (tempo constante), os cabeçalhos são removidos após o uso, a Function falha fechada sem o segredo e o cabeçalho forjado sem segredo é ignorado.
- Pendente de validação no deploy real: `TRUST_PROXY`, comportamento do cookie `Secure` em HTTPS. Ver `docs/DEPLOYMENT.md`.

## Planejado (não implementado)

- **Cadastro**: verificação de e-mail e resposta sem revelar existência.
- **Execução**: limites de concorrência do worker e de tamanho de resposta ao integrar `safeRequest`.
- **Segredos**: credenciais de notificação cifradas (AES-GCM) com chave do ambiente; logs sem tokens.
