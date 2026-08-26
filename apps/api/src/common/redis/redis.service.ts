import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';

// ponytail: the API boots without Redis and degrades to no caching. Cache is an
// optimisation here, not a system of record. If Redis becomes required (rate
// limiting in front of auth), promote the null path to a hard failure at boot.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;

  constructor() {
    const url = env().REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL not set, caching disabled');
      this.client = null;
      return;
    }
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    this.client.on('error', (e) => this.logger.warn(`redis: ${e.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* cache write failures are never fatal */
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      /* ignore */
    }
  }
}
