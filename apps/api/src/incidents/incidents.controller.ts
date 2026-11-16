import { Controller, Get } from '@nestjs/common';
import type { IncidentDto } from '@pulseops/shared';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators';
import { IncidentsService } from './incidents.service';

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<IncidentDto[]> {
    return this.service.list(auth.organizationId);
  }
}
