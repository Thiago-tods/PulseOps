import type { Role } from '@pulseops/shared';
import type { Request } from 'express';

/** Contexto autenticado. O organizationId vem SEMPRE do banco, nunca do cliente. */
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
