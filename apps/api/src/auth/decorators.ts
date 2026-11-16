import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@pulseops/shared';
import type { AuthContext, AuthenticatedRequest } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Rota sem autenticação. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Restringe a rota aos papéis informados. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Injeta o contexto autenticado (usuário, organização e papel). */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.auth as AuthContext;
});
