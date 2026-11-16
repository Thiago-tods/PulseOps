import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AlertRuleDto,
  CreateAlertRuleInput,
  NotificationDto,
  UpdateAlertRuleInput,
} from '@pulseops/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { PrismaService } from '../common/prisma.service';
import { maskUrl, normalizeTargetUrl } from '../common/target-url';

export const MAX_ALERT_RULES_PER_ORG = 10;
export const TASK_SEND_NOTIFICATION = 'SEND_NOTIFICATION';

interface RuleRow {
  id: string;
  name: string;
  channel: 'EMAIL' | 'WEBHOOK';
  target: string;
  monitorId: string | null;
  enabled: boolean;
  createdAt: Date;
  monitor?: { name: string } | null;
}

function toDto(r: RuleRow): AlertRuleDto {
  return {
    id: r.id,
    name: r.name,
    channel: r.channel,
    targetPreview: maskUrl(r.target),
    monitorId: r.monitorId,
    monitorName: r.monitor?.name ?? null,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<AlertRuleDto[]> {
    const rows = await this.prisma.db.alertRule.findMany({
      where: { organizationId },
      include: { monitor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  private async assertMonitorInOrg(
    organizationId: string,
    monitorId: string | null,
  ): Promise<void> {
    if (!monitorId) return;
    const found = await this.prisma.db.monitor.findFirst({
      where: { id: monitorId, organizationId },
      select: { id: true },
    });
    if (!found) throw new BadRequestException('Monitor inválido');
  }

  async create(
    auth: AuthContext,
    input: CreateAlertRuleInput,
    ip: string | null,
  ): Promise<AlertRuleDto> {
    const count = await this.prisma.db.alertRule.count({
      where: { organizationId: auth.organizationId },
    });
    if (count >= MAX_ALERT_RULES_PER_ORG) {
      throw new ConflictException(
        `Limite de ${MAX_ALERT_RULES_PER_ORG} regras por organização atingido`,
      );
    }
    await this.assertMonitorInOrg(auth.organizationId, input.monitorId);
    const target = await normalizeTargetUrl(input.target);
    const row = await this.prisma.db.alertRule.create({
      data: {
        organizationId: auth.organizationId,
        name: input.name,
        channel: input.channel,
        target,
        monitorId: input.monitorId,
      },
      include: { monitor: { select: { name: true } } },
    });
    // Nunca registrar o destino: ele pode conter segredos.
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'alert_rule.create',
      entityType: 'alert_rule',
      entityId: row.id,
      ip,
    });
    return toDto(row);
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateAlertRuleInput,
    ip: string | null,
  ): Promise<AlertRuleDto> {
    const current = await this.prisma.db.alertRule.findFirst({
      where: { id, organizationId: auth.organizationId },
    });
    if (!current) throw new NotFoundException('Regra não encontrada');
    if (input.monitorId !== undefined) {
      await this.assertMonitorInOrg(auth.organizationId, input.monitorId);
    }
    const data = {
      ...input,
      ...(input.target ? { target: await normalizeTargetUrl(input.target) } : {}),
    };
    await this.prisma.db.alertRule.updateMany({
      where: { id, organizationId: auth.organizationId },
      data,
    });
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'alert_rule.update',
      entityType: 'alert_rule',
      entityId: id,
      ip,
      metadata: { campos: Object.keys(input).join(',') },
    });
    const row = await this.prisma.db.alertRule.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
      include: { monitor: { select: { name: true } } },
    });
    return toDto(row);
  }

  async remove(auth: AuthContext, id: string, ip: string | null): Promise<void> {
    const result = await this.prisma.db.alertRule.deleteMany({
      where: { id, organizationId: auth.organizationId },
    });
    if (result.count === 0) throw new NotFoundException('Regra não encontrada');
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'alert_rule.delete',
      entityType: 'alert_rule',
      entityId: id,
      ip,
    });
  }

  /** Enfileira o envio de uma notificação de teste para a regra. */
  async sendTest(auth: AuthContext, id: string): Promise<NotificationDto> {
    const rule = await this.prisma.db.alertRule.findFirst({
      where: { id, organizationId: auth.organizationId },
    });
    if (!rule) throw new NotFoundException('Regra não encontrada');
    const notification = await this.prisma.db.$transaction(async (tx) => {
      const n = await tx.notification.create({
        data: { organizationId: auth.organizationId, alertRuleId: rule.id, event: 'TEST' },
      });
      await tx.workerTask.create({
        data: {
          organizationId: auth.organizationId,
          type: TASK_SEND_NOTIFICATION,
          payload: { notificationId: n.id },
        },
      });
      return n;
    });
    return {
      id: notification.id,
      event: notification.event,
      status: notification.status,
      attempts: notification.attempts,
      lastError: null,
      ruleName: rule.name,
      incidentTitle: null,
      createdAt: notification.createdAt.toISOString(),
      sentAt: null,
    };
  }
}
