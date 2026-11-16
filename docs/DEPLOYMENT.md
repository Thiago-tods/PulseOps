# Guia de deploy

## Estado atual (2026-11-16): no ar, em plano gratuito

| Peça     | Onde                                         |
| -------- | -------------------------------------------- |
| Frontend | Cloudflare Pages: `pulseops-cq4.pages.dev`   |
| API      | Render (free): `pulseops-api-rnxg`           |
| Banco    | Neon (free), migrações aplicadas             |
| Worker   | GitHub Actions (`worker.yml`), a cada 15 min |

Verificado em produção pelo Pages: cadastro, cookie `HttpOnly; Secure; SameSite=Strict`, renovação de sessão,
criação de monitor, bloqueio de SSRF, limite de login com o IP real (10x 401 e 4x 429) e um check real feito
pelo worker (`UP`, HTTP 200).

### Como publicar o frontend de novo

O projeto Pages **não está ligado ao Git**: um push não atualiza o site. Da raiz do repositório:

```powershell
npm run build -w @pulseops/web
npx wrangler@4 pages deploy apps/web/dist --project-name pulseops --branch main
```

`API_ORIGIN` e `PROXY_SHARED_SECRET` estão como secrets do projeto Pages (`wrangler pages secret put`). A pasta
`functions/` é publicada junto.

### Cron do GitHub Actions não é garantido

O agendamento (`7,22,37,52 * * * *`) atrasa ou pula execuções em repositórios públicos. No primeiro dia, a
execução das :07 não veio; disparar manualmente (`workflow_dispatch`) funciona. Os checks podem sair com atraso
de dezenas de minutos; para pontualidade seria preciso outro agendador.

---

O restante deste guia foi escrito **antes** do deploy e fica como referência de limites e passos. Números vieram
das páginas oficiais em 2026-11-16; planos gratuitos mudam, então **confirme antes de depender deles**.

## Decisões tomadas

- **Frequência do worker: 15 min** (minutos 7, 22, 37 e 52 de cada hora, evitando o pico do minuto 0), com
  `MIN_MONITOR_INTERVAL_SEC=900`. Cabe nas 100 CU-h do Neon gratuito.
- **Repositório público:** minutos do GitHub Actions gratuitos. O código fica visível; segredos ficam apenas
  nos Secrets/painéis. Antes de publicar, foi feita uma varredura: nenhum segredo, e-mail ou caminho pessoal
  nos arquivos versionáveis, e `.env`, `node_modules`, `dist` e o client gerado estão no `.gitignore`.
- **Licença: MIT** (arquivo `LICENSE`, em nome de `Thiago-tods`).

## Arquitetura de hospedagem (custo zero)

| Peça                    | Onde                                                            | Observação                                                     |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Frontend + proxy `/api` | Cloudflare Pages + Pages Function (`functions/api/[[path]].ts`) | O proxy mantém o cookie de sessão de primeira parte            |
| API                     | Render (web service gratuito, `render.yaml`)                    | Dorme após 15 min sem tráfego                                  |
| Banco                   | Neon (PostgreSQL)                                               | **Não** usar o Postgres gratuito do Render (expira em 30 dias) |
| Worker                  | GitHub Actions (`.github/workflows/worker.yml`, modo `once`)    | Render não oferece worker gratuito                             |

Por que o proxy: o cookie de refresh é `SameSite=Strict`. Frontend (`*.pages.dev`) e API (`*.onrender.com`) são
sites diferentes, então o navegador não enviaria o cookie. Pelo proxy, o navegador só conversa com a origem do
frontend.

## Limites que afetam o monitoramento contínuo

| Serviço               | Limite (oficial)                                                                                                                                                                                                              | Consequência                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Neon Free             | 100 CU-horas/mês por projeto; compute suspende após 5 min sem consulta (não dá para desligar); 1 GB de armazenamento; restauração de até 6 h                                                                                  | Ver cálculo abaixo: **é o gargalo**                          |
| Render Free           | 750 h/mês; suspende após 15 min sem tráfego; ~1 min para voltar; sem workers/cron; Postgres expira em 30 dias                                                                                                                 | A primeira requisição após inatividade demora cerca de 1 min |
| GitHub Actions        | `schedule`: mínimo de 5 min, pode atrasar em picos; desativado após 60 dias sem atividade no repositório (público); roda só na branch padrão; repositório privado: US$ 12/mês de franquia (~2.000 min Linux); público: grátis | Cada execução gasta ~1-2 min (instala e compila)             |
| Cloudflare Pages Free | 500 builds/mês; Functions seguem o limite dos Workers Free: 100.000 requisições/dia, 10 ms de CPU por requisição                                                                                                              | Cada chamada à API passa pela Function                       |

### Conta do Neon (por que o intervalo de 5 min não cabe)

Se o worker acessa o banco a cada 5 min, o compute **nunca chega a suspender** e fica ligado o mês todo. Se o
tamanho mínimo for 0,25 CU (não confirmei o mínimo do plano gratuito), isso dá `720 h × 0,25 = 180 CU-h`,
acima das 100 CU-h. Estimativa de horas ativas (cada execução mantém o compute ligado por ~5 min até suspender),
com 0,25 CU:

