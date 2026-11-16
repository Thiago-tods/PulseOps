import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@pulseops/shared';
import { Public } from '../auth/decorators';
import { PrismaService } from '../common/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: o processo está de pé. Não toca no banco (barato e sem acordar bancos serverless). */
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'pulseops-api',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: confirma que o banco responde. Falha com 503 sem expor detalhes. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível');
    }
    return { status: 'ok', database: 'ok' };
  }
}
