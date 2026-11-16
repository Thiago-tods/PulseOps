# Relatório da Fase 4: worker e verificações reais

## O que foi implementado

**Worker (`apps/worker`)** executa as verificações dos monitores com fila no PostgreSQL.

- **Fila (`worker_tasks`)**
  - O agendador cria uma tarefa `CHECK_MONITOR` para cada monitor vencido (ativo e com `next_run_at` passado) e já avança o `next_run_at`, tudo numa só instrução SQL.
  - A chave `dedupe_key` (`check:<monitor>:<instante>`) impede tarefas duplicadas.
  - A reserva usa `FOR UPDATE SKIP LOCKED`, então dois workers nunca recebem a mesma tarefa.
  - A reserva tem lease (`locked_until`, padrão 120 s): se um worker cair, a tarefa volta sozinha a ficar disponível.
  - Uma tarefa travada sem tentativas restantes vira `DEAD`.
  - Falha de infraestrutura reagenda com backoff exponencial (10 s, 20 s, 40 s… até 15 min, com variação de ±20%) e vira `DEAD` após 5 tentativas.
  - Um worker só conclui ou falha tarefas cujo lease é dele.
- **Verificação (`CHECK_MONITOR`)**
  - Usa sempre `safeRequest` (proteção contra SSRF da Fase 3).
  - `UP` quando o status HTTP é o esperado; `DOWN` para outro status, falha de DNS, conexão ou TLS; `TIMEOUT` para tempo esgotado; `ERROR` para alvo bloqueado pela política, URL inválida ou excesso de redirecionamentos.
  - Monitor removido ou pausado desde o agendamento é ignorado.
- **Incidentes**
  - Abre um incidente (`INVESTIGATING`, com atualização e auditoria) quando as últimas `failureThreshold` verificações falham.
  - Resolve (`RESOLVED`) na primeira verificação bem-sucedida.
  - Não duplica: há decisão em código e também o índice único parcial do banco.
- **Retenção:** uma tarefa diária apaga verificações com mais de 30 dias (ou `expires_at` vencido), em lotes de 5000, tarefas concluídas ou mortas com mais de 7 dias e sessões vencidas há mais de 30 dias.
- **Loop e encerramento:** concorrência configurável, ciclo que não bloqueia, falha de banco não derruba o processo e o encerramento (SIGINT/SIGTERM) aguarda as tarefas em andamento até `SHUTDOWN_TIMEOUT_MS`.

**API:** `GET /monitors` e `GET /monitors/:id` passam a trazer `lastCheck`; novos `GET /monitors/:id/checks?limit=` (histórico) e `GET /incidents` (abertos primeiro), todos restritos à organização.

**Frontend:** a lista de monitores mostra status, latência e horário da última verificação, e um histórico expansível; o painel lista os incidentes e quantos estão em aberto.

## Bug de fuso horário (importante)

O adapter `@prisma/adapter-pg` do Prisma 7 envia datas como horário UTC **sem fuso**. Como o PostgreSQL local usa `America/Sao_Paulo`, essas datas eram lidas 3 horas adiantadas, inclusive nas escritas feitas pelo ORM. Os testes de integração do worker revelaram isso (tarefas "do futuro" nunca eram reservadas).

Correção: `createPrismaClient` agora abre toda conexão com `-c timezone=UTC`. O SQL cru também passa as datas em ISO com `::timestamptz`. Vale para API e worker, e protege o futuro deploy. Nenhum dado real foi afetado (o banco só continha dados de teste, já removidos).

## Verificações executadas

| Verificação                                     | Resultado                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, build, Prettier                | OK                                                                                                                                                                  |
| Testes unitários                                | shared 2, http-guard 80, api 10, worker 26, web 14: todos passaram                                                                                                  |
| e2e da API no PostgreSQL 18 real                | 44 passaram                                                                                                                                                         |
| Integração do worker no PostgreSQL 18 real      | 18 passaram                                                                                                                                                         |
| API e worker em processos reais + internet real | `example.com` UP 200 (62 ms); `/pagina-inexistente` DOWN 404 e incidente aberto com atualização; 2 tarefas SUCCEEDED; retenção executada; auditoria `incident.open` |
| `npm audit --omit=dev`                          | 0 vulnerabilidades                                                                                                                                                  |
| Dados de teste                                  | removidos; banco com 0 usuários, organizações, monitores e tarefas                                                                                                  |

A integração cobre: agendamento sem duplicar, monitor pausado/futuro ignorado, dois workers concorrentes sem sobreposição, lease expirado, tarefa morta, backoff, abertura e resolução de incidente, classificação de timeout e SSRF, status esperado configurável, retenção e o fluxo completo do `Worker`.

## Limitações conhecidas

- **Notificações e regras de alerta ainda não existem.** Abrir um incidente só registra no banco; ninguém é avisado. É a próxima etapa natural (e-mail depende de serviço externo).
- **O worker precisa estar rodando.** Sem ele, os monitores ficam sem resultado. Em hospedagem gratuita (Render, Neon) isso não é garantido 24/7: o plano gratuito dorme por inatividade. O desenho já tolera isso (tarefas vencidas são executadas quando o worker volta), mas haverá lacunas nos dados e atraso na detecção.
- **Encerramento no Windows:** `Stop-Process` não envia SIGINT; o encerramento controlado só foi exercitado em teste unitário. Uma tarefa interrompida é recuperada pelo lease.
- **Um único worker foi testado em processo real.** A concorrência entre dois workers foi provada em teste de integração, não com dois processos.
- **Sem testes no CI:** o CI não tem banco, então `test:e2e` e `test:int` são ignorados lá; rodam localmente com `npm run test:db`.
- Não foi aberta a interface no navegador; o frontend foi validado por testes e build.

## Próxima etapa sugerida

Fase 5: regras de alerta e notificações (`AlertRule`, `Notification`) com envio por webhook/e-mail, usando a mesma fila, mais a página pública de status (`StatusPage`).
