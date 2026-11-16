# Relatório da Fase 5: alertas, notificações e página de status

## O que foi implementado

**Webhooks seguros (`@pulseops/http-guard`).** `safeRequest` passou a aceitar `POST` com corpo e cabeçalhos. Todas as proteções de SSRF continuam valendo (validação de URL, IPs públicos, DNS fixado, tempo limite). Em `POST` os redirecionamentos **não** são seguidos, para nunca reenviar o corpo a outro destino.

**Banco (migração `20261117000000_alerts_notifications`).** Novo enum `NotificationEvent` (`INCIDENT_OPENED`, `INCIDENT_RESOLVED`, `TEST`), coluna `notifications.event`, índice único `(incident_id, alert_rule_id, event)` (impede notificação duplicada), `alert_rules.name` e remoção do campo sem uso `consecutive_failures`. A migração contém também uma linha redundante sobre o default de `monitor_checks.expires_at` (mesmo valor, só parênteses diferentes). Como já foi aplicada, não foi editada.

**API**

| Rota                                                                    | Papéis         |
| ----------------------------------------------------------------------- | -------------- |
| `GET /alert-rules`                                                      | qualquer papel |
| `POST`, `PATCH /:id`, `DELETE /:id`, `POST /:id/test` em `/alert-rules` | OWNER, ADMIN   |
| `GET /notifications`                                                    | qualquer papel |
| `GET /status-page`                                                      | qualquer papel |
| `PUT /status-page`                                                      | OWNER, ADMIN   |
| `GET /public/status/:slug`                                              | público        |

- Regras: apenas canal `WEBHOOK` (e-mail depende de SMTP externo e é recusado com 400). Máximo de 10 por organização. Destino validado como os monitores (estático + DNS). Um monitor específico ou todos. O destino **nunca é devolvido** (só `https://servidor/…`), nem gravado na auditoria ou em mensagens de erro, porque URLs de webhook costumam carregar segredos.
- Teste: `POST /alert-rules/:id/test` enfileira uma notificação `TEST` (limite de 5 por minuto).
- Página de status: uma por organização, endereço único global (3 a 40 caracteres, palavras reservadas bloqueadas), nome público opcional por monitor.
- Endpoint público: página privada e inexistente respondem **exatamente igual** (404). A resposta traz só estado, disponibilidade em 30 dias, última verificação e incidentes dos últimos 14 dias, com o **nome público**. Não traz URL, ids, mensagens de erro, e-mails nem a organização. Limite de 60 req/min e `Cache-Control: public, max-age=30`.

**Worker**

- Ao abrir ou resolver um incidente, na mesma transação, cria uma notificação e uma tarefa `SEND_NOTIFICATION` para cada regra ativa aplicável (global ou do monitor).
- `SendNotificationHandler` envia um POST JSON (`event`, `text` para Slack, `content` para Discord, `incident`, `monitor`, `sentAt`) com `X-PulseOps-Event` e `X-PulseOps-Delivery`. Sucesso é 2xx. É idempotente (já enviada não reenvia). Em falha registra tentativa e motivo, reagenda com backoff e marca `FAILED` na última tentativa. Regra removida ou desativada: `FAILED` sem tentar enviar.

**Frontend:** páginas `/alertas` (regras, enviar teste, ativar/desativar, excluir e notificações recentes), `/pagina-de-status` (configuração) e `/status/:slug` (pública, fora do layout autenticado). Formulários e botões respeitam o papel.

## Verificações executadas

| Verificação                                | Resultado                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, build, Prettier           | OK                                                                                                                                                                                                       |
| Testes unitários                           | shared 2, http-guard 84, api 10, worker 26, web 22: todos passaram                                                                                                                                       |
| e2e da API no PostgreSQL 18 real           | 67 passaram                                                                                                                                                                                              |
| Integração do worker no PostgreSQL 18 real | 29 passaram                                                                                                                                                                                              |
| API e worker em processos reais + internet | destino interno recusado (400); webhook enviado a `httpbin.org` com resultado `SENT` na 1ª tentativa; página pública com `PARTIAL_OUTAGE`, uptime 100% e 0%, incidente com nome público; sem URL no JSON |
| `npm audit --omit=dev`                     | 0 vulnerabilidades                                                                                                                                                                                       |
| Dados de teste                             | removidos (banco com 0 usuários, organizações e tarefas)                                                                                                                                                 |

Os testes cobrem: SSRF em webhooks, regra de outro monitor/organização/desativada não notifica, destino secreto fora de listagens, auditoria e erros, limite de regras, papéis, isolamento entre organizações, slug (formato, reservado, duplicado), monitor de outra organização, vazamento de dados na página pública, página privada igual à inexistente, monitor pausado, e entrega com falha, retry, `FAILED` final e idempotência.

## Limitações conhecidas

- **Sem e-mail.** Exige um serviço SMTP externo e credenciais; o canal existe no banco mas a API o recusa.
- **Webhook sem assinatura.** A entrega não é assinada (HMAC); quem recebe só tem o segredo embutido na URL e o cabeçalho `X-PulseOps-Delivery`. Assinar exigiria guardar um segredo cifrado por regra.
- **Notificação só em abertura e resolução de incidente**; não há reenvio periódico nem escalonamento.
- **Uma página de status por organização**, sem domínio próprio e sem histórico de uptime por dia.
- O endpoint público pode ser cacheado por 30 s; o estado exibido pode estar levemente defasado.
- A página pública em produção depende de o worker estar rodando (sem ele, os dados envelhecem).
- Não foi aberta a interface no navegador; o frontend foi validado por testes e build.
- `httpbin.org` é um serviço de terceiros usado só no teste manual; nenhum dado real foi enviado.

## Próxima etapa sugerida

Fase 6: preparação de deploy (sem executá-lo): variáveis de produção, estratégia de cookie para domínios diferentes (Cloudflare Pages + Render), migrações no Neon, CI com banco de testes e checklist de limites dos planos gratuitos. O deploy em si exige criar contas e dependerá de autorização expressa.
