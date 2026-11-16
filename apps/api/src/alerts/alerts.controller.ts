import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createAlertRuleSchema,
  updateAlertRuleSchema,
  type AlertRuleDto,
  type CreateAlertRuleInput,
  type NotificationDto,
  type UpdateAlertRuleInput,
} from '@pulseops/shared';
import type { AuthContext, AuthenticatedRequest } from '../auth/auth.types';
import { CurrentAuth, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AlertsService } from './alerts.service';

/** Leitura: qualquer papel. Criar, alterar, testar e excluir: OWNER e ADMIN. */
@Controller('alert-rules')
export class AlertsController {
  constructor(private readonly service: AlertsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<AlertRuleDto[]> {
    return this.service.list(auth.organizationId);
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createAlertRuleSchema)) body: CreateAlertRuleInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<AlertRuleDto> {
    return this.service.create(auth, body, req.ip ?? null);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateAlertRuleSchema)) body: UpdateAlertRuleInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<AlertRuleDto> {
    return this.service.update(auth, id, body, req.ip ?? null);
  }

  @Roles('OWNER', 'ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post(':id/test')
  test(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<NotificationDto> {
    return this.service.sendTest(auth, id);
  }

  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.remove(auth, id, req.ip ?? null);
  }
}
