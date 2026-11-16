import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { setupApp } from './setup-app';

const LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({
      json: true, // logs estruturados
      logLevels: [...LEVELS.slice(0, LEVELS.indexOf(env.LOG_LEVEL) + 1)],
    }),
  });
  setupApp(app, env.corsOrigins, env.TRUST_PROXY, env.PROXY_SHARED_SECRET);
  await app.listen(env.API_PORT, env.API_HOST);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ level: 'fatal', message }));
  process.exit(1);
});
