import { randomUUID } from 'node:crypto';
import { createPrismaClient, SecretBox } from '@pulseops/db';
import { loadEnv } from './env';
import { CheckMonitorHandler } from './handlers/check-monitor';
import { SendNotificationHandler, TASK_SEND_NOTIFICATION } from './handlers/notifications';
import { RetentionHandler } from './handlers/retention';
import { createLogger } from './logger';
import { PgTaskQueue, TASK_CHECK_MONITOR, TASK_RETENTION } from './pg-queue';
import { Worker } from './worker';

function main(): void {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL);
  if (!env.DATABASE_URL)
    throw new Error('Configuração inválida. Variáveis com problema: DATABASE_URL');

  const db = createPrismaClient(env.DATABASE_URL, { poolMax: env.DB_POOL_MAX });
  const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const queue = new PgTaskQueue(db, {
    workerId,
    leaseSec: env.TASK_LEASE_SEC,
    schedulerBatchSize: env.SCHEDULER_BATCH_SIZE,
    dueLeadSec: env.SCHEDULER_LEAD_SEC,
  });
  const checks = new CheckMonitorHandler(db, log);
  const box = env.WEBHOOK_ENCRYPTION_KEY
    ? new SecretBox(
        env.WEBHOOK_ENCRYPTION_KEY,
        (env.WEBHOOK_ENCRYPTION_KEY_PREVIOUS ?? '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      )
    : null;
  if (!box) log.warn('WEBHOOK_ENCRYPTION_KEY ausente: webhooks cifrados não poderão ser enviados');
  const notifications = new SendNotificationHandler(db, log, undefined, box);
  const retention = new RetentionHandler(db, log, env.CHECK_RETENTION_DAYS);

  const worker = new Worker(env, log, {
    queue,
    handlers: {
      [TASK_CHECK_MONITOR]: (task) => checks.handle(task),
      [TASK_SEND_NOTIFICATION]: (task) => notifications.handle(task),
      [TASK_RETENTION]: async () => {
        await retention.run();
      },
    },
  });
  log.info('identificador do worker', { workerId, mode: env.WORKER_MODE });

  if (env.WORKER_MODE === 'once') {
    // Execução única (agendador externo, ex.: GitHub Actions): processa e encerra.
    void worker
      .runOnce(env.ONCE_MAX_DURATION_SEC * 1000)
      .then((r) => log.info('execução única concluída', r))
      .catch((err: unknown) => {
        log.error('execução única falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exitCode = 1;
      })
      .finally(() => db.$disconnect())
      .finally(() => process.exit());
    return;
  }

  worker.start();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('sinal recebido, encerrando', { signal });
    void worker
      .stop()
      .then(() => db.$disconnect())
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ level: 'fatal', message })}\n`);
  process.exit(1);
}
