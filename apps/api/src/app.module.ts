import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OutletGuard } from './common/guards/outlet.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { DocumentNumberModule } from './common/documents/document-number.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { OutletCacheModule } from './common/outlets/outlet-cache.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { CrmModule } from './modules/crm/crm.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OutletsModule } from './modules/outlets/outlets.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { SalesModule } from './modules/sales/sales.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { WorkforceModule } from './modules/workforce/workforce.module';

// Wiring only. Keep imports alphabetical so two lanes adding a module merge cleanly.
@Module({
  imports: [
    AdminModule,
    AnalyticsModule,
    AuthModule,
    CrmModule,
    DocumentNumberModule,
    HealthModule,
    IdempotencyModule,
    InventoryModule,
    MessagingModule,
    NotificationsModule,
    OutletCacheModule,
    OutletsModule,
    PrismaModule,
    PurchaseModule,
    RedisModule,
    SalesModule,
    TasksModule,
    VendorsModule,
    WhatsappModule,
    WorkforceModule,
  ],
  providers: [
    // Order matters: each guard reads what the previous one attached.
    // JwtAuthGuard sets req.user, PermissionsGuard sets req.grant,
    // OutletGuard turns the grant modifier into req.scope.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: OutletGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
