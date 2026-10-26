import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';

const LOCAL_MAX_ENTRIES = 5000;

// ponytail: without REDIS_URL the API falls back to a bounded in-process map, so
// the dashboard cache, idempotent replay, the refresh grace window and the game
// rate limit still work on a single instance. Each instance keeps its own map:
// run more than one and those guarantees become per instance, so set REDIS_URL.
// If Redis becomes required (rate limiting in front of auth), promote the null
// path to a hard failure at boot.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly local = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    const url = env().REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL not set, using a per-process in-memory cache');
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
    if (!this.client) {
      const hit = this.local.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= Date.now()) {
        this.local.delete(key);
        return null;
      }
      return JSON.parse(hit.value) as T;
    }
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) {
      // Serialised like Redis, so callers never share a mutable object.
      this.local.delete(key);
      this.local.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSeconds * 1000 });
      if (this.local.size > LOCAL_MAX_ENTRIES) {
        // Map iterates in insertion order: the first key is the oldest write.
        this.local.delete(this.local.keys().next().value!);
      }
      return;
    }
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* cache write failures are never fatal */
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (!this.client) {
      for (const k of keys) this.local.delete(k);
      return;
    }
    try {
      await this.client.del(...keys);
    } catch {
      /* ignore */
    }
  }
}
