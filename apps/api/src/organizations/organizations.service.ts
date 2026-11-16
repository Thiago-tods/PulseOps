import { Injectable } from '@nestjs/common';
import type { OrganizationDto } from '@pulseops/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string): Promise<OrganizationDto> {
    const org = await this.prisma.db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
    return org;
  }

  async rename(auth: AuthContext, name: string): Promise<OrganizationDto> {
    const org = await this.prisma.db.organization.update({
      where: { id: auth.organizationId },
      data: { name },
      select: { id: true, name: true, slug: true },
    });
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'organization.rename',
      entityType: 'organization',
      entityId: org.id,
    });
    return org;
  }
}
