import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  resolvesToBlockedAddress,
  UrlRejectedError,
  validateTargetUrl,
} from '@pulseops/http-guard';
import type {
  CheckDto,
  CheckStatusDto,
  CreateMonitorInput,
  MonitorDto,
  UpdateMonitorInput,
} from '@pulseops/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { APP_ENV } from '../common/app-env';
import { PrismaService } from '../common/prisma.service';
import type { AppEnv } from '../config/env';

interface MonitorRow {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  intervalSec: number;
  timeoutMs: number;
  expectedStatus: number;
  failureThreshold: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CheckRow {
  status: string;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: Date;
}

function toCheckDto(c: CheckRow): CheckDto {
  return {
    status: c.status as CheckStatusDto,
    httpStatus: c.httpStatus,
    latencyMs: c.latencyMs,
    error: c.error,
    checkedAt: c.checkedAt.toISOString(),
  };
}

function toDto(m: MonitorRow, lastCheck: CheckRow | undefined): MonitorDto {
  return {
    id: m.id,
    name: m.name,
    url: m.url,
    method: m.method,
    intervalSec: m.intervalSec,
    timeoutMs: m.timeoutMs,
    expectedStatus: m.expectedStatus,
    failureThreshold: m.failureThreshold,
    enabled: m.enabled,
    lastCheck: lastCheck ? toCheckDto(lastCheck) : null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Toda consulta filtra por organizationId. Um id de outra organização é tratado
 * como inexistente (404), sem revelar que ele existe.
 */
@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private assertInterval(intervalSec: number | undefined): void {
    const min = this.env.MIN_MONITOR_INTERVAL_SEC;
    if (intervalSec !== undefined && intervalSec < min) {
      throw new BadRequestException(
        `O intervalo mínimo desta instalação é de ${Math.round(min / 60)} minuto(s)`,
      );
    }
  }

  /** Valida o alvo (estático + DNS atual). A checagem definitiva ocorre a cada execução. */
  private async normalizeUrl(raw: string): Promise<string> {
    let url: URL;
    try {
      url = validateTargetUrl(raw);
    } catch (err) {
      if (err instanceof UrlRejectedError) throw new BadRequestException(err.message);
      throw err;
    }
    if (await resolvesToBlockedAddress(url.hostname)) {
      throw new BadRequestException('O domínio resolve para um endereço não permitido');
    }
    return url.toString();
  }

  /** Última verificação de cada monitor informado (uma consulta só). */
  private async latestChecks(
    organizationId: string,
    monitorIds: string[],
  ): Promise<Map<string, CheckRow>> {
    if (monitorIds.length === 0) return new Map();
    const rows = await this.prisma.db.monitorCheck.findMany({
      where: { organizationId, monitorId: { in: monitorIds } },
      orderBy: { checkedAt: 'desc' },
      distinct: ['monitorId'],
    });
    return new Map(rows.map((r) => [r.monitorId, r]));
  }

  async list(organizationId: string): Promise<MonitorDto[]> {
    const rows = await this.prisma.db.monitor.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const latest = await this.latestChecks(
      organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toDto(r, latest.get(r.id)));
  }

  async get(organizationId: string, id: string): Promise<MonitorDto> {
    const row = await this.prisma.db.monitor.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Monitor não encontrado');
    const latest = await this.latestChecks(organizationId, [id]);
    return toDto(row, latest.get(id));
  }

  /** Histórico recente de verificações (mais novas primeiro), restrito à organização. */
  async listChecks(organizationId: string, id: string, limit: number): Promise<CheckDto[]> {
    const exists = await this.prisma.db.monitor.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Monitor não encontrado');
    const rows = await this.prisma.db.monitorCheck.findMany({
      where: { monitorId: id, organizationId },
      orderBy: { checkedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map(toCheckDto);
  }

  async create(
    auth: AuthContext,
    input: CreateMonitorInput,
    ip: string | null,
  ): Promise<MonitorDto> {
    const count = await this.prisma.db.monitor.count({
      where: { organizationId: auth.organizationId },
    });
    if (count >= this.env.MAX_MONITORS_PER_ORG) {
      throw new ConflictException(
        `Limite de ${this.env.MAX_MONITORS_PER_ORG} monitores por organização atingido`,
      );
    }
    this.assertInterval(input.intervalSec);
    const url = await this.normalizeUrl(input.url);
    try {
      const row = await this.prisma.db.monitor.create({
        data: { ...input, url, organizationId: auth.organizationId },
      });
      await this.audit.log({
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'monitor.create',
        entityType: 'monitor',
        entityId: row.id,
        ip,
      });
      return toDto(row, undefined);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Já existe um monitor com este nome');
      throw err;
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateMonitorInput,
    ip: string | null,
  ): Promise<MonitorDto> {
    await this.get(auth.organizationId, id);
    this.assertInterval(input.intervalSec);
    const data = { ...input, ...(input.url ? { url: await this.normalizeUrl(input.url) } : {}) };
    try {
      // updateMany com organizationId garante o escopo mesmo contra corridas.
      const result = await this.prisma.db.monitor.updateMany({
        where: { id, organizationId: auth.organizationId },
        data,
      });
      if (result.count === 0) throw new NotFoundException('Monitor não encontrado');
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Já existe um monitor com este nome');
      throw err;
    }
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'monitor.update',
      entityType: 'monitor',
      entityId: id,
      ip,
      metadata: { campos: Object.keys(input).join(',') },
    });
    return this.get(auth.organizationId, id);
  }

  async remove(auth: AuthContext, id: string, ip: string | null): Promise<void> {
    const result = await this.prisma.db.monitor.deleteMany({
      where: { id, organizationId: auth.organizationId },
    });
    if (result.count === 0) throw new NotFoundException('Monitor não encontrado');
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'monitor.delete',
      entityType: 'monitor',
      entityId: id,
      ip,
    });
  }
}
