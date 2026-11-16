import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@pulseops/shared';
import { PrismaService } from '../common/prisma.service';
import type { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC, ROLES_KEY } from './decorators';
import { TokensService } from './tokens.service';

/** Guard global: exige Bearer token válido, salvo em rotas @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const match = header ? /^Bearer (\S+)$/.exec(header) : null;
    if (!match?.[1]) throw new UnauthorizedException('Não autenticado');

    const userId = await this.tokens.verifyAccess(match[1]);
    const membership = await this.prisma.db.membership.findUnique({
      where: { userId },
      include: { user: { select: { disabledAt: true } } },
    });
    if (!membership || membership.user.disabledAt) {
      throw new UnauthorizedException('Não autenticado');
    }
    req.auth = {
      userId,
      organizationId: membership.organizationId,
      role: membership.role,
    };
    return true;
  }
}

/** Guard global: aplica @Roles(...) quando presente. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth || !required.includes(req.auth.role)) {
      throw new ForbiddenException('Acesso negado');
    }
    return true;
  }
}
