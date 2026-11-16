import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export * from './generated/client';
export * from './secret-box';
export * from './webhook-signature';

export interface CreateClientOptions {
  /** Máximo de conexões do pool. Planos gratuitos (ex.: Neon) têm poucas conexões. */
  poolMax?: number;
}

/**
 * Cria um PrismaClient usando o driver adapter do PostgreSQL (Prisma 7).
 *
 * O adapter envia datas como horário UTC sem indicação de fuso; se a sessão do banco usar outro
 * fuso (ex.: America/Sao_Paulo), elas seriam lidas deslocadas. Por isso toda conexão fixa UTC.
 */
export function createPrismaClient(
  databaseUrl: string,
  options: CreateClientOptions = {},
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    options: '-c timezone=UTC',
    max: options.poolMax ?? 5,
    // Bancos serverless suspendem e levam alguns segundos para acordar.
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}
