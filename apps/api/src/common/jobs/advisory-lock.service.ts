import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { describePool, withPoolParams } from '../prisma/database-url';

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
   * pg_try_advisory_lock is session scoped: it must be released by the same
   * database session that took it. Behind a transaction pooler the acquire and
   * the release can land on different backend sessions and the lock is stranded.
   * DIRECT_URL is meant to be a connection where a session stays a session.
   *
   * connection_limit=1 matters just as much. Prisma's default pool is 2 x CPU +
   * 1 connections, and with several of them the unlock can run on a different
   * connection from the lock, which leaves the lock held on the first one and
   * starves the job. One connection means lock, unlock and every other job's
   * lock all share one session. It is also the only way this client stays at one
   * slot of the 15 the Supabase Session Pooler allows.
   *
   * One session cannot tell two callers apart (pg advisory locks are re-entrant
   * within a session), so overlap inside this process is refused by `running`.
   * Overlap across processes is what the database lock is for.
   */
  private readonly lockUrl = withPoolParams(env().DIRECT_URL, { limit: 1, timeoutSeconds: 30 });
  private readonly direct = new PrismaClient({ datasourceUrl: this.lockUrl });

  private readonly running = new Set<JobName>();

  constructor() {
    this.log.log(`advisory lock client ${describePool(this.lockUrl)}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.direct.$disconnect();
  }

  /**
   * Runs `fn` only if no other instance holds this job's lock and this process
   * is not already running it. Never throws: a job that fails, or a database
   * that is unreachable, is a log line, not an unhandled rejection in a timer.
   */
  async withLock(name: JobName, fn: () => Promise<number>): Promise<void> {
    const key = JOB_LOCK_KEYS[name];
    if (key === undefined) throw new Error(`unregistered job: ${name}`);

    if (this.running.has(name)) {
      this.log.warn(`job=${name} outcome=skipped reason=previous run still active in this process`);
      return;
    }
    this.running.add(name);

    let locked = false;
    try {
      const rows = await this.direct.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${key}) AS locked`;
      locked = rows[0]?.locked === true;
      if (!locked) {
        this.log.debug(`${name}: lock held elsewhere, skipping this tick`);
        return;
      }

      const started = Date.now();
      try {
        const rowCount = await fn();
        this.log.log(`job=${name} outcome=ok ms=${Date.now() - started} rows=${rowCount}`);
      } catch (err) {
        this.log.error(`job=${name} outcome=error ms=${Date.now() - started}`, err as Error);
      }
    } catch (err) {
      this.log.error(`job=${name} outcome=error stage=lock`, err as Error);
    } finally {
      if (locked) {
        try {
          await this.direct.$queryRaw`SELECT pg_advisory_unlock(${key})`;
        } catch (err) {
          // The session is gone, so Postgres has already dropped the lock.
          this.log.error(`job=${name} outcome=error stage=unlock`, err as Error);
        }
      }
      this.running.delete(name);
    }
  }
}
