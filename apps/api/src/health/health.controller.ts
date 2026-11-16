import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { HealthResponse } from '@pulseops/shared';
import { Public } from '../auth/decorators';
import { APP_ENV } from '../common/app-env';
import { PrismaService } from '../common/prisma.service';
import type { AppEnv } from '../config/env';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

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

  /**
   * Diagnóstico TEMPORÁRIO do IP do cliente atrás de proxies (Render, Cloudflare).
   * Desligado por padrão (404, igual a uma rota inexistente); ligue com DEBUG_CLIENT_IP=true só
   * enquanto investiga e desligue depois. Devolve apenas dados da própria requisição.
   */
  @Get('client')
  client(@Req() req: Request) {
    if (!this.env.DEBUG_CLIENT_IP) throw new NotFoundException();
    const header = (name: string): string | null => {
      const v = req.headers[name];
      return Array.isArray(v) ? v.join(', ') : (v ?? null);
    };
    return {
      ipUsadoPelaApi: req.ip ?? null,
      ips: req.ips,
      socketRemoto: req.socket.remoteAddress ?? null,
      trustProxy: this.env.TRUST_PROXY,
      cabecalhos: {
        'x-forwarded-for': header('x-forwarded-for'),
        'x-forwarded-proto': header('x-forwarded-proto'),
        'x-real-ip': header('x-real-ip'),
        'true-client-ip': header('true-client-ip'),
        'cf-connecting-ip': header('cf-connecting-ip'),
        forwarded: header('forwarded'),
      },
      // Só os NOMES de outros cabeçalhos de proxy/edge, sem valores.
      outrosCabecalhosDeProxy: Object.keys(req.headers).filter((h) =>
        /^(x-render|rndr|cf-|x-request-id|via|x-forwarded)/i.test(h),
      ),
    };
  }
}
