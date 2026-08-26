import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const KEY = 'outlets:active';
const TTL_SECONDS = 300;

// ponytail: a 5 minute cache on a two row table. It exists because OutletGuard
// runs on every ALL_OUTLETS request, not because the query is slow. Drop the
// cache entirely if outlet writes ever need to take effect instantly.
@Injectable()
export class OutletCacheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async activeOutletIds(): Promise<string[]> {
    const cached = await this.redis.get<string[]>(KEY);
    if (cached) return cached;

    const rows = await this.prisma.outlet.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    const ids = rows.map((r) => r.id);
    await this.redis.set(KEY, ids, TTL_SECONDS);
    return ids;
  }

  async invalidate(): Promise<void> {
    await this.redis.del(KEY);
  }
}
