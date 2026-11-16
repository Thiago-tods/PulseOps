import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { API_PREFIX } from '@pulseops/shared';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { clientIpMiddleware } from './common/client-ip';

/** Configuração compartilhada entre bootstrap e testes e2e. */
export function setupApp(
  app: INestApplication,
  corsOrigins: string[],
  trustProxy = 0,
  proxySecret?: string,
): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // Atrás de proxy (Render, Cloudflare) é preciso confiar no X-Forwarded-For para obter o IP real.
  if (trustProxy > 0) express.set('trust proxy', trustProxy);
  // Antes de tudo: o limitador e a auditoria leem req.ip.
  app.use(clientIpMiddleware(proxySecret));
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
