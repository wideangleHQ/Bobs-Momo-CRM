import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

/**
 * One bigint per job in a single global namespace. Adding a job means adding a
 * key here first: `withLock` refuses a name it does not know rather than
 * running the body unguarded.
 */
export const JOB_LOCK_KEYS = {
  'outbox-dispatch': 1001n,
  'notification-retry-sweep': 1002n,
  'overdue-tasks': 1003n,
  'recurring-tasks': 1004n,
  'stock-reconciliation': 1005n,
  'attendance-rollup': 1006n,
  'refresh-token-cleanup': 1007n,
  'audit-log-archive': 1008n,
  'low-stock-digest': 1009n,
  'sales-entry-reminder': 1010n,
} as const;

export type JobName = keyof typeof JOB_LOCK_KEYS;

@Injectable()
export class AdvisoryLockService implements OnModuleDestroy {
  private readonly log = new Logger(AdvisoryLockService.name);

  /**
   * Bound to DIRECT_URL, not the pooled DATABASE_URL, and this is the whole
   * reason the class owns a second client.
   *
   * pg_try_advisory_lock is session scoped. Application traffic goes through
   * Supavisor in transaction pooling mode, which hands the connection back to
   * the pool after every statement, so the acquire and the release would land
   * on different backend sessions: the unlock would fail and the lock would sit
   * on an abandoned session until it timed out. Every job would then log
   * "lock held elsewhere" forever without ever erroring. DIRECT_URL is port
   * 5432 with no pooler in front, where a session stays a session. One extra
   * connection buys the semantics this code already assumes.
   */
  private readonly direct = new PrismaClient({ datasourceUrl: env().DIRECT_URL });

  async onModuleDestroy(): Promise<void> {
    await this.direct.$disconnect();
  }

  /**
   * Runs `fn` only if no other instance holds this job's lock. Never throws:
   * a job that fails is a log line, not an unhandled rejection in a timer.
   */
  async withLock(name: JobName, fn: () => Promise<number>): Promise<void> {
    const key = JOB_LOCK_KEYS[name];
    if (key === undefined) throw new Error(`unregistered job: ${name}`);

    const rows = await this.direct.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${key}) AS locked`;
    if (rows[0]?.locked !== true) {
      this.log.debug(`${name}: lock held elsewhere, skipping this tick`);
      return;
    }

    const started = Date.now();
    try {
      const rowCount = await fn();
      this.log.log(`job=${name} outcome=ok ms=${Date.now() - started} rows=${rowCount}`);
    } catch (err) {
      this.log.error(`job=${name} outcome=error ms=${Date.now() - started}`, err as Error);
    } finally {
      await this.direct.$queryRaw`SELECT pg_advisory_unlock(${key})`;
    }
  }
}
