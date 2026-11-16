# Arquitetura

Monólito modular: a API (NestJS) e o worker compartilham pacotes (`shared`, `http-guard`, `db`), mas rodam em
processos separados. O frontend é uma SPA independente.

```
Navegador ─► Cloudflare Pages ─► API NestJS (Render) ─► PostgreSQL (Neon) ◄─ Worker (GitHub Actions, modo `once`)
              SPA + Function /api                                               └─► monitores e webhooks (safeRequest)
```

## Responsabilidades

- **api**: HTTP, autenticação, autorização, CRUD. Prefixo `/api/v1`, Helmet, CORS por lista de origens, limite de
  requisições (100/min por IP, mais restrito em login, cadastro, refresh e testes de alerta), filtro global de
  erros (não vaza detalhes em 5xx), logs JSON. Resolve o IP real do cliente atrás de proxies (`TRUST_PROXY` e o
  cabeçalho com segredo compartilhado do Pages).
- **worker**: executa tarefas persistidas em `worker_tasks` (reserva com `FOR UPDATE SKIP LOCKED`, lease, backoff
  exponencial e `dedupe_key`). Tipos de tarefa: `CHECK_MONITOR` (verificação via `safeRequest`, abertura e
  resolução de incidentes), `SEND_NOTIFICATION` (webhook decifrado, assinado e enviado via `safeRequest`) e
  `RETENTION` (limpeza diária). Dois modos: `daemon` (processo contínuo) e `once` (processa o que venceu e
  encerra; é o usado em produção pelo GitHub Actions).
- **web**: React + Vite, tema escuro, pt-BR. O access token fica só em memória; o refresh é cookie `HttpOnly`.
- **functions/api/[[path]].ts**: proxy do Cloudflare Pages. Mantém o cookie de sessão como de primeira parte,
  restringe a `/api/v1/*`, descarta cabeçalhos de IP forjados e envia o IP real com um segredo compartilhado.
- **shared**: schemas zod, constantes e tipos (compilado em CommonJS; o web usa um alias para o código-fonte).
- **db**: schema Prisma, `createPrismaClient` (driver adapter `@prisma/adapter-pg`, sessão em UTC), a cifra de
  segredos (`SecretBox`, AES-256-GCM) e a assinatura de webhooks.
- **http-guard**: validação de URLs e `safeRequest`, a única porta de saída de rede para endereços de usuários.

## Módulos da API

`auth`, `organizations`, `monitors` (inclui `/monitors/limits` e o histórico de verificações), `incidents`
(leitura), `alerts` (`/alert-rules`, teste e rotação do segredo de assinatura), `notifications`, `status-pages`
(administração e rota pública `/public/status/:slug`), `audit`, `health`, `common`.

## Fluxo de um incidente

1. O agendador do worker move `next_run_at` dos monitores vencidos e cria uma tarefa `CHECK_MONITOR` única por
   monitor e instante.
2. O handler faz a requisição por `safeRequest`, grava o resultado e decide: abrir incidente após N falhas
   consecutivas, ou resolver quando volta a responder.
3. Na **mesma transação** que abre ou resolve o incidente, uma notificação e uma tarefa `SEND_NOTIFICATION` são
   criadas para cada regra aplicável (índice único `(incidente, regra, evento)` evita duplicidade).
4. O envio decifra o destino, assina o corpo e faz o `POST`; falhas são reagendadas com backoff e, esgotadas as
   tentativas, a notificação fica como "Falhou". A entrega é "pelo menos uma vez" (`x-pulseops-delivery` permite
   deduplicar no receptor).

## Decisões

- **Configuração:** variáveis de ambiente validadas com zod na inicialização (falha rápida, sem expor valores).
- **Multi-tenant:** toda tabela de negócio carrega `organization_id`; o filtro vem do contexto autenticado, nunca de
  parâmetros do cliente. Um usuário pertence a uma única organização.
- **Fila no PostgreSQL** (sem Redis), mantendo custo zero.
- **Worker por cron externo:** o Render gratuito não tem workers; o GitHub Actions roda o worker em modo `once` a
  cada 15 minutos. Consequência: intervalo mínimo de 15 min e pontualidade sujeita ao agendador do GitHub.
- **Retenção:** 30 dias de verificações (`monitor_checks.expires_at` mais tarefa diária); tarefas e sessões
  antigas também são limpas.
- **Segredos de webhook** cifrados em repouso; a chave vem do ambiente (ver [SECURITY.md](SECURITY.md)).