| Frequência do worker | Tempo ligado | CU-h/mês (aprox.) | Cabe em 100?                     |
| -------------------- | ------------ | ----------------- | -------------------------------- |
| 5 min                | ~100%        | 180               | **Não**                          |
| 10 min               | ~51%         | 92                | No limite (sem folga para a API) |
| 15 min               | ~34%         | 61                | Sim                              |
| 30 min               | ~17%         | 31                | Sim                              |

Acessos de usuários à API também ligam o compute. **Recomendação: frequência de 15 min** e
`MIN_MONITOR_INTERVAL_SEC=900`, para a API recusar intervalos que o worker não consegue cumprir. Isso contraria o
padrão de 5 min do produto; para ter 5 min de verdade é preciso outro banco/worker (pago ou próprio).

### Conta do GitHub Actions

15 min × 30 dias ≈ 2.880 execuções. Com ~1-2 min cada: 2.900-5.800 min/mês. Em repositório **público** não há
cobrança. Em repositório **privado** passa da franquia (~2.000 min). Opções: repositório público (o código fica
visível; segredos ficam nos Secrets), frequência menor, ou outro agendador.

### Armazenamento

Com 20 monitores a cada 15 min: ~57.600 verificações em 30 dias, algumas dezenas de MB. A retenção de 30 dias
mantém isso estável e cabe no 1 GB.

## O que você precisaria autorizar

1. Criar contas: GitHub, Neon, Render, Cloudflare (nenhuma foi criada).
2. Fazer o primeiro commit e configurar o remoto Git (nada foi commitado).
3. Aplicar migrações no banco do Neon (escrita no banco de produção).
4. Publicar a API (Render), o frontend (Cloudflare) e ativar o agendamento do worker.

## Passo a passo (quando autorizado)

1. **Repositório.** Commit inicial e push para o GitHub. O `.env` nunca vai (está no `.gitignore`).
2. **Neon.** Crie o projeto e o banco; copie a connection string **direta** (sem `-pooler`) com
   `sslmode=require`.
3. **Migrações** (da sua máquina, com a URL só na sessão):
   ```powershell
   $env:DATABASE_URL = "<connection string do Neon>"
   npm run db:migrate:deploy
   Remove-Item Env:DATABASE_URL
   ```
4. **Render.** Crie o serviço a partir do `render.yaml`. Preencha no painel `DATABASE_URL`,
   `JWT_ACCESS_SECRET` (48+ bytes aleatórios) e `CORS_ORIGINS` (a URL do Pages, em HTTPS). Confirme o
   `NODE_VERSION`. Teste `https://SEU-SERVICO.onrender.com/api/v1/health/ready`.
5. **Cloudflare Pages.** Projeto ligado ao repositório, raiz = repositório; build `npm ci && npm run build -w
@pulseops/web`; saída `apps/web/dist`; variável `API_ORIGIN` = URL do Render. As `_headers` (CSP) e a
   Function já estão no repositório.
6. **Worker.** Crie o secret `DATABASE_URL` no GitHub, escolha a frequência, descomente o `schedule` em
   `.github/workflows/worker.yml` e rode uma vez manualmente (`workflow_dispatch`).
7. **Valide** com o checklist abaixo.

### Checklist pós-deploy

- [ ] `GET /api/v1/health/ready` retorna 200 (também por `https://SEU-PROJETO.pages.dev/api/v1/health`).
- [ ] Cadastro e login funcionam, e **recarregar a página mantém a sessão** (prova que o cookie passa pelo proxy).
- [ ] Um monitor novo recebe uma verificação após a próxima execução do worker.
- [ ] O cookie `pulseops_rt` aparece como `HttpOnly; Secure; SameSite=Strict`.
- [ ] Os limites de login/cadastro disparam de fato (confirma o IP real: ver `TRUST_PROXY` abaixo).
- [ ] A página pública `/status/<endereço>` abre sem login e sem expor URLs.
- [ ] Uso do Neon (CU-h) e minutos do Actions acompanhados nos painéis na primeira semana.

## Variáveis de ambiente

Ver `.env.production.example`. Resumo: API (`NODE_ENV=production`, `DATABASE_URL`, `JWT_ACCESS_SECRET`,
`CORS_ORIGINS`, `TRUST_PROXY`, `DB_POOL_MAX`, `MIN_MONITOR_INTERVAL_SEC`), Pages (`API_ORIGIN`, `PROXY_SHARED_SECRET`), Actions
(secret `DATABASE_URL`). Em produção a API **recusa iniciar** sem `DATABASE_URL` e `JWT_ACCESS_SECRET`, ou com
`CORS_ORIGINS` que não seja HTTPS ou que aponte para localhost.

## Operação

- **Backups:** o Neon gratuito só restaura até 6 h. Faça `pg_dump` periódico por conta própria (a retenção de
  30 dias das verificações limita o tamanho).
