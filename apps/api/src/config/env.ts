import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().default('127.0.0.1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'log', 'debug', 'verbose'])
    .default('log')
    .transform((v) => (v === 'info' ? 'log' : v)),
  // Menor intervalo aceito em monitores. Deve refletir a frequência real do worker (ver docs/DEPLOYMENT.md).
  MIN_MONITOR_INTERVAL_SEC: z.coerce.number().int().min(300).max(86_400).default(300),
  MAX_MONITORS_PER_ORG: z.coerce.number().int().min(1).max(1000).default(20),
  // Diagnóstico temporário: expõe GET /health/client (IP visto pela API e cadeia de proxies).
  DEBUG_CLIENT_IP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Segredo compartilhado com o proxy do Cloudflare Pages (functions/api/[[path]].ts). Quando o proxy
  // o envia junto do IP real, a API usa esse IP. Sem ele, vale o cálculo por TRUST_PROXY.
  PROXY_SHARED_SECRET: z.string().min(32).optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().min(3600).max(7_776_000).default(2_592_000),
});

export type AppEnv = z.infer<typeof envSchema> & { corsOrigins: string[] };

/** Valida variáveis de ambiente na inicialização. Falha rápido sem expor valores. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuração inválida. Variáveis com problema: ${campos}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const faltando = (['JWT_ACCESS_SECRET', 'DATABASE_URL'] as const).filter((k) => !env[k]);
    // Em produção a origem do frontend deve ser HTTPS e não pode ser local.
    const origensInseguras = env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .filter((o) => !/^https:\/\//.test(o) || /\/\/(localhost|127\.|\[::1\])/.test(o));
    const problemas = [...faltando, ...(origensInseguras.length > 0 ? ['CORS_ORIGINS'] : [])];
    if (problemas.length > 0) {
      throw new Error(`Configuração inválida. Variáveis com problema: ${problemas.join(', ')}`);
    }
  }
  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
