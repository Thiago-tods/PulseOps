# PulseOps

Plataforma SaaS de monitoramento de APIs e gestão de incidentes. Monorepo com npm workspaces.

> Estado: **Fase 5**: autenticação, monitores com proteção contra SSRF, worker de verificações e incidentes, alertas por webhook e página de status pública. Deploy preparado (não executado): ver `docs/DEPLOYMENT.md`. Ainda não há envio de e-mail.

## Aplicações e pacotes

| Caminho               | Função                                              |
| --------------------- | --------------------------------------------------- |
| `apps/api`            | API NestJS 11 (`/api/v1`)                           |
| `apps/worker`         | Worker (entry point separado; esqueleto)            |
| `apps/web`            | Frontend React + Vite, tema dark, pt-BR             |
| `packages/shared`     | Constantes, schemas zod e tipos compartilhados      |
| `packages/http-guard` | Validação de URLs e requisições seguras (SSRF)      |
| `packages/db`         | Schema Prisma 7 e fábrica do client (PostgreSQL 18) |

## Requisitos

Node.js 26.13.0 (`.nvmrc`), npm 11, PostgreSQL 18 local (porta 5432). Sem Docker/WSL.

## Início rápido

```powershell
npm install
Copy-Item .env.example .env   # preencha localmente; nunca commitar
npm run build
npm run dev:api      # http://127.0.0.1:3000/api/v1/health
npm run dev:web      # http://127.0.0.1:5173
npm run dev:worker
```

## Scripts (raiz)

`build`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `db:validate`, `db:generate`,
`dev:api`, `dev:web`, `dev:worker`. Testes e2e da API: `npm run test:e2e -w @pulseops/api`.

Documentação: [`docs/`](docs) (arquitetura, banco, segurança, desenvolvimento, relatório da fase).
