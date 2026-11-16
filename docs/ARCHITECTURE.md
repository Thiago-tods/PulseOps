# Arquitetura

Monólito modular: a API (NestJS) e o worker compartilham pacotes (`shared`, `http-guard`, `db`), mas rodam em processos
separados. O frontend é uma SPA independente.

## Responsabilidades

- **api**: HTTP, autenticação, autorização, CRUD. Prefixo `/api/v1`, Helmet, CORS configurável, rate limit
  global (100 req/min por IP), filtro global de erros (não vaza detalhes em 5xx), logs JSON.
- **worker**: executa tarefas persistidas no PostgreSQL (`worker_tasks`, claim com
  `FOR UPDATE SKIP LOCKED`), verificações HTTP e limpeza de retenção. Implementado na Fase 4: agendador, fila com lease e backoff, verificação via `safeRequest`, incidentes, retenção, logs estruturados e encerramento controlado (ver `docs/PHASE-4-REPORT.md`).
- **web**: React + Vite, tema dark, pt-BR. Login, cadastro, painel de incidentes e gestão de monitores
  (com status e histórico) usam a API; o access token fica só em memória.
- **shared**: schemas zod, constantes e tipos (compilado em CommonJS; o web usa um alias para o código-fonte).
- **db**: schema Prisma e `createPrismaClient` (driver adapter `@prisma/adapter-pg`).

## Módulos da API (fronteiras reservadas)

auth, users, organizations, monitors, checks, incidents, alerts, notifications, status-pages, audit, common,
health. Implementados: `health`, `auth`, `organizations`, `monitors`, `incidents` (leitura), `alerts`, `notifications`, `status-pages` e `audit`.

## Decisões

- Configuração: variáveis de ambiente validadas com zod na inicialização (falha rápida, sem expor valores).
- Multi-tenant: toda tabela de negócio carrega `organization_id`; o filtro vem do contexto autenticado (nunca de parâmetros do cliente).
- Fila: PostgreSQL (sem Redis), mantendo custo zero.
- Retenção: 30 dias (`monitor_checks.expires_at` + tarefa diária de limpeza no worker).
