# Guia de deploy (preparado, NÃO executado)

Nada aqui foi aplicado: nenhuma conta foi criada, nenhum serviço configurado e nada foi publicado. Este guia
descreve o que **você** precisaria autorizar e fazer, e os limites que impedem o monitoramento contínuo no
plano gratuito. Números abaixo vieram das páginas oficiais em 2026-11-16; planos gratuitos mudam, então
**confirme antes de depender deles**.

## Decisões tomadas

- **Frequência do worker: 15 min** (minutos 7, 22, 37 e 52 de cada hora, evitando o pico do minuto 0), com
  `MIN_MONITOR_INTERVAL_SEC=900`. Cabe nas 100 CU-h do Neon gratuito.
- **Repositório público:** minutos do GitHub Actions gratuitos. O código fica visível; segredos ficam apenas
  nos Secrets/painéis. Antes de publicar, foi feita uma varredura: nenhum segredo, e-mail ou caminho pessoal
  nos arquivos versionáveis, e `.env`, `node_modules`, `dist` e o client gerado estão no `.gitignore`.
- Um repositório público sem licença **não concede direitos de uso a terceiros** (todos os direitos reservados).
  Escolha uma licença (ex.: MIT) se quiser permitir reuso; nenhuma foi adicionada.

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
`CORS_ORIGINS`, `TRUST_PROXY`, `DB_POOL_MAX`, `MIN_MONITOR_INTERVAL_SEC`), Pages (`API_ORIGIN`), Actions
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

**Atenção ao Cloudflare Pages.** O `3` vale só para acesso **direto** ao Render. Com o proxy do Pages na frente, a
cadeia ganha o IP de saída do Worker e o `3` passaria a usar um IP compartilhado por todos os usuários. Antes de
ligar o Pages é preciso que a Function envie o IP real em um cabeçalho próprio junto de um segredo compartilhado
que a API valide (assim ninguém forja o cabeçalho acessando o Render diretamente). Isso ainda NÃO está implementado.
**Não divulgue a URL da API nem ligue o Pages antes disso.**

## Incertezas que só o deploy real resolve

- **Node 26 no Render.** Não confirmei que o Render oferece a versão 26.13.0. Se não oferecer, será preciso usar
  outra versão (o projeto só foi testado no Node 26; `engines` aceita `>=24`, não testado).
- **`TRUST_PROXY` com o proxy do Cloudflare Pages:** medido apenas para acesso direto ao Render (3). Com o Pages na
  frente a cadeia muda; ver a seção do achado acima.
- **Neon pooled vs. direto:** usamos a conexão direta. Não validei o adapter do Prisma contra o pooler.
- **CPU de 10 ms por requisição** da Function: o proxy faz pouco trabalho de CPU, mas não foi medido no
  Cloudflare.
- **Cookie `Secure` e HTTPS:** só foi testado localmente (HTTP). O comportamento em HTTPS real é esperado, mas
  não verificado.
