import type { PrismaClient } from '@pulseops/db';
import { safeRequest, type SafeRequestOptions, type SafeRequestResult } from '@pulseops/http-guard';
import { decideIncidentAction, evaluateResult, type CheckStatus } from '../check-logic';
import type { Logger } from '../logger';
import type { Task } from '../types';
import { queueNotifications } from './notifications';

export type RequestFn = (url: string, options: SafeRequestOptions) => Promise<SafeRequestResult>;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Executa a verificação de um monitor, grava o resultado e abre/resolve incidentes.
 * Toda requisição de rede passa por `safeRequest` (proteção contra SSRF).
 */
export class CheckMonitorHandler {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly request: RequestFn = safeRequest,
  ) {}

  async handle(task: Task): Promise<void> {
    const monitorId = (task.payload as { monitorId?: unknown } | null)?.monitorId;
    if (typeof monitorId !== 'string') throw new Error('Payload inválido: monitorId ausente');

    const monitor = await this.db.monitor.findUnique({ where: { id: monitorId } });
    // Monitor removido ou pausado desde o agendamento: nada a fazer.
    if (!monitor || !monitor.enabled) return;

    const result = await this.request(monitor.url, {
      method: monitor.method,
      timeoutMs: monitor.timeoutMs,
    });
    const outcome = evaluateResult(result, monitor.expectedStatus);

    await this.db.monitorCheck.create({
      data: {
        monitorId: monitor.id,
        organizationId: monitor.organizationId,
        status: outcome.status,
        httpStatus: outcome.httpStatus,
        latencyMs: outcome.latencyMs,
        error: outcome.error,
      },
    });

    const recent = await this.db.monitorCheck.findMany({
      where: { monitorId: monitor.id },
      orderBy: { checkedAt: 'desc' },
      take: Math.max(monitor.failureThreshold, 1),
      select: { status: true },
    });
    const open = await this.db.incident.findFirst({
      where: { monitorId: monitor.id, resolvedAt: null },
      select: { id: true },
    });
    const action = decideIncidentAction(
      recent.map((r) => r.status as CheckStatus),
      monitor.failureThreshold,
      open !== null,
    );

    if (action === 'OPEN') {
      await this.openIncident(monitor, outcome.error);
    } else if (action === 'RESOLVE' && open) {
      await this.resolveIncident(monitor, open.id);
    }
  }

  private async openIncident(
    monitor: { id: string; name: string; organizationId: string; failureThreshold: number },
    error: string | null,
  ): Promise<void> {
    try {
      await this.db.$transaction(async (tx) => {
        const incident = await tx.incident.create({
          data: {
            organizationId: monitor.organizationId,
            monitorId: monitor.id,
            title: `${monitor.name} indisponível`,
            status: 'INVESTIGATING',
            severity: 'MAJOR',
          },
        });
        await tx.incidentUpdate.create({
          data: {
            incidentId: incident.id,
            status: 'INVESTIGATING',
            message:
              `Incidente aberto automaticamente após ${monitor.failureThreshold} falha(s) consecutiva(s). ${error ?? ''}`.trim(),
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: monitor.organizationId,
            action: 'incident.open',
            entityType: 'incident',
            entityId: incident.id,
            metadata: { monitorId: monitor.id, origem: 'worker' },
          },
        });
        await queueNotifications(tx, {
          organizationId: monitor.organizationId,
          monitorId: monitor.id,
          incidentId: incident.id,
          event: 'INCIDENT_OPENED',
        });
      });
      this.log.warn('incidente aberto', { monitorId: monitor.id });
    } catch (err) {
      // Outro worker abriu primeiro (índice único parcial): comportamento esperado.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  private async resolveIncident(
    monitor: { id: string; organizationId: string },
    incidentId: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const result = await tx.incident.updateMany({
        where: { id: incidentId, resolvedAt: null },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
      if (result.count === 0) return;
      await tx.incidentUpdate.create({
        data: {
          incidentId,
          status: 'RESOLVED',
          message: 'O monitor voltou a responder normalmente. Incidente resolvido automaticamente.',
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: monitor.organizationId,
          action: 'incident.resolve',
          entityType: 'incident',
          entityId: incidentId,
          metadata: { monitorId: monitor.id, origem: 'worker' },
        },
      });
      await queueNotifications(tx, {
        organizationId: monitor.organizationId,
        monitorId: monitor.id,
        incidentId,
        event: 'INCIDENT_RESOLVED',
      });
    });
    this.log.info('incidente resolvido', { monitorId: monitor.id });
  }
}
