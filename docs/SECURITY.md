# Segurança

Legenda de evidência: **Prod** = verificado em produção; **Teste** = coberto por teste automatizado (CI);
**Código** = implementado, sem teste dedicado; **Pendente** = não implementado.

## Autenticação e sessões

| Controle                                                                                                                           | Evidência     |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Senhas com argon2id (nativo do Node); login com resposta idêntica para e-mail inexistente e senha errada, com tempo igualado       | Teste         |
| Access token JWT HS256 de 15 min (`iss`, `aud`, algoritmo fixo); mantido só em memória no navegador                                | Teste         |
| Refresh token opaco (256 bits), só o hash SHA-256 no banco; rotação a cada uso; reuso revoga toda a família                        | Teste + Prod  |
| Cookie `HttpOnly; Secure; SameSite=Strict`, restrito a `/api/v1/auth`                                                              | Prod          |
| Verificação de `Origin` nas rotas de sessão                                                                                        | Teste         |
| Usuário desativado é recusado a cada requisição (papel e organização lidos do banco, nunca do token)                               | Código        |
| Limites: cadastro 5/min, login 10/min, refresh 30/min, global 100/min, por IP real (o de login tem teste e foi medido em produção) | Código + Prod |

**Limitações conhecidas:** o cadastro devolve 409 para e-mail já existente, o que permite descobrir contas (limitado
a 5 tentativas por minuto por IP); corrigir de verdade exige verificação por e-mail, que depende de um serviço de
envio externo. Não há bloqueio por conta, só por IP, nem recuperação de senha. O access token não é revogável antes
de expirar (15 min). Os contadores do limitador ficam em memória e zeram quando o Render reinicia a API.

## Autorização e multi-tenant

- Guards globais (`JwtAuthGuard`, `RolesGuard`); toda rota é protegida, salvo as marcadas com `@Public()`.
- `organizationId` sempre vem do vínculo no banco; um id de outra organização responde 404, sem revelar que existe.
- Leitura: qualquer papel. Escrever monitores: OWNER, ADMIN, MEMBER. Excluir, alertas e página de status: OWNER e
  ADMIN. (Teste.) Hoje todo cadastro cria uma organização própria (OWNER); não há convites, então MEMBER e VIEWER
  só existem por alteração direta no banco.

## SSRF (monitores e webhooks)

Pacote `@pulseops/http-guard` (Teste): IPs privados e reservados bloqueados (IPv4, IPv6, IPv4-mapped, NAT64), URLs
ofuscadas normalizadas, apenas `http`/`https`, sem credenciais, portas 80/443/8080/8443, nomes locais recusados.
DNS resolvido uma vez por salto e **todos** os endereços precisam ser públicos (anti DNS rebinding); a conexão vai
ao IP validado; redirecionamentos manuais (máximo 3, cada um revalidado); `POST` nunca segue redirecionamento; o
corpo da resposta nunca é lido; tempo limite total. Toda requisição a alvo de usuário passa por `safeRequest`.

## Webhooks

| Controle                                                                                                                                        | Evidência |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Destino e segredo de assinatura **cifrados em repouso** (AES-256-GCM, IV aleatório, contexto autenticado, formato `v1:<kid>:…`)                 | Teste     |
| Chave em `WEBHOOK_ENCRYPTION_KEY` (obrigatória em produção); rotação com `WEBHOOK_ENCRYPTION_KEY_PREVIOUS` e `npm run webhooks:reencrypt`       | Teste     |
| Assinatura HMAC-SHA256 com timestamp (`x-pulseops-signature`), segredo por regra mostrado uma vez, rotacionável; ver [WEBHOOKS.md](WEBHOOKS.md) | Teste     |
| O destino nunca volta inteiro pela API (só mascarado), não entra na auditoria, nos logs nem em mensagens de erro                                | Teste     |
| Validação do destino ao cadastrar e a cada envio                                                                                                | Teste     |

A chave de criptografia protege contra vazamento do banco ou de backups; **não** protege contra quem controla o
servidor da API ou o worker (eles precisam da chave). Perder a chave torna os webhooks existentes ilegíveis: guarde
uma cópia segura. Regras antigas sem segredo enviam sem assinatura até "Gerar segredo".

## Página pública de status

Mostra só nome público, estado e disponibilidade; não expõe URLs, ids, erros nem dados da organização. Página
privada e inexistente são indistinguíveis (404). Limite de 60 req/min por IP. (Teste.) Cada consulta agrega 30 dias
de verificações; não há cache.

## Infraestrutura

- **Prod:** HTTPS com redirecionamento, CSP restritiva (sem scripts ou estilos inline), HSTS, `X-Frame-Options:
DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, cache imutável em `/assets`; API com Helmet e CORS por
  lista de origens (origem alheia não recebe `Access-Control-Allow-Origin`); `/health/client` (diagnóstico) responde 404.
- **Configuração:** em produção a API não inicia sem `DATABASE_URL`, `JWT_ACCESS_SECRET` e
  `WEBHOOK_ENCRYPTION_KEY`, nem com `CORS_ORIGINS` não HTTPS ou local (Teste).
- **IP do cliente atrás de proxies (Prod):** `TRUST_PROXY=3` para acesso direto ao Render (medido). Com o Cloudflare
  Pages, a Function envia o IP real em `x-pulseops-client-ip` com `x-pulseops-proxy-secret` (comparação em tempo
  constante); a API só confia se o segredo bater e remove os dois cabeçalhos; cabeçalhos forjados sem o segredo são
  ignorados. A Function só encaminha `/api/v1/*`, limita métodos e o corpo (1 MiB) e **falha fechada** sem o
  segredo (mínimo 32 caracteres).
- **Dependências:** `npm audit --omit=dev` retorna 0 vulnerabilidades. O `npm audit` completo aponta achados em
  ferramentas de desenvolvimento (Jest e typescript-eslint), que não vão para produção.
- **GitHub Actions:** `permissions: contents: read`; o worker só roda com o secret configurado.

## Banco de dados

O aplicativo usa hoje o papel proprietário do projeto Neon (privilégios amplos). Um papel restrito (apenas
`SELECT/INSERT/UPDATE/DELETE` nas tabelas) para a API e o worker, mantendo o proprietário só para migrações, é a
melhoria planejada. Ainda não foi feita.

## Pendente

- Verificação de e-mail, recuperação de senha, bloqueio por conta e resposta de cadastro sem revelar existência.
- Papel de banco com privilégio mínimo.
- Canal de e-mail para alertas (depende de serviço externo).
- Retenção de `audit_logs`, `notifications` e `incident_updates` (hoje crescem sem limite).
- Cache da página pública de status.
