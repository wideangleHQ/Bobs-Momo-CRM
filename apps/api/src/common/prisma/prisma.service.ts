import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { dbPoolSize, env } from '../../config/env';
import { describePool, withPoolParams } from './database-url';

const STATS_INTERVAL_MS = 60_000;
const CONNECTION_FAULT = /EMAXCONN|max clients|too many (?:clients|connections)|pool|can't reach|connection|terminat|ECONN|timed out/i;

/** Prisma error text can echo a connection string. Strip the credentials before it reaches a log. */
function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]').slice(0, 500);
}

/**
 * The one PrismaClient of the API process (PrismaModule is @Global and the only
 * provider). Its pool is sized explicitly: see database-url.ts for why the
 * default is unsafe against the Supabase Session Pooler.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly poolDescription: string;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private stats = { queries: 0, slow: 0, maxMs: 0, totalMs: 0 };

  constructor() {
    const url = withPoolParams(env().DATABASE_URL, {
      limit: dbPoolSize(),
      timeoutSeconds: env().DB_POOL_TIMEOUT_S,
    });
    super({
      datasourceUrl: url,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    this.poolDescription = describePool(url);

    const slowMs = env().SLOW_QUERY_MS;
    const events = this as unknown as PrismaClient<Prisma.PrismaClientOptions, 'query' | 'warn' | 'error'>;
    // The SQL carries $n placeholders only. Parameters are never logged: they
    // hold password hashes, token hashes and personal data.
    events.$on('query', (e) => {
      this.stats.queries++;
      this.stats.totalMs += e.duration;
      if (e.duration > this.stats.maxMs) this.stats.maxMs = e.duration;
      if (e.duration >= slowMs) {
        this.stats.slow++;
        this.logger.warn(`slow query ${e.duration}ms ${e.query.slice(0, 400)}`);
      }
    });
    events.$on('warn', (e) => this.logger.warn(redact(e.message)));
    // Every failed statement raises this event, including the unique violations
    // the API turns into a 409. Only the ones about the connection are an alarm.
    events.$on('error', (e) => {
      const text = redact(e.message);
      if (CONNECTION_FAULT.test(text)) this.logger.error(`database connection fault: ${text}`);
      else this.logger.debug(`prisma: ${text}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`database connected ${this.poolDescription}`);
    // One line a minute while there is traffic: enough to see query volume and
    // the worst statement without a metrics stack. Silent when idle.
    this.statsTimer = setInterval(() => {
      const s = this.stats;
      this.stats = { queries: 0, slow: 0, maxMs: 0, totalMs: 0 };
      if (s.queries === 0) return;
      this.logger.log(
        `db last 60s queries=${s.queries} avgMs=${Math.round(s.totalMs / s.queries)} maxMs=${s.maxMs} slow=${s.slow}`,
      );
    }, STATS_INTERVAL_MS);
    this.statsTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer);
    await this.$disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
