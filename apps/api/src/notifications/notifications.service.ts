import { Injectable } from '@nestjs/common';
import type { NotificationDto } from '@pulseops/shared';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, limit = 50): Promise<NotificationDto[]> {
    const rows = await this.prisma.db.notification.findMany({
      where: { organizationId },
      include: {
        alertRule: { select: { name: true } },
        incident: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((n) => ({
      id: n.id,
      event: n.event,
      status: n.status,
      attempts: n.attempts,
      lastError: n.lastError,
      ruleName: n.alertRule?.name ?? null,
      incidentTitle: n.incident?.title ?? null,
      createdAt: n.createdAt.toISOString(),
      sentAt: n.sentAt?.toISOString() ?? null,
    }));
  }
}
