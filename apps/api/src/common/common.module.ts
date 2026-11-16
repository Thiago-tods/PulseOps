import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { APP_ENV } from './app-env';
import { PrismaService } from './prisma.service';

/** Utilitários transversais: configuração validada e acesso ao banco. */
@Global()
@Module({
  providers: [{ provide: APP_ENV, useFactory: () => loadEnv() }, PrismaService],
  exports: [APP_ENV, PrismaService],
})
export class CommonModule {}
