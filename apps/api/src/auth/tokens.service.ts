import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { APP_ENV } from '../common/app-env';
import type { AppEnv } from '../config/env';

const ISSUER = 'pulseops';
const AUDIENCE = 'pulseops-api';

@Injectable()
export class TokensService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  private get key(): Uint8Array {
    if (!this.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET não configurado');
    return new TextEncoder().encode(this.env.JWT_ACCESS_SECRET);
  }

  get accessTtlSec(): number {
    return this.env.ACCESS_TOKEN_TTL_SEC;
  }

  get refreshTtlSec(): number {
    return this.env.REFRESH_TOKEN_TTL_SEC;
  }

  async signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SEC}s`)
      .sign(this.key);
  }

  /** Retorna o id do usuário ou lança 401. */
  async verifyAccess(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub) throw new Error('sem sub');
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }

  /** Refresh token opaco: 256 bits aleatórios. Só o hash vai para o banco. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
