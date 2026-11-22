// Connection ceiling and job lock behaviour against a real Postgres. Run on its own,
// because the pool size is read once at boot and the other suites use a larger one:
//   DB_POOL_SIZE=3 bun test --timeout 60000 test/db-connections.e2e.test.ts
// Same isolated-database and Redis requirements as the other e2e suites.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { toBusinessDate } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AdvisoryLockService, JOB_LOCK_KEYS } from '../src/common/jobs/advisory-lock.service';
import { withPoolParams } from '../src/common/prisma/database-url';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RedisService } from '../src/common/redis/redis.service';
import { PasswordService } from '../src/modules/auth/password.service';

const POOL = Number(process.env['DB_POOL_SIZE'] ?? 0);
const enabled = POOL > 0 && POOL <= 5;
const suite = enabled ? describe : describe.skip;

// The test's own single connection. Everything the test does to the database goes
// through it, and its pid is excluded from the count, so what is counted is the app.
const probe = new PrismaClient({
  datasourceUrl: withPoolParams(process.env['DATABASE_URL'] ?? 'postgresql://x@localhost/x', {
    limit: 1,
    timeoutSeconds: 30,
  }),
});
let app: INestApplication;
let url: string;
let token = '';
const USER = 'e2e.dbconn.owner';
const PASSWORD = 'saheed-momo-2026';

const DAY_MS = 86_400_000;
const today = toBusinessDate();
const dayBefore = (n: number): string =>
  new Date(Date.parse(`${today}T00:00:00.000Z`) - n * DAY_MS).toISOString().slice(0, 10);

async function appConnections(): Promise<number> {
  const rows = await probe.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`;
  return rows[0]?.n ?? 0;
}

const get = (path: string) =>
  fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);

suite('database connection ceiling', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');

    await probe.user.deleteMany({ where: { username: USER } });
    const hash = await app.get(PasswordService).hash(PASSWORD);
    await probe.user.create({ data: { username: USER, passwordHash: hash, roleKey: 'OWNER', mustReset: false } });
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: USER, password: PASSWORD }),
    });
    token = ((await res.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await probe.user.deleteMany({ where: { username: USER } });
    await probe.$disconnect();
    await app?.close();
  });

  test('the app holds no more connections than its pool plus the one lock client, under concurrent analytics load', async () => {
    const redis = app.get(RedisService);
    const outlets = await probe.outlet.findMany({ where: { isActive: true }, select: { id: true } });
    const hash = createHash('sha1').update(outlets.map((o) => o.id).sort().join(',')).digest('hex').slice(0, 12);
    const dashKey = `analytics:dash:owner:${hash}:${today}`;

    let peak = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        peak = Math.max(peak, await appConnections());
        await new Promise((r) => setTimeout(r, 15));
      }
    })();

    const statuses: number[] = [];
    for (let wave = 0; wave < 4; wave++) {
      await redis.del(dashKey);
      const batch: Array<Promise<number>> = [];
      for (let i = 0; i < 10; i++) batch.push(get('/analytics/dashboard'));
      for (let i = 0; i < 10; i++) batch.push(get(`/analytics/sales?from=${dayBefore(20 + i)}&to=${today}`));
      for (let i = 0; i < 10; i++) batch.push(get(`/analytics/gross-margin?from=${dayBefore(10 + i)}&to=${today}`));
      for (let i = 0; i < 10; i++) batch.push(get(`/analytics/waste?from=${dayBefore(25 + i)}&to=${today}`));
      for (let i = 0; i < 10; i++) batch.push(get(`/analytics/consumption?from=${dayBefore(25 + i)}&to=${today}`));
      statuses.push(...(await Promise.all(batch)));
    }

    // The lock client is lazy: touch it so the count includes its connection.
    await app.get(AdvisoryLockService, { strict: false }).withLock('recurring-tasks', async () => {
      peak = Math.max(peak, await appConnections());
      return 0;
    });

    sampling = false;
    await sampler;

    expect(statuses.every((s) => s === 200)).toBe(true);
    console.log(`peak app connections: ${peak} (pool ${POOL} + 1 lock client)`);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(POOL + 1);
  }, 120_000);

  test('one owner dashboard build runs about ten statements, not seventeen, and returns every tile', async () => {
    const redis = app.get(RedisService);
    const outlets = await probe.outlet.findMany({ where: { isActive: true }, select: { id: true } });
    const hash = createHash('sha1').update(outlets.map((o) => o.id).sort().join(',')).digest('hex').slice(0, 12);
    await redis.del(`analytics:dash:owner:${hash}:${today}`);

    let statements = 0;
    const events = app.get(PrismaService) as unknown as PrismaClient<Prisma.PrismaClientOptions, 'query'>;
    events.$on('query', () => statements++);
    const res = await fetch(`${url}/analytics/dashboard`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { tiles: Record<string, unknown> };

    console.log(`owner dashboard statements: ${statements}`);
    expect(res.status).toBe(200);
    expect(Object.keys(body.tiles).sort()).toEqual(
      ['gameActivity', 'grossMarginApprox', 'lowStock', 'missingEntries', 'netSalesMtd', 'netSalesToday', 'overdueTasks', 'pendingApprovals', 'wastageValueMtd'],
    );
    // Auth and permission lookups add a few; the dashboard itself is ten or eleven.
    expect(statements).toBeLessThanOrEqual(16);
  });

  test('a lock held by another database session makes the job skip, and the job runs once it is released', async () => {
    const locks = app.get(AdvisoryLockService, { strict: false });
    const key = JOB_LOCK_KEYS['overdue-tasks'];
    let ran = 0;

    // The probe is a different session from the lock client: this is "another instance".
    await probe.$queryRaw`SELECT pg_advisory_lock(${key})::text AS l`;
    await locks.withLock('overdue-tasks', async () => (ran++, 0));
    expect(ran).toBe(0);

    await probe.$queryRaw`SELECT pg_advisory_unlock(${key})`;
    await locks.withLock('overdue-tasks', async () => (ran++, 0));
    expect(ran).toBe(1);
  });

  test('the same job cannot overlap itself in one process, and a failing job still releases its lock', async () => {
    const locks = app.get(AdvisoryLockService, { strict: false });
    let ran = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));

    const first = locks.withLock('recurring-tasks', async () => (ran++, await gate, 0));
    await new Promise((r) => setTimeout(r, 50));
    await locks.withLock('recurring-tasks', async () => (ran++, 0)); // refused: first is still running
    release();
    await first;
    expect(ran).toBe(1);

    await locks.withLock('recurring-tasks', async () => {
      throw new Error('boom');
    });
    // The failure must not leave the lock held or the in-process guard set.
    await locks.withLock('recurring-tasks', async () => (ran++, 0));
    expect(ran).toBe(2);

    // And no session is left holding it: another session can take it right away.
    const rows = await probe.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_try_advisory_lock(${JOB_LOCK_KEYS['recurring-tasks']}) AS ok`;
    expect(rows[0]?.ok).toBe(true);
    await probe.$queryRaw`SELECT pg_advisory_unlock(${JOB_LOCK_KEYS['recurring-tasks']})`;
  });
});
