import type { PrismaClient } from '@pulseops/db';
import type { Logger } from '../logger';

const BATCH = 5000;
const DAY_MS = 86_400_000;

export interface RetentionResult {
  checks: number;
  tasks: number;
  sessions: number;
}

/** Remove, em lotes, dados vencidos: verificações (30 dias), tarefas antigas e sessões expiradas. */
export class RetentionHandler {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly checkRetentionDays: number,
  ) {}

  async run(now: Date = new Date()): Promise<RetentionResult> {
    const checkCutoff = new Date(now.getTime() - this.checkRetentionDays * DAY_MS);
    const taskCutoff = new Date(now.getTime() - 7 * DAY_MS);
    const sessionCutoff = new Date(now.getTime() - 30 * DAY_MS);

    let checks = 0;
    for (;;) {
      const deleted = await this.db.$executeRaw`
        DELETE FROM monitor_checks WHERE id IN (
          SELECT id FROM monitor_checks
          WHERE checked_at < ${checkCutoff.toISOString()}::timestamptz
             OR expires_at < ${now.toISOString()}::timestamptz
          LIMIT ${BATCH}
        )`;
      checks += deleted;
      if (deleted < BATCH) break;
    }

    const tasks = (
      await this.db.workerTask.deleteMany({
        where: { status: { in: ['SUCCEEDED', 'DEAD'] }, updatedAt: { lt: taskCutoff } },
      })
    ).count;
    const sessions = (
      await this.db.session.deleteMany({
        where: { OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }] },
      })
    ).count;

    this.log.info('retenção concluída', { checks, tasks, sessions });
    return { checks, tasks, sessions };
  }
}
