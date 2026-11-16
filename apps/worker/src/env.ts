import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  // Mesma chave da API: o worker decifra o destino e o segredo de assinatura dos webhooks.
  WEBHOOK_ENCRYPTION_KEY: z.string().optional(),
  WEBHOOK_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  // daemon: processo contínuo. once: processa o que está vencido e encerra (ex.: GitHub Actions).
  WORKER_MODE: z.enum(['daemon', 'once']).default('daemon'),
  ONCE_MAX_DURATION_SEC: z.coerce.number().int().min(10).max(3000).default(240),
  // Folga para o agendador "adiantar" monitores quase vencidos (cron com atraso/jitter).
  SCHEDULER_LEAD_SEC: z.coerce.number().int().min(0).max(600).default(0),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(600_000).default(5000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  TASK_LEASE_SEC: z.coerce.number().int().min(30).max(3600).default(120),
  SCHEDULER_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(200),
  CHECK_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuração inválida. Variáveis com problema: ${campos}`);
  }
  return parsed.data;
}
