import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HealthModule } from './modules/health/health.module';

// Wiring only. Keep imports alphabetical so two lanes adding a module merge cleanly.
@Module({
  imports: [PrismaModule, RedisModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
