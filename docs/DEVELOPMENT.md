# Desenvolvimento

## Instalação e execução

```powershell
npm install
Copy-Item .env.example .env
npm run build          # compila shared e db (necessário antes de api/worker)
npm run dev:api
npm run dev:worker
npm run dev:web
```

`dev:api` e `dev:worker` compilam e iniciam (sem hot reload). `dev:web` usa o servidor do Vite.

## Variáveis de ambiente

Ver `.env.example`. API: `API_PORT`, `API_HOST`, `CORS_ORIGINS`, `LOG_LEVEL`, `DATABASE_URL`,
`JWT_ACCESS_SECRET` (obrigatório em produção), `MAX_MONITORS_PER_ORG` (padrão 20). Worker: `WORKER_POLL_INTERVAL_MS`, `WORKER_CONCURRENCY`,
`TASK_LEASE_SEC`, `SCHEDULER_BATCH_SIZE`, `CHECK_RETENTION_DAYS`. Web: `VITE_API_URL`.

## Testes com banco

`npm run test:e2e -w @pulseops/api` usa o `.env` da raiz e grava no banco `pulseops` local (e-mails `@e2e.pulseops.test`, removidos ao final). Sem `DATABASE_URL` e `JWT_ACCESS_SECRET`, esses testes são ignorados. O script usa `--experimental-vm-modules` porque o client Prisma 7 usa `import()` dinâmico.

Em desenvolvimento o frontend acessa a API pelo proxy do Vite (`/api`), em `http://localhost:5173`.

## Worker

`npm run dev:worker` (precisa de `DATABASE_URL`). Para ver verificações, rode API, worker e web juntos; os monitores aparecem com status após o primeiro ciclo (até alguns segundos). O worker só chama a rede por `safeRequest`.

`npm run test:db` roda os testes que usam o banco: e2e da API e integração do worker (`test:int`).

## Worker em execução única

`WORKER_MODE=once` processa o que está vencido e encerra com código 0 (usado pelo GitHub Actions). Teste local:

```powershell
$env:WORKER_MODE = "once"; node --env-file=.env apps/worker/dist/main.js
```

## Alertas

Em `/alertas` cadastre um webhook (HTTPS público) e use "Enviar teste". O worker precisa estar rodando para entregar. Destinos locais (`localhost`, redes privadas) são recusados de propósito; para testar localmente use um serviço público (ex.: um endpoint de teste de webhooks).

## Fuso horário

O `createPrismaClient` fixa `timezone=UTC` em toda conexão (o adapter-pg do Prisma 7 envia datas sem fuso). Em SQL cru, passe datas como ISO com `::timestamptz`, nunca como `Date`.

## Qualidade

`npm run lint`, `typecheck`, `build`, `test`, `format:check`, `db:validate`. CI em `.github/workflows/ci.yml`
(sem deploy).

## Banco

Usar somente o PostgreSQL 18 local (porta 5432). Criar banco/usuário e rodar migrações exige confirmação
específica; ver `docs/DATABASE.md`.

## Limitações

- Node 26 não aparece como versão oficialmente documentada para o Prisma 7 (ver relatório da fase).
- O script de instalação de `prisma` e `@prisma/engines` não é executado pelo npm 11 (`allowScripts`);
  `prisma validate` e `generate` funcionaram sem eles. Reavaliar ao rodar migrações.
