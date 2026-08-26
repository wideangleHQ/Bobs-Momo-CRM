import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@bobs-momo/shared';
import { DomainError } from '../errors/domain.error';
import { RedisService } from '../redis/redis.service';

const TTL_SECONDS = 24 * 60 * 60;

interface StoredResponse {
  bodyHash: string;
  response: unknown;
}

/**
 * Replay protection for writes a phone on a bad connection will retry. The key
 * is scoped by user and route, so two people cannot collide on the same uuid,
 * and the request body is hashed so reusing a key with a different payload is a
 * conflict rather than a silently wrong replay.
 *
 * ponytail: Redis-only. If Redis is down this degrades to no replay protection
 * rather than blocking the write, because a kitchen that cannot record stock is
 * worse than a rare duplicate row. Move it to a table if that trade stops
 * holding.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  async replay<T>(
    key: string | undefined,
    userId: string,
    route: string,
    body: unknown,
  ): Promise<{ hit: T | null; commit: (response: T) => Promise<void> }> {
    if (!key) {
      return { hit: null, commit: async () => undefined };
    }

    const redisKey = `idem:${route}:${userId}:${key}`;
    const bodyHash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    const stored = await this.redis.get<StoredResponse>(redisKey);

    if (stored) {
      if (stored.bodyHash !== bodyHash) {
        throw DomainError.conflict(
          ERROR_CODES.IDEMPOTENCY_KEY_REPLAYED,
          'That request id was already used with a different body',
        );
      }
      return { hit: stored.response as T, commit: async () => undefined };
    }

    return {
      hit: null,
      commit: async (response: T) => {
        await this.redis.set(redisKey, { bodyHash, response }, TTL_SECONDS);
      },
    };
  }

  /** Rejects a missing header on routes where a duplicate would cost money. */
  static require(key: string | undefined): string {
    if (!key) {
      throw new DomainError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
        'This request needs an Idempotency-Key header',
      );
    }
    return key;
  }
}
