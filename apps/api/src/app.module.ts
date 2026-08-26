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
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { VendorsModule } from './modules/vendors/vendors.module';

// Wiring only. Keep imports alphabetical so two lanes adding a module merge cleanly.
@Module({
  imports: [
    AuthModule,
    DocumentNumberModule,
    HealthModule,
    IdempotencyModule,
    InventoryModule,
    OutletCacheModule,
    PrismaModule,
    PurchaseModule,
    RedisModule,
    VendorsModule,
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
