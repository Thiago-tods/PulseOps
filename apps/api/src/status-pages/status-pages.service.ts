import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  OverallStatus,
  PublicMonitorState,
  PublicStatusDto,
  StatusPageDto,
  StatusPageInput,
} from '@pulseops/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { PrismaService } from '../common/prisma.service';

const DAY_MS = 86_400_000;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/** Estado geral: ignora monitores pausados ou sem verificação. */
export function computeOverall(states: PublicMonitorState[]): OverallStatus {
  const known = states.filter((s) => s === 'UP' || s === 'DOWN');
  if (known.length === 0) return 'UNKNOWN';
  const down = known.filter((s) => s === 'DOWN').length;
  if (down === 0) return 'OPERATIONAL';
  return down === known.length ? 'MAJOR_OUTAGE' : 'PARTIAL_OUTAGE';
}

@Injectable()
export class StatusPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string): Promise<StatusPageDto | null> {
    const page = await this.prisma.db.statusPage.findFirst({
      where: { organizationId },
      include: { monitors: { orderBy: { position: 'asc' } } },
    });
    if (!page) return null;
    return {
      slug: page.slug,
      title: page.title,
      description: page.description,
      isPublic: page.isPublic,
      monitors: page.monitors.map((m) => ({ monitorId: m.monitorId, displayName: m.displayName })),
    };
  }

  /** Cria ou atualiza a página única da organização. */
  async save(auth: AuthContext, input: StatusPageInput, ip: string | null): Promise<StatusPageDto> {
    const ids = [...new Set(input.monitors.map((m) => m.monitorId))];
    if (ids.length !== input.monitors.length) {
      throw new BadRequestException('Monitor repetido na página');
    }
    const owned = await this.prisma.db.monitor.count({
      where: { id: { in: ids }, organizationId: auth.organizationId },
    });
    if (owned !== ids.length) throw new BadRequestException('Monitor inválido');

    try {
      await this.prisma.db.$transaction(async (tx) => {
        const existing = await tx.statusPage.findFirst({
          where: { organizationId: auth.organizationId },
        });
        const data = {
          slug: input.slug,
          title: input.title,
          description: input.description,
          isPublic: input.isPublic,
        };
        const page = existing
          ? await tx.statusPage.update({ where: { id: existing.id }, data })
          : await tx.statusPage.create({ data: { ...data, organizationId: auth.organizationId } });
        await tx.statusPageMonitor.deleteMany({ where: { statusPageId: page.id } });
        await tx.statusPageMonitor.createMany({
          data: input.monitors.map((m, position) => ({
            statusPageId: page.id,
            monitorId: m.monitorId,
            displayName: m.displayName,
            position,
          })),
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Este endereço já está em uso');
      throw err;
    }
    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'status_page.save',
      entityType: 'status_page',
      ip,
      metadata: { publica: input.isPublic },
    });
    return (await this.get(auth.organizationId)) as StatusPageDto;
  }

  /** Dados públicos. Páginas privadas ou inexistentes respondem igual (404). */
  async getPublic(slug: string): Promise<PublicStatusDto> {
    const db = this.prisma.db;
    const page = await db.statusPage.findUnique({
      where: { slug },
      include: {
        monitors: { orderBy: { position: 'asc' }, include: { monitor: true } },
      },
    });
    if (!page || !page.isPublic) throw new NotFoundException('Página não encontrada');

    const monitorIds = page.monitors.map((m) => m.monitorId);
    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const since14 = new Date(Date.now() - 14 * DAY_MS);

    const [latest, counts, incidents] =
      monitorIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            db.monitorCheck.findMany({
              where: { monitorId: { in: monitorIds } },
              orderBy: { checkedAt: 'desc' },
              distinct: ['monitorId'],
              select: { monitorId: true, status: true, checkedAt: true },
            }),
            db.monitorCheck.groupBy({
              by: ['monitorId', 'status'],
              where: { monitorId: { in: monitorIds }, checkedAt: { gte: since30 } },
              _count: { _all: true },
            }),
            db.incident.findMany({
              where: {
                monitorId: { in: monitorIds },
                OR: [{ resolvedAt: null }, { startedAt: { gte: since14 } }],
              },
              orderBy: { startedAt: 'desc' },
              take: 20,
            }),
          ]);

    const latestBy = new Map(latest.map((l) => [l.monitorId, l]));
    const totals = new Map<string, { up: number; all: number }>();
    for (const c of counts) {
      const t = totals.get(c.monitorId) ?? { up: 0, all: 0 };
      t.all += c._count._all;
      if (c.status === 'UP') t.up += c._count._all;
      totals.set(c.monitorId, t);
    }
    // Nome público: o apelido escolhido, nunca dados internos do monitor.
    const publicName = new Map(
      page.monitors.map((m) => [m.monitorId, m.displayName ?? m.monitor.name]),
    );

    const monitors = page.monitors.map((m) => {
      const last = latestBy.get(m.monitorId);
      const state: PublicMonitorState = !m.monitor.enabled
        ? 'PAUSED'
        : !last
          ? 'UNKNOWN'
          : last.status === 'UP'
            ? 'UP'
            : 'DOWN';
      const t = totals.get(m.monitorId);
      return {
        name: publicName.get(m.monitorId) ?? m.monitor.name,
        state,
        uptime30d: t && t.all > 0 ? Math.round((t.up / t.all) * 10_000) / 100 : null,
        lastCheckedAt: last?.checkedAt.toISOString() ?? null,
      };
    });

    return {
      title: page.title,
      description: page.description,
      overall: computeOverall(monitors.map((m) => m.state)),
      updatedAt: new Date().toISOString(),
      monitors,
      incidents: incidents.map((i) => ({
        title: `${publicName.get(i.monitorId ?? '') ?? 'Serviço'} indisponível`,
        status: i.status,
        startedAt: i.startedAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
      })),
    };
  }
}
