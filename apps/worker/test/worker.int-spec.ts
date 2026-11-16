import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@pulseops/db';
import type { SafeRequestResult } from '@pulseops/http-guard';
import { CheckMonitorHandler, type RequestFn } from '../src/handlers/check-monitor';
import { RetentionHandler } from '../src/handlers/retention';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { PgTaskQueue, TASK_CHECK_MONITOR } from '../src/pg-queue';
import type { Task } from '../src/types';
import { Worker } from '../src/worker';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const silent = createLogger('error');
const DAY = 86_400_000;

const result = (extra: Partial<SafeRequestResult>): SafeRequestResult => ({
  ok: true,
  finalUrl: 'https://api.exemplo.com/',
  redirects: 0,
  latencyMs: 25,
  ...extra,
});

describeDb('Worker com PostgreSQL real', () => {
  let db: PrismaClient;
  let orgId: string;
  const startedAt = new Date();

  const queueFor = (workerId: string, leaseSec = 120) =>
    new PgTaskQueue(db, { workerId, leaseSec, schedulerBatchSize: 100 });

  async function newMonitor(overrides: Record<string, unknown> = {}) {
    return db.monitor.create({
      data: {
        organizationId: orgId,
        name: `m-${randomUUID().slice(0, 8)}`,
        url: 'https://api.exemplo.com/saude',
        ...overrides,
      },
    });
  }

  const taskFor = (monitorId: string): Task => ({
    id: randomUUID(),
    type: TASK_CHECK_MONITOR,
    payload: { monitorId },
    organizationId: orgId,
    attempts: 1,
    maxAttempts: 5,
  });

  async function insertTask(extra: Record<string, unknown> = {}) {
    return db.workerTask.create({
      data: {
        organizationId: orgId,
        type: TASK_CHECK_MONITOR,
        payload: { monitorId: randomUUID() },
        dedupeKey: `t-${randomUUID()}`,
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    db = createPrismaClient(process.env.DATABASE_URL as string);
    const org = await db.organization.create({
      data: { name: 'Org Worker Int', slug: `int-worker-${randomUUID().slice(0, 8)}` },
    });
    orgId = org.id;
  });

  beforeEach(async () => {
    await db.workerTask.deleteMany({ where: { organizationId: orgId } });
    await db.monitor.deleteMany({ where: { organizationId: orgId } });
  });

  afterAll(async () => {
    await db.organization.delete({ where: { id: orgId } }); // cascata: monitores, checks, incidentes, tarefas
    // Tarefa de retenção (sem organização) criada por estes testes.
    await db.workerTask.deleteMany({
      where: { type: 'RETENTION', organizationId: null, createdAt: { gte: startedAt } },
    });
    await db.$disconnect();
  });

  describe('agendamento', () => {
    it('cria tarefa para monitor vencido, avança next_run_at e não duplica', async () => {
      const due = await newMonitor({ nextRunAt: new Date(Date.now() - 1000), intervalSec: 300 });
      const q = queueFor('w1');
      await q.enqueueDue();
      const tasks = await db.workerTask.findMany({ where: { organizationId: orgId } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ type: TASK_CHECK_MONITOR, status: 'PENDING' });
      expect(tasks[0]?.payload).toEqual({ monitorId: due.id });

      const after = await db.monitor.findUniqueOrThrow({ where: { id: due.id } });
      const delta = after.nextRunAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(295_000);
      expect(delta).toBeLessThanOrEqual(300_500);

      await q.enqueueDue(); // ainda não venceu de novo
      expect(await db.workerTask.count({ where: { organizationId: orgId } })).toBe(1);
    });

    it('ignora monitores pausados e ainda não vencidos', async () => {
      await newMonitor({ enabled: false, nextRunAt: new Date(Date.now() - 1000) });
      await newMonitor({ nextRunAt: new Date(Date.now() + 3_600_000) });
      await queueFor('w1').enqueueDue();
      expect(await db.workerTask.count({ where: { organizationId: orgId } })).toBe(0);
    });

    it('folga do agendador adianta monitor que vence em instantes (cron com atraso)', async () => {
      const soon = await newMonitor({ nextRunAt: new Date(Date.now() + 60_000) });
      await queueFor('w1').enqueueDue(); // sem folga: ainda não venceu
      expect(await db.workerTask.count({ where: { organizationId: orgId } })).toBe(0);

      const comFolga = new PgTaskQueue(db, {
        workerId: 'w1',
        leaseSec: 120,
        schedulerBatchSize: 100,
        dueLeadSec: 90,
      });
      await comFolga.enqueueDue();
      const tasks = await db.workerTask.findMany({ where: { organizationId: orgId } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.payload).toEqual({ monitorId: soon.id });
    });

    it('agenda a manutenção diária uma única vez por dia', async () => {
      const q = queueFor('w1');
      await q.enqueueDue();
      await q.enqueueDue();
      const day = new Date().toISOString().slice(0, 10);
      expect(await db.workerTask.count({ where: { dedupeKey: `retention:${day}` } })).toBe(1);
    });
  });

  describe('reserva de tarefas', () => {
    it('dois workers simultâneos nunca recebem a mesma tarefa', async () => {
      await Promise.all(Array.from({ length: 12 }, () => insertTask()));
      const [a, b] = await Promise.all([queueFor('wA').claim(20), queueFor('wB').claim(20)]);
      const mine = (ts: Task[]) => ts.filter((t) => t.organizationId === orgId).map((t) => t.id);
      const idsA = mine(a);
      const idsB = mine(b);
      expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
      expect(idsA.length + idsB.length).toBe(12);
    });

    it('marca como RUNNING com lease e incrementa tentativas', async () => {
      const t = await insertTask();
      const [claimed] = (await queueFor('wA').claim(50)).filter((x) => x.id === t.id);
      expect(claimed?.attempts).toBe(1);
      const row = await db.workerTask.findUniqueOrThrow({ where: { id: t.id } });
      expect(row).toMatchObject({ status: 'RUNNING', lockedBy: 'wA', attempts: 1 });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('não entrega tarefas agendadas para o futuro', async () => {
      const t = await insertTask({ runAt: new Date(Date.now() + 3_600_000) });
      const claimed = await queueFor('wA').claim(50);
      expect(claimed.map((x) => x.id)).not.toContain(t.id);
    });

    it('recupera tarefa de worker que caiu (lease expirado)', async () => {
      const t = await insertTask();
      await queueFor('wCaiu').claim(50);
      await db.workerTask.update({
        where: { id: t.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      const again = (await queueFor('wB').claim(50)).find((x) => x.id === t.id);
      expect(again?.attempts).toBe(2);
      expect((await db.workerTask.findUniqueOrThrow({ where: { id: t.id } })).lockedBy).toBe('wB');
    });

    it('lease expirado sem tentativas restantes vira DEAD', async () => {
      const t = await insertTask({
        status: 'RUNNING',
        attempts: 5,
        maxAttempts: 5,
        lockedBy: 'wMorto',
        lockedUntil: new Date(Date.now() - 1000),
      });
      const claimed = await queueFor('wB').claim(50);
      expect(claimed.map((x) => x.id)).not.toContain(t.id);
      expect((await db.workerTask.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('DEAD');
    });
  });

  describe('conclusão e falha', () => {
    it('complete marca SUCCEEDED e libera o lock', async () => {
      const q = queueFor('wA');
      const t = await insertTask();
      const claimed = (await q.claim(50)).find((x) => x.id === t.id) as Task;
      await q.complete(claimed);
      expect(await db.workerTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
        status: 'SUCCEEDED',
        lockedBy: null,
      });
    });

    it('fail reagenda com backoff e depois marca DEAD ao esgotar tentativas', async () => {
      const q = queueFor('wA');
      const t = await insertTask({ maxAttempts: 2 });
      let claimed = (await q.claim(50)).find((x) => x.id === t.id) as Task;
      expect(await q.fail(claimed, new Error('falha 1'))).toBe('RETRY');
      const retry = await db.workerTask.findUniqueOrThrow({ where: { id: t.id } });
      expect(retry).toMatchObject({ status: 'PENDING', lastError: 'falha 1', lockedBy: null });
      expect(retry.runAt.getTime()).toBeGreaterThan(Date.now() + 5000);

      await db.workerTask.update({ where: { id: t.id }, data: { runAt: new Date() } });
      claimed = (await q.claim(50)).find((x) => x.id === t.id) as Task;
      expect(claimed.attempts).toBe(2);
      expect(await q.fail(claimed, new Error('falha 2'))).toBe('DEAD');
      expect((await db.workerTask.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('DEAD');
    });

    it('um worker não conclui tarefa cujo lease pertence a outro', async () => {
      const t = await insertTask();
      const claimed = (await queueFor('wA').claim(50)).find((x) => x.id === t.id) as Task;
      await queueFor('wIntruso').complete(claimed);
      expect((await db.workerTask.findUniqueOrThrow({ where: { id: t.id } })).status).toBe(
        'RUNNING',
      );
    });
  });

  describe('verificação de monitor e incidentes', () => {
    function handlerWith(...results: SafeRequestResult[]) {
      const queue = [...results];
      const request: RequestFn = async () => queue.shift() ?? result({ status: 200 });
      return new CheckMonitorHandler(db, silent, request);
    }

    it('grava verificação UP sem abrir incidente', async () => {
      const m = await newMonitor();
      await handlerWith(result({ status: 200, latencyMs: 80 })).handle(taskFor(m.id));
      const checks = await db.monitorCheck.findMany({ where: { monitorId: m.id } });
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({
        status: 'UP',
        httpStatus: 200,
        latencyMs: 80,
        error: null,
      });
      expect(await db.incident.count({ where: { monitorId: m.id } })).toBe(0);
      // retenção: expires_at é preenchido pelo banco com ~30 dias
      const ttl = checks[0]!.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(29 * DAY);
    });

    it('abre incidente após o limiar, não duplica e resolve na recuperação', async () => {
      const m = await newMonitor({ failureThreshold: 2 });
      const down = result({ status: 503 });
      const h = handlerWith(down, down, down, result({ status: 200 }));

      await h.handle(taskFor(m.id));
      expect(await db.incident.count({ where: { monitorId: m.id } })).toBe(0); // 1ª falha

      await h.handle(taskFor(m.id));
      const opened = await db.incident.findMany({ where: { monitorId: m.id } });
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({ status: 'INVESTIGATING', resolvedAt: null });

      await h.handle(taskFor(m.id)); // 3ª falha: sem novo incidente
      expect(await db.incident.count({ where: { monitorId: m.id } })).toBe(1);

      await h.handle(taskFor(m.id)); // recuperou
      const resolved = await db.incident.findUniqueOrThrow({ where: { id: opened[0]!.id } });
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolvedAt).not.toBeNull();

      const updates = await db.incidentUpdate.findMany({ where: { incidentId: resolved.id } });
      expect(updates.map((u) => u.status).sort()).toEqual(['INVESTIGATING', 'RESOLVED']);
      const audit = await db.auditLog.findMany({ where: { entityId: resolved.id } });
      expect(audit.map((a) => a.action).sort()).toEqual(['incident.open', 'incident.resolve']);
    });

    it('registra timeout e bloqueio de SSRF como falhas classificadas', async () => {
      const m = await newMonitor({ failureThreshold: 5 });
      const h = handlerWith(
        result({ ok: false, errorCode: 'TIMEOUT', errorMessage: 'Tempo esgotado' }),
        result({ ok: false, errorCode: 'BLOCKED_TARGET', errorMessage: 'rede privada' }),
      );
      await h.handle(taskFor(m.id));
      await h.handle(taskFor(m.id));
      const statuses = (
        await db.monitorCheck.findMany({
          where: { monitorId: m.id },
          orderBy: { checkedAt: 'asc' },
        })
      ).map((c) => c.status);
      expect(statuses).toEqual(['TIMEOUT', 'ERROR']);
    });

    it('usa o status esperado configurado', async () => {
      const m = await newMonitor({ expectedStatus: 204 });
      await handlerWith(result({ status: 204 })).handle(taskFor(m.id));
      expect((await db.monitorCheck.findFirstOrThrow({ where: { monitorId: m.id } })).status).toBe(
        'UP',
      );
    });

    it('ignora monitor pausado ou removido e rejeita payload inválido', async () => {
      const paused = await newMonitor({ enabled: false });
      const request = jest.fn<ReturnType<RequestFn>, Parameters<RequestFn>>();
      const h = new CheckMonitorHandler(db, silent, request);
      await h.handle(taskFor(paused.id));
      await h.handle(taskFor(randomUUID()));
      expect(request).not.toHaveBeenCalled();
      await expect(h.handle({ ...taskFor('x'), payload: {} })).rejects.toThrow(/monitorId/);
    });
  });

  describe('retenção', () => {
    it('remove verificações vencidas, tarefas antigas e sessões expiradas; preserva o resto', async () => {
      const m = await newMonitor();
      const old = new Date(Date.now() - 40 * DAY);
      const fresh = new Date(Date.now() - 2 * DAY);
      await db.monitorCheck.createMany({
        data: [
          { monitorId: m.id, organizationId: orgId, status: 'UP', checkedAt: old },
          { monitorId: m.id, organizationId: orgId, status: 'UP', checkedAt: old },
          { monitorId: m.id, organizationId: orgId, status: 'UP', checkedAt: fresh },
        ],
      });
      const oldTask = await insertTask({ status: 'SUCCEEDED' });
      await db.$executeRaw`UPDATE worker_tasks SET updated_at = now() - interval '10 days' WHERE id = ${oldTask.id}::uuid`;
      const recentTask = await insertTask({ status: 'SUCCEEDED' });

      const r = await new RetentionHandler(db, silent, 30).run();
      expect(r.checks).toBeGreaterThanOrEqual(2);
      expect(await db.monitorCheck.count({ where: { monitorId: m.id } })).toBe(1);
      expect(await db.workerTask.findUnique({ where: { id: oldTask.id } })).toBeNull();
      expect(await db.workerTask.findUnique({ where: { id: recentTask.id } })).not.toBeNull();
    });
  });

  it('modo de execução única: agenda, executa, notifica e encerra sozinho', async () => {
    const m = await newMonitor({ nextRunAt: new Date(Date.now() - 1000), failureThreshold: 1 });
    await db.alertRule.create({
      data: {
        organizationId: orgId,
        name: 'hook',
        channel: 'WEBHOOK',
        target: 'https://hooks.exemplo.com/x',
      },
    });
    const env = loadEnv({ LOG_LEVEL: 'error', WORKER_CONCURRENCY: '3' });
    const checks = new CheckMonitorHandler(db, silent, async () => result({ status: 500 }));
    const sent = jest.fn();
    const worker = new Worker(env, silent, {
      queue: queueFor('wOnce'),
      handlers: {
        [TASK_CHECK_MONITOR]: (t) => checks.handle(t),
        SEND_NOTIFICATION: async (t) => void sent(t.payload),
      },
    });
    const r = await worker.runOnce(20_000);
    expect(r.timedOut).toBe(false);
    expect(r.processed).toBe(2); // a verificação e a notificação criada por ela
    expect(sent).toHaveBeenCalledTimes(1);
    expect(await db.incident.count({ where: { monitorId: m.id } })).toBe(1);
    const tasks = await db.workerTask.findMany({ where: { organizationId: orgId } });
    expect(tasks.map((t) => t.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
  });

  it('fluxo completo: o Worker agenda, executa e grava a verificação', async () => {
    const m = await newMonitor({ nextRunAt: new Date(Date.now() - 1000) });
    const env = loadEnv({ LOG_LEVEL: 'error', WORKER_POLL_INTERVAL_MS: '500' });
    const checks = new CheckMonitorHandler(db, silent, async () => result({ status: 200 }));
    const worker = new Worker(env, silent, {
      queue: queueFor('wFluxo'),
      handlers: { [TASK_CHECK_MONITOR]: (t) => checks.handle(t) },
    });
    await worker.cycle();
    await worker.stop(); // espera a verificação em andamento
    expect(await db.monitorCheck.count({ where: { monitorId: m.id } })).toBe(1);
    const task = await db.workerTask.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(task.status).toBe('SUCCEEDED');
  });
});
