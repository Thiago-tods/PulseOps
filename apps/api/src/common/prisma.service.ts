import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@pulseops/db';
import type { AppEnv } from '../config/env';
import { APP_ENV } from './app-env';

/** Cliente Prisma criado sob demanda (a conexão só abre na primeira consulta). */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private client: PrismaClient | undefined;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  get db(): PrismaClient {
    if (!this.client) {
      if (!this.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
      this.client = createPrismaClient(this.env.DATABASE_URL, { poolMax: this.env.DB_POOL_MAX });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