- **Rotação de segredos:** trocar `JWT_ACCESS_SECRET` encerra o acesso atual de todos os usuários (precisarão
  entrar de novo). Trocar a senha do banco exige atualizar o Render e o secret do GitHub.
- **Rollback:** o Render mantém deploys anteriores; migrações são aditivas e não têm "down" automático
  (planeje correções como novas migrações).
- **Logs:** a API e o worker escrevem JSON estruturado, sem segredos nem corpos de resposta.

## Confirmado pelo CI no GitHub (2026-11-16)

O workflow `CI` rodou no primeiro push (commit `e458129`) e passou por inteiro: a imagem `postgres:18` existe e
sobe como serviço, o Node 26.13 é instalado pelo `actions/setup-node` a partir do `.nvmrc`, as migrações
aplicam em um banco novo e os testes com banco (e2e da API e integração do worker) passam em Linux.

**Ainda não executado:** o workflow `worker.yml` (depende do secret `DATABASE_URL`; sem ele só emite um aviso)
e todos os serviços de nuvem.

## Achado no primeiro deploy (Render, 2026-11-16): limite de login

A API subiu e passou nos testes de fumaça (saúde, banco, cadastro, cookie `HttpOnly; Secure; SameSite=Strict`,
rotação de refresh, SSRF, intervalo mínimo). **Mas o limite de tentativas de login não bloqueava** com
`TRUST_PROXY=2`: 14 tentativas em paralelo retornaram todas 401, sem nenhum 429. Os testes automatizados não pegaram
porque desligam o limitador.

**Causa (medida com um diagnóstico temporário, já removido).** No Render, em acesso direto, a cadeia é:

| Posição                     | Quem                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| socket                      | `127.0.0.1` (proxy local do contêiner)                            |
| `X-Forwarded-For`, último   | `10.x.x.x` (balanceador interno do Render)                        |
| `X-Forwarded-For`, do meio  | `104.22.x.x` (servidor da Cloudflare, **muda a cada requisição**) |
| `X-Forwarded-For`, primeiro | o IP real do cliente (igual a `cf-connecting-ip`)                 |

Com 2 saltos confiáveis o Express parava no IP da Cloudflare (instável), e cada requisição caía num balde diferente.

**Correção: `TRUST_PROXY=3`, verificado em produção:** o IP usado pela API ficou estável e igual ao real; 14 logins
inválidos em paralelo deram 10×401 e 4×429; com `X-Forwarded-For` forjado diferente a cada requisição, 14×429
(forjar não burla, pois o Express conta os saltos da direita para a esquerda). O diagnóstico (`DEBUG_CLIENT_IP`)
foi desligado e `/health/client` responde 404.

O limitador agora tem testes próprios (`rate-limit.e2e-spec.ts`, ligado com `RATE_LIMIT_IN_TEST=true`).

**Com o proxy do Cloudflare Pages.** O `3` vale só para acesso **direto** ao Render. Com o Pages na frente a cadeia
ganha o IP de saída do Worker, e o `3` passaria a usar um IP compartilhado por todos os usuários. Por isso a
Function envia o IP real em `x-pulseops-client-ip` junto de `x-pulseops-proxy-secret`, e a API
(`apps/api/src/common/client-ip.ts`) só confia nesse IP se o segredo bater (comparação em tempo constante). Os dois
cabeçalhos são sempre removidos antes do resto da aplicação. Quem acessa o Render diretamente, com o cabeçalho
forjado e sem o segredo, cai no cálculo por `TRUST_PROXY=3` e não burla o limite. A Function **falha fechada**: sem
`PROXY_SHARED_SECRET` (mínimo 32 caracteres) ela não encaminha nada.

O segredo (`PROXY_SHARED_SECRET`) precisa ser **igual** no Render e no Cloudflare Pages (Secret). Para trocá-lo,
altere os dois e faça o deploy; durante a troca o IP volta ao cálculo por `TRUST_PROXY` (sem derrubar o serviço).

## Incertezas: o que o deploy real resolveu

Resolvido em 2026-11-16:

- **Node 26 no Render:** o serviço compila e roda com `NODE_VERSION=26.13.0`.
- **`TRUST_PROXY` com o Pages:** o IP real chega pelo cabeçalho assinado com `PROXY_SHARED_SECRET`; medido pelo
  Pages (10x 401 e 4x 429 em 14 tentativas paralelas).
- **Cookie `Secure` em HTTPS:** verificado em produção (`HttpOnly; Secure; SameSite=Strict`, sessão renovada).
- **Function no Cloudflare:** funciona na plataforma real (proxy, 404 fora de `/api/v1`, cabeçalhos de segurança).

Ainda em aberto:

- **Neon pooled vs. direto:** usamos a conexão direta. Não validei o adapter do Prisma contra o pooler.
- **CPU de 10 ms por requisição** da Function: sem falhas observadas, mas não medido.
- **Papel do banco:** o app usa `neondb_owner` (privilégios amplos). Um papel restrito é uma melhoria futura.
- **Pontualidade do cron:** ver o aviso no topo.
