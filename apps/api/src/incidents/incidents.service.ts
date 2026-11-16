import { Injectable } from '@nestjs/common';
import type { IncidentDto } from '@pulseops/shared';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Incidentes da organização: abertos primeiro, depois os mais recentes. */
  async list(organizationId: string, limit = 50): Promise<IncidentDto[]> {
    const rows = await this.prisma.db.incident.findMany({
      where: { organizationId },
      include: { monitor: { select: { name: true } } },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const dtos = rows.map((r): IncidentDto => ({
      id: r.id,
      title: r.title,
      status: r.status,
      severity: r.severity,
      monitorId: r.monitorId,
      monitorName: r.monitor?.name ?? null,
      startedAt: r.startedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
    return [...dtos.filter((d) => !d.resolvedAt), ...dtos.filter((d) => d.resolvedAt)];
  }
}
