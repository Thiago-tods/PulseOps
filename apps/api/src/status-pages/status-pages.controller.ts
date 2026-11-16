import { Body, Controller, Get, Header, Param, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  statusPageSchema,
  type PublicStatusDto,
  type StatusPageDto,
  type StatusPageInput,
} from '@pulseops/shared';
import type { AuthContext, AuthenticatedRequest } from '../auth/auth.types';
import { CurrentAuth, Public, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StatusPagesService } from './status-pages.service';

/** Configuração da página de status (autenticada). Leitura: qualquer papel. Escrita: OWNER e ADMIN. */
@Controller('status-page')
export class StatusPageAdminController {
  constructor(private readonly service: StatusPagesService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<StatusPageDto | null> {
    return this.service.get(auth.organizationId);
  }

  @Roles('OWNER', 'ADMIN')
  @Put()
  save(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(statusPageSchema)) body: StatusPageInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<StatusPageDto> {
    return this.service.save(auth, body, req.ip ?? null);
  }
}

/** Página pública: sem autenticação, com limite de requisições e cache curto. */
@Controller('public/status')
export class PublicStatusController {
  constructor(private readonly service: StatusPagesService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=30')
  @Get(':slug')
  get(@Param('slug') slug: string): Promise<PublicStatusDto> {
    return this.service.getPublic(slug.toLowerCase().slice(0, 60));
  }
}
