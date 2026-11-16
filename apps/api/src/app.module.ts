import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ChecksModule } from './checks/checks.module';
import { CommonModule } from './common/common.module';
import { HealthModule } from './health/health.module';
import { IncidentsModule } from './incidents/incidents.module';
import { MonitorsModule } from './monitors/monitors.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { StatusPagesModule } from './status-pages/status-pages.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      // Os testes automatizados fazem muitos cadastros/logins seguidos.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    CommonModule,
    HealthModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    MonitorsModule,
    ChecksModule,
    IncidentsModule,
    AlertsModule,
    NotificationsModule,
    StatusPagesModule,
    AuditModule,
  ],
  // O ThrottlerGuard vem primeiro; os guards de auth são registrados no AuthModule.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
