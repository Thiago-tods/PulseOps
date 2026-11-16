import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  updateOrganizationSchema,
  type OrganizationDto,
  type UpdateOrganizationInput,
} from '@pulseops/shared';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OrganizationsService } from './organizations.service';

/**
 * Não há :id nas rotas: a organização é sempre a do usuário autenticado,
 * o que elimina acesso cruzado por manipulação de identificadores.
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get('current')
  current(@CurrentAuth() auth: AuthContext): Promise<OrganizationDto> {
    return this.service.get(auth.organizationId);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('current')
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationInput,
  ): Promise<OrganizationDto> {
    return this.service.rename(auth, body.name);
  }
}
