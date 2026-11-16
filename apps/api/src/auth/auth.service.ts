import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AuthResponse, LoginInput, RegisterInput } from '@pulseops/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import type { RequestMeta } from './auth.types';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

export interface AuthResult {
  body: AuthResponse;
  refreshToken: string;
}

function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${randomBytes(3).toString('hex')}`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Aquece o hash fictício usado para equalizar o tempo de login com e-mail inexistente.
    void this.passwords.verifyDummy('x').catch(() => undefined);
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
    const passwordHash = await this.passwords.hash(input.password);
    let created;
    try {
      created = await this.prisma.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash },
        });
        const organization = await tx.organization.create({
          data: { name: input.organizationName, slug: slugify(input.organizationName) },
        });
        await tx.membership.create({
          data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
        });
        return { user, organization };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Não foi possível criar a conta com estes dados');
      }
      throw err;
    }
    await this.audit.log({
      organizationId: created.organization.id,
      actorId: created.user.id,
      action: 'auth.register',
      entityType: 'user',
      entityId: created.user.id,
      ip: meta.ip,
    });
    return this.issue(created.user, created.organization, 'OWNER', meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.db.user.findUnique({
      where: { email: input.email },
      include: { membership: { include: { organization: true } } },
    });
    if (!user || !user.membership) {
      await this.passwords.verifyDummy(input.password);
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    const ok = await this.passwords.verify(input.password, user.passwordHash);
    if (!ok || user.disabledAt) throw new UnauthorizedException('E-mail ou senha inválidos');

    await this.audit.log({
      organizationId: user.membership.organizationId,
      actorId: user.id,
      action: 'auth.login',
      ip: meta.ip,
    });
    return this.issue(user, user.membership.organization, user.membership.role, meta);
  }

  /** Rotação de refresh token com detecção de reuso (revoga a família inteira). */
  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    if (!rawToken) throw new UnauthorizedException('Sessão inválida');
    const db = this.prisma.db;
    const session = await db.session.findUnique({
      where: { refreshHash: this.tokens.hashRefresh(rawToken) },
    });
    if (!session) throw new UnauthorizedException('Sessão inválida');

    const revokeFamily = () =>
      db.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

    if (session.revokedAt) {
      await revokeFamily(); // token já usado: possível roubo
      throw new UnauthorizedException('Sessão inválida');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Sessão expirada');
    }
    const claimed = await db.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await revokeFamily();
      throw new UnauthorizedException('Sessão inválida');
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      include: { membership: { include: { organization: true } } },
    });
    if (!user || !user.membership || user.disabledAt) {
      throw new UnauthorizedException('Sessão inválida');
    }
    return this.issue(
      user,
      user.membership.organization,
      user.membership.role,
      meta,
      session.familyId,
    );
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const db = this.prisma.db;
    const session = await db.session.findUnique({
      where: { refreshHash: this.tokens.hashRefresh(rawToken) },
    });
    if (!session) return;
    await db.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<Omit<AuthResponse, 'accessToken' | 'expiresIn'>> {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { membership: { include: { organization: true } } },
    });
    if (!user.membership) throw new UnauthorizedException('Não autenticado');
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: {
        id: user.membership.organization.id,
        name: user.membership.organization.name,
        slug: user.membership.organization.slug,
      },
      role: user.membership.role,
    };
  }

  private async issue(
    user: { id: string; email: string; name: string },
    organization: { id: string; name: string; slug: string },
    role: AuthResponse['role'],
    meta: RequestMeta,
    familyId?: string,
  ): Promise<AuthResult> {
    const refresh = this.tokens.newRefreshToken();
    await this.prisma.db.session.create({
      data: {
        userId: user.id,
        familyId: familyId ?? crypto.randomUUID(),
        refreshHash: refresh.hash,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlSec * 1000),
      },
    });
    return {
      refreshToken: refresh.token,
      body: {
        accessToken: await this.tokens.signAccess(user.id),
        expiresIn: this.tokens.accessTtlSec,
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: organization.id, name: organization.name, slug: organization.slug },
        role,
      },
    };
  }
}
