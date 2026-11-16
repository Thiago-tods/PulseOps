import type { PrismaClient } from '@pulseops/db';
import { retryDelayMs } from './check-logic';
import type { Task, TaskQueue } from './types';

export const TASK_CHECK_MONITOR = 'CHECK_MONITOR';
export const TASK_RETENTION = 'RETENTION';

interface ClaimedRow {
  id: string;
  type: string;
  payload: unknown;
  organization_id: string | null;
  attempts: number;
  max_attempts: number;
}

export interface PgQueueOptions {
  workerId: string;
  leaseSec: number;
  schedulerBatchSize: number;
  /** Considera vencido quem vence em até N segundos (compensa atraso de cron). */
  dueLeadSec?: number;
}

/**
 * Fila sobre a tabela worker_tasks.
 * - Reserva com `FOR UPDATE SKIP LOCKED`: workers concorrentes nunca pegam a mesma tarefa.
 * - Lease (`locked_until`): tarefa de worker que caiu volta a ser elegível após expirar.
 * - `dedupe_key` único evita tarefas duplicadas para o mesmo monitor/instante.
 */
export class PgTaskQueue implements TaskQueue {
  constructor(
    private readonly db: PrismaClient,
    private readonly opts: PgQueueOptions,
  ) {}

  async enqueueDue(nowDate: Date = new Date()): Promise<number> {
    // Em SQL cru o adapter do Prisma envia Date sem fuso horário; por isso usamos ISO (UTC) com cast.
    const now = nowDate.toISOString();
    const lead = this.opts.dueLeadSec ?? 0;
    // 1) Monitores vencidos: avança next_run_at e cria a tarefa, tudo numa só instrução.
    const created = await this.db.$executeRaw`
      WITH due AS (
        SELECT id, organization_id, next_run_at
        FROM monitors
        WHERE enabled AND next_run_at <= ${now}::timestamptz + make_interval(secs => ${lead})
        ORDER BY next_run_at
        LIMIT ${this.opts.schedulerBatchSize}
        FOR UPDATE SKIP LOCKED
      ), advanced AS (
        UPDATE monitors m
        SET next_run_at = ${now}::timestamptz + make_interval(secs => m.interval_sec),
            updated_at = ${now}::timestamptz
        FROM due
        WHERE m.id = due.id
        RETURNING m.id, m.organization_id, due.next_run_at AS slot
      )
      INSERT INTO worker_tasks (id, organization_id, type, payload, dedupe_key, run_at, updated_at)
      SELECT gen_random_uuid(), organization_id, ${TASK_CHECK_MONITOR},
             jsonb_build_object('monitorId', id),
             'check:' || id || ':' || (extract(epoch FROM slot) * 1000)::bigint,
             ${now}::timestamptz, ${now}::timestamptz
      FROM advanced
      ON CONFLICT (dedupe_key) DO NOTHING`;

    // 2) Manutenção diária (uma por dia, graças ao dedupe_key).
    const day = now.slice(0, 10);
    const maintenance = await this.db.$executeRaw`
      INSERT INTO worker_tasks (id, type, dedupe_key, run_at, updated_at)
      VALUES (gen_random_uuid(), ${TASK_RETENTION}, ${`retention:${day}`}, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (dedupe_key) DO NOTHING`;
    return created + maintenance;
  }

  async claim(limit: number): Promise<Task[]> {
    if (limit <= 0) return [];
    // Tarefas travadas sem tentativas restantes viram DEAD (evita laço infinito).
    await this.db.$executeRaw`
      UPDATE worker_tasks
      SET status = 'DEAD', last_error = 'Lease expirado sem tentativas restantes',
          locked_by = NULL, locked_until = NULL, updated_at = now()
      WHERE status = 'RUNNING' AND locked_until < now() AND attempts >= max_attempts`;

    const rows = await this.db.$queryRaw<ClaimedRow[]>`
      UPDATE worker_tasks
      SET status = 'RUNNING', locked_by = ${this.opts.workerId},
          locked_until = now() + make_interval(secs => ${this.opts.leaseSec}),
          attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM worker_tasks
        WHERE (status = 'PENDING' AND run_at <= now())
           OR (status = 'RUNNING' AND locked_until < now())
        ORDER BY run_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, organization_id, attempts, max_attempts`;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      organizationId: r.organization_id,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
    }));
  }

  async complete(task: Task): Promise<void> {
    await this.db.workerTask.updateMany({
      where: { id: task.id, lockedBy: this.opts.workerId },
      data: { status: 'SUCCEEDED', lockedBy: null, lockedUntil: null, lastError: null },
    });
  }

  async fail(task: Task, error: unknown): Promise<'RETRY' | 'DEAD'> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const dead = task.attempts >= task.maxAttempts;
    await this.db.workerTask.updateMany({
      where: { id: task.id, lockedBy: this.opts.workerId },
      data: dead
        ? { status: 'DEAD', lockedBy: null, lockedUntil: null, lastError: message }
        : {
            status: 'PENDING',
            lockedBy: null,
            lockedUntil: null,
            lastError: message,
            runAt: new Date(Date.now() + retryDelayMs(task.attempts)),
          },
    });
    return dead ? 'DEAD' : 'RETRY';
  }
}
