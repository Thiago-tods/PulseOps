import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PublicStatusController, StatusPageAdminController } from './status-pages.controller';
import { StatusPagesService } from './status-pages.service';

@Module({
  imports: [AuditModule],
  controllers: [StatusPageAdminController, PublicStatusController],
  providers: [StatusPagesService],
})
export class StatusPagesModule {}
