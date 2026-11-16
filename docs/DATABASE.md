# Banco de dados

Schema: `packages/db/prisma/schema.prisma` (Prisma 7.10.1, PostgreSQL). IDs UUID v7 gerados pelo Prisma.

A URL de conexão vem de `DATABASE_URL` (`prisma.config.ts`); sem ela, `validate` e `generate` usam um placeholder que não conecta.

**Migrações** (em `packages/db/prisma/migrations`):

| Migração                                   | Conteúdo                                                                                                                                               | Local    | Neon (produção)                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------- |
| `20261116000000_init`                      | 15 tabelas e o índice parcial `incidents_one_open_per_monitor`                                                                                         | aplicada | aplicada em 2026-11-16                |
| `20261117000000_alerts_notifications`      | enum `NotificationEvent`, `notifications.event`, índice único `(incident_id, alert_rule_id, event)`, `alert_rules.name`, remove `consecutive_failures` | aplicada | aplicada em 2026-11-16                |
| `20261118000000_alert_rule_signing_secret` | coluna `alert_rules.signing_secret` (anulável, aditiva)                                                                                                | aplicada | **pendente** (ver docs/DEPLOYMENT.md) |

## Entidades

User, Organization, Membership, Invitation, Session, Monitor, MonitorCheck, Incident, IncidentUpdate,
AlertRule, Notification, StatusPage, StatusPageMonitor, AuditLog, WorkerTask. Tabelas em snake_case plural.

## Regras principais

- **Uma organização por usuário**: `memberships.user_id` é `@unique`. Papéis: OWNER, ADMIN, MEMBER, VIEWER.
- `monitors`: `interval_sec` padrão 300; método GET ou HEAD; `@@unique(organization_id, name)`; índice
  `(enabled, next_run_at)` para o agendador.
- `monitor_checks`: `expires_at` padrão `now() + 30 dias`; índices `(monitor_id, checked_at desc)` e
  `(expires_at)` para a limpeza.
- `worker_tasks`: índice `(status, run_at)`, lease por `locked_until`, `dedupe_key` único.
- `sessions`: guarda apenas o hash do refresh token (`refresh_hash` único) e `family_id` para rotação.

## Exclusão

- Organization → CASCADE em memberships, invitations, monitors, incidents, alert_rules, notifications,
  status_pages, audit_logs, worker_tasks.
- User → CASCADE em sessions e membership; `SET NULL` em autor de updates e ator de auditoria.
- Monitor → CASCADE em checks, alert_rules e status_page_monitors; `SET NULL` em incidents (preserva histórico).

## Colunas cifradas

`alert_rules.target` (URL do webhook) e `alert_rules.signing_secret` guardam valores cifrados na aplicação (AES-256-GCM, formato `v1:<chave>:<iv>:<tag>:<texto>`). Valores sem o prefixo `v1:` são regras anteriores à cifra; o script `npm run webhooks:reencrypt` os converte.

## Pendências

- E-mails guardados em minúsculas pela aplicação (sem `citext`, que exigiria extensão).
- Retenção: `monitor_checks`, tarefas concluídas e sessões expiradas são limpas pelo worker; `audit_logs`, `notifications` e `incident_updates` ainda crescem sem limite.
- RLS opcional e papel de banco com privilégio mínimo (ver docs/SECURITY.md).
