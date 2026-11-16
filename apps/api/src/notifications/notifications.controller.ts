import { Controller, Get } from '@nestjs/common';
import type { NotificationDto } from '@pulseops/shared';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<NotificationDto[]> {
    return this.service.list(auth.organizationId);
  }
}
