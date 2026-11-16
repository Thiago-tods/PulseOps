import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createMonitorSchema,
  updateMonitorSchema,
  type CheckDto,
  type CreateMonitorInput,
  type MonitorDto,
  type UpdateMonitorInput,
} from '@pulseops/shared';
import type { AuthContext, AuthenticatedRequest } from '../auth/auth.types';
import { CurrentAuth, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MonitorsService } from './monitors.service';

/** Leitura: qualquer papel. Escrita: OWNER, ADMIN e MEMBER. Exclusão: OWNER e ADMIN. */
@Controller('monitors')
export class MonitorsController {
  constructor(private readonly service: MonitorsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<MonitorDto[]> {
    return this.service.list(auth.organizationId);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MonitorDto> {
    return this.service.get(auth.organizationId, id);
  }

  @Get(':id/checks')
  checks(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<CheckDto[]> {
    return this.service.listChecks(auth.organizationId, id, limit ?? 50);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createMonitorSchema)) body: CreateMonitorInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<MonitorDto> {
    return this.service.create(auth, body, req.ip ?? null);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateMonitorSchema)) body: UpdateMonitorInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<MonitorDto> {
    return this.service.update(auth, id, body, req.ip ?? null);
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
