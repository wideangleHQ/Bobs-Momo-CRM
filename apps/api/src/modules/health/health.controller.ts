import { Controller, Get, HttpCode } from '@nestjs/common';
import { Public } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Liveness. Answers "is the process up", nothing more. Railway restarts on this.
  @Get('healthz')
  @HttpCode(200)
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness. Answers "can this instance serve traffic".
  @Get('readyz')
  async readyz(): Promise<{ status: string; db: string; redis: string }> {
    const [db, redis] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    // Redis down degrades caching only, so it does not fail readiness.
    return {
      status: db ? 'ok' : 'degraded',
      db: db ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
    };
  }
}
