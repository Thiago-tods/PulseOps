import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { APP_ENV } from './app-env';
import { PrismaService } from './prisma.service';
import { SecretsService } from './secrets.service';

/** Utilitários transversais: configuração validada e acesso ao banco. */
@Global()
@Module({
  providers: [{ provide: APP_ENV, useFactory: () => loadEnv() }, PrismaService, SecretsService],
  exports: [APP_ENV, PrismaService, SecretsService],
})
export class CommonModule {}
