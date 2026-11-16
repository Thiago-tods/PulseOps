import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface AuditEntry {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Registra o evento. Falhas de auditoria não derrubam a requisição, mas são logadas. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.db.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          actorId: entry.actorId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          ip: entry.ip ?? null,
          metadata: entry.metadata,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao gravar auditoria (${entry.action}): ${String(err)}`);
    }
  }
}
