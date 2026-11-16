import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput,
} from '@pulseops/shared';
import { APP_ENV } from '../common/app-env';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AppEnv } from '../config/env';
import type { AuthContext, AuthenticatedRequest, RequestMeta } from './auth.types';
import { AuthService, type AuthResult } from './auth.service';
import { CurrentAuth, Public } from './decorators';
import { TokensService } from './tokens.service';

const COOKIE = 'pulseops_rt';
const COOKIE_PATH = '/api/v1/auth';

function readCookie(req: AuthenticatedRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private meta(req: AuthenticatedRequest): RequestMeta {
    return {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
    };
  }

  /** Defesa extra contra CSRF: se houver Origin, ele precisa estar na lista permitida. */
  private assertOrigin(req: AuthenticatedRequest): void {
    const origin = req.headers.origin;
    if (origin && !this.env.corsOrigins.includes(origin)) {
      throw new ForbiddenException('Origem não permitida');
    }
  }

  private setCookie(res: Response, token: string): void {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: this.tokens.refreshTtlSec * 1000,
    });
  }

  private respond(res: Response, result: AuthResult): AuthResponse {
    this.setCookie(res, result.refreshToken);
    res.setHeader('Cache-Control', 'no-store');
    return result.body;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    this.assertOrigin(req);
    return this.respond(res, await this.auth.register(body, this.meta(req)));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    this.assertOrigin(req);
    return this.respond(res, await this.auth.login(body, this.meta(req)));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    this.assertOrigin(req);
    return this.respond(res, await this.auth.refresh(readCookie(req, COOKIE), this.meta(req)));
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    this.assertOrigin(req);
    await this.auth.logout(readCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth.userId);
  }
}
