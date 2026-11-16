# Relatório da Fase 6: preparação de deploy (não executado)

Nenhuma conta foi criada, nenhum serviço configurado e nada foi publicado ou commitado. Esta fase preparou o
código e os arquivos de infraestrutura, e levantou os limites reais dos planos gratuitos.

## Resultado principal: o intervalo de 5 min não cabe no plano gratuito

Pelos limites oficiais (ver `docs/DEPLOYMENT.md`):

- O Render gratuito **não tem workers** (só web services, que dormem após 15 min). O worker precisa rodar no
  GitHub Actions.
- O Neon gratuito tem **100 CU-horas/mês** e suspende após 5 min sem consulta. Um acesso a cada 5 min o mantém
  ligado o mês todo: ~180 CU-h se o mínimo for 0,25 CU (não confirmei o mínimo), acima do limite. A cada 15 min
  fica em ~61 CU-h.
- O GitHub Actions em repositório privado dá ~2.000 min/mês; a cada 15 min o worker gasta ~2.900-5.800 min.
  Em repositório público é gratuito.

**Decisão necessária:** manter 5 min exige banco/worker pagos ou próprios; no custo zero, a frequência realista é
**15 min** (repositório público) com `MIN_MONITOR_INTERVAL_SEC=900`.

## O que foi implementado

- **Worker em execução única** (`WORKER_MODE=once`): agenda o vencido, executa verificações e as notificações
  geradas por elas, e encerra com código 0 (limite de tempo configurável). `SCHEDULER_LEAD_SEC` adianta monitores
  quase vencidos para compensar atraso de cron.
- **Intervalo mínimo configurável** (`MIN_MONITOR_INTERVAL_SEC`): a API recusa intervalos menores, para o produto
  não prometer o que o worker não cumpre.
- **Proxy `/api` do Cloudflare Pages** (`functions/api/[[path]].ts`): mantém o cookie de refresh
  (`SameSite=Strict`) de primeira parte. Só `/api/v1/*`, métodos limitados, corpo até 1 MiB, descarta cabeçalhos
  de IP forjados, 502 genérico.
- **Cabeçalhos de segurança** (`apps/web/public/_headers`): CSP restritiva, HSTS, anti-iframe, `nosniff`.
- **API:** `GET /health/ready` (503 genérico sem o banco), pool de conexões configurável (`DB_POOL_MAX`),
  timeouts adequados a bancos serverless, e validação de produção (exige `DATABASE_URL` e `JWT_ACCESS_SECRET`;
  recusa `CORS_ORIGINS` não-HTTPS ou local).
- **Arquivos de infraestrutura:** `render.yaml`, `.github/workflows/worker.yml` (agendamento **desativado**),
  `ci.yml` agora com PostgreSQL de teste (roda as migrações e os testes com banco), `.env.production.example`,
  script `npm run db:migrate:deploy` e o guia `docs/DEPLOYMENT.md`.

## Verificações executadas

| Verificação                                | Resultado                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, build, Prettier           | OK                                                                                                                                                                                                                                                                                                  |
| Testes unitários                           | shared 2, http-guard 84, api 17, worker 30, web 39: todos passaram                                                                                                                                                                                                                                  |
| e2e da API no PostgreSQL 18 real           | 70 passaram                                                                                                                                                                                                                                                                                         |
| Integração do worker no PostgreSQL 18 real | 31 passaram                                                                                                                                                                                                                                                                                         |
| `npm audit --omit=dev`                     | 0 vulnerabilidades                                                                                                                                                                                                                                                                                  |
| **Interface no navegador** (primeira vez)  | servidor local aplicando a CSP e proxy de `/api`: cadastro pela tela, painel, **recarga da página manteve a sessão** pelo cookie, monitor cadastrado pela tela, worker real em modo `once` (saiu sozinho, código 0, 1 s) e o monitor apareceu como **Operacional, 64 ms** com horário no fuso local |
| Segurança no navegador                     | sem violações de CSP; nada em `localStorage`/`sessionStorage`; cookie de refresh invisível ao JavaScript                                                                                                                                                                                            |
| Dados de teste                             | removidos (banco com 0 usuários, organizações e tarefas)                                                                                                                                                                                                                                            |

## O que NÃO foi verificado

- Nenhum serviço real (Neon, Render, Cloudflare, GitHub): os workflows, o `render.yaml` e a Function não foram
  executados fora desta máquina. Os YAMLs só passaram pela validação de sintaxe do Prettier.
- O proxy foi testado por testes unitários e por um servidor local equivalente, **não** no runtime do Cloudflare.
- Cookie `Secure` e HTTPS reais, `TRUST_PROXY=2`, Node 26 no Render e a imagem `postgres:18` do CI são
  suposições (lista em `docs/DEPLOYMENT.md`).
- A captura de tela da interface falhou na segunda tentativa (a janela do app não estava renderizando); a
  verificação visual se baseou no texto da página e na primeira captura (tela de cadastro, tema escuro).

## Autorizações necessárias para o deploy

Criar contas (GitHub, Neon, Render, Cloudflare), primeiro commit e remoto Git, migrações no banco de produção,
publicar API e frontend e ativar o agendamento do worker.

## Próxima etapa sugerida

Decidir a frequência (15 min no custo zero) e a visibilidade do repositório (público ou privado), e então
autorizar o primeiro commit e a criação das contas para executar o `docs/DEPLOYMENT.md`.
