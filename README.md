# PulseOps

Plataforma SaaS de monitoramento de disponibilidade de sites e APIs e gestão de incidentes, construída como
projeto de portfólio com **custo zero** de infraestrutura.

**Em produção:** <https://pulseops-cq4.pages.dev> · Licença [MIT](LICENSE)

## O que faz

- **Monitores HTTP** (GET/HEAD) com intervalo, tempo limite, status esperado e limiar de falhas; histórico de 30 dias.
- **Incidentes** abertos e resolvidos automaticamente, com histórico de atualizações.
- **Alertas por webhook** (compatíveis com Slack e Discord) com entrega repetida em caso de falha, destino
  **cifrado** no banco e **assinatura HMAC** verificável pelo receptor ([docs/WEBHOOKS.md](docs/WEBHOOKS.md)).
- **Página de status pública** com disponibilidade dos últimos 30 dias, sem expor URLs nem dados internos.
- **Contas e organizações** isoladas (multi-tenant), papéis, sessões com rotação de refresh token e auditoria.
- **Proteção contra SSRF** em toda requisição a endereço informado pelo usuário.

Interface em pt-BR, tema escuro.

## Arquitetura

```
Navegador ──► Cloudflare Pages (SPA React + Function /api)  ──►  API NestJS (Render)  ──►  PostgreSQL (Neon)
                                                                                              ▲
                                       GitHub Actions (cron, a cada 15 min) ──► Worker ───────┘
                                                                                  └─► sites monitorados e webhooks (via safeRequest)
```

Monólito modular: a API e o worker compartilham pacotes, mas rodam em processos separados. A fila de tarefas fica
no próprio PostgreSQL (`FOR UPDATE SKIP LOCKED`, lease, backoff). Detalhes em
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Caminho               | Função                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| `apps/api`            | API NestJS 11 (`/api/v1`)                                                 |
| `apps/worker`         | Worker: agenda, verifica, abre/resolve incidentes, notifica, faz retenção |
| `apps/web`            | Frontend React 19 + Vite                                                  |
| `functions`           | Proxy `/api` do Cloudflare Pages (cookie de primeira parte, IP real)      |
| `packages/shared`     | Constantes, schemas zod e tipos compartilhados                            |
| `packages/http-guard` | Validação de URLs e requisições seguras (SSRF)                            |
| `packages/db`         | Schema Prisma 7, cifra de segredos e assinatura de webhooks               |

## Estado

| Área                                                 | Situação                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Autenticação, monitores, incidentes, alertas, status | Implementado, testado e **validado em produção**                                             |
| Worker em produção                                   | Roda no GitHub Actions; check real gravado. O cron do GitHub pode atrasar ou pular execuções |
| Webhooks cifrados e assinados                        | Implementado e testado; **publicação em produção pendente** (ver docs/DEPLOYMENT.md)         |
| E-mail (alertas, verificação, recuperação de senha)  | Não implementado (exige serviço externo)                                                     |
| Convites e papéis além de OWNER                      | Não implementado                                                                             |

## Limites do plano gratuito

Os intervalos de verificação mínimos são de **15 minutos** (limite de horas de computação do Neon gratuito). A API
do Render dorme após 15 min sem tráfego, então o primeiro acesso pode levar cerca de um minuto. Ver
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Requisitos e início rápido

Node.js 26.13.0 (`.nvmrc`), npm 11 e PostgreSQL 18 local (porta 5432). Sem Docker nem WSL.

```powershell
npm install
Copy-Item .env.example .env   # preencha localmente; nunca commitar
npm run build
npm run db:migrate:deploy      # aplica as migrações no banco do .env
npm run dev:api      # http://127.0.0.1:3000/api/v1/health
npm run dev:web      # http://127.0.0.1:5173
npm run dev:worker
```

## Scripts (raiz)

`build`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:db` (e2e da API e integração do
worker, exigem PostgreSQL local), `db:validate`, `db:generate`, `db:migrate:deploy`, `dev:api`, `dev:web`,
`dev:worker`, `webhooks:reencrypt`. O CI (`.github/workflows/ci.yml`) roda tudo isso contra um PostgreSQL 18
descartável.

## Documentação

[Arquitetura](docs/ARCHITECTURE.md) · [Segurança](docs/SECURITY.md) · [Webhooks](docs/WEBHOOKS.md) ·
[Banco de dados](docs/DATABASE.md) · [Desenvolvimento](docs/DEVELOPMENT.md) · [Deploy](docs/DEPLOYMENT.md) ·
relatórios por fase em `docs/PHASE-*-REPORT.md` (histórico).
