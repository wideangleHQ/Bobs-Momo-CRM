// Per-address limit on failed sign-ins. It is OFF in the normal suite (every suite
// signs in from one address and several fail on purpose), so this file only runs
// when a small limit is set explicitly, and in its own process:
//   LOGIN_IP_FAILURE_LIMIT=5 bun test test/login-rate-limit.e2e.test.ts
// Same isolated-database and Redis requirements as the other e2e suites.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { RedisService } from '../src/common/redis/redis.service';
import { PasswordService } from '../src/modules/auth/password.service';

const LIMIT = Number(process.env['LOGIN_IP_FAILURE_LIMIT'] ?? 0);
const enabled = LIMIT > 0 && LIMIT <= 50;
const suite = enabled ? describe : describe.skip;

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;
const USER = 'e2e.ratelimit';
const PASSWORD = 'saheed-momo-2026';

const login = async (identifier: string, password: string, path = '/auth/login') => {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
};
const clearCounters = async () => {
  const redis = app.get(RedisService);
  await redis.del('auth:ipfail:::ffff:127.0.0.1', 'auth:ipfail:127.0.0.1', 'auth:ipfail:::1');
};

suite('failed sign-ins per address', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
    await clearCounters();
    await prisma.user.deleteMany({ where: { username: USER } });
    const hash = await app.get(PasswordService).hash(PASSWORD);
    await prisma.user.create({ data: { username: USER, passwordHash: hash, roleKey: 'KITCHEN_STAFF', mustReset: false } });
  });

  afterAll(async () => {
    await clearCounters();
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
    await app?.close();
  });

  test('guessing one password at many accounts is stopped', async () => {
    await clearCounters();
    for (let i = 0; i < LIMIT; i += 1) {
      const r = await login(`bmemp${String(i).padStart(4, '0')}`, 'password1234');
      expect(r.status).toBe(401);
    }
    const blocked = await login('bmemp9999', 'password1234');
    expect(blocked.status).toBe(429);
    expect((blocked.body?.['error'] as { code?: string }).code).toBe('COMMON_RATE_LIMITED');

    // Even the right credentials are refused while the address is blocked.
    expect((await login(USER, PASSWORD)).status).toBe(429);
  });

  test('once the counter is cleared the same address can sign in again', async () => {
    await clearCounters();
    expect((await login(USER, PASSWORD)).status).toBe(200);
  });

  test('successful sign-ins do not count towards the limit', async () => {
    await clearCounters();
    for (let i = 0; i < LIMIT * 2; i += 1) expect((await login(USER, PASSWORD)).status).toBe(200);
  });
});
