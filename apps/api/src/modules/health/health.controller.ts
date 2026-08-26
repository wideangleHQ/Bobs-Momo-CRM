import { Controller, Get, HttpCode } from '@nestjs/common';
import { Public } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Liveness. Answers "is the process up", nothing more. Railway restarts on this.
  @Get('healthz')
  @HttpCode(200)
  healthz(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) };
  }

  // Readiness. Answers "can this instance serve traffic".
  @Get('readyz')
  async readyz(): Promise<{ status: string; db: string; redis: string; version: string }> {
    const [db, redis] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    // Redis down degrades caching and rate limiting, so it does not fail
    // readiness. A restart would not fix it and would take the API down too.
    return {
      status: db ? 'ok' : 'degraded',
      db: db ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
      version: process.env['RAILWAY_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'dev',
    };
  }
}
