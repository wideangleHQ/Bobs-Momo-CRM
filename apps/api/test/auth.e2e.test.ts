// bun test apps/api
// Boots the real Nest app against the local database. Assumes `db:seed` has run.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;

const OWNER = 'e2e.owner';
const STAFF = 'e2e.staff';
const PASSWORD = 'saheed-momo-2026';

async function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    cookie: refreshCookie(res.headers.getSetCookie()),
  };
}

function refreshCookie(setCookies: string[]): string | null {
  for (const c of setCookies) {
    const m = /^bm_rt=([^;]*)/.exec(c);
    if (m && m[1]) return decodeURIComponent(m[1]);
  }
  return null;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');

  const passwords = app.get(PasswordService);
  const hash = await passwords.hash(PASSWORD);
  const outlet = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });

  for (const username of [OWNER, STAFF]) {
    await prisma.user.deleteMany({ where: { username } });
  }
  await prisma.user.create({
    data: { username: OWNER, passwordHash: hash, roleKey: 'OWNER', mustReset: false },
  });
  const staff = await prisma.user.create({
    data: { username: STAFF, passwordHash: hash, roleKey: 'KITCHEN_STAFF', mustReset: false },
  });
  await prisma.userOutlet.create({ data: { userId: staff.id, outletId: outlet.id } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: [OWNER, STAFF] } } });
  await prisma.$disconnect();
  await app?.close();
});

describe('login', () => {
  test('returns a token, a cookie and the permission list', async () => {
    const res = await post('/auth/login', { identifier: OWNER, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.cookie).toBeTruthy();
    const user = res.body?.['user'] as Record<string, unknown>;
    expect(user['roleKey']).toBe('OWNER');
    expect(user['scope']).toBe('ALL_OUTLETS');
    expect(Object.keys(user['permissions'] as object).length).toBe(84);
  });

  test('a wrong password and an unknown user are indistinguishable', async () => {
    const wrong = await post('/auth/login', { identifier: OWNER, password: 'not-the-password' });
    const unknown = await post('/auth/login', { identifier: 'nobody.here', password: 'whatever' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(errorCode(wrong)).toBe('AUTH_INVALID_CREDENTIALS');
    expect(errorCode(unknown)).toBe('AUTH_INVALID_CREDENTIALS');
  });

  test('five failures lock the account, and the lock outlives a correct password', async () => {
    const username = 'e2e.locked';
    await prisma.user.deleteMany({ where: { username } });
    const passwords = app.get(PasswordService);
    await prisma.user.create({
      data: {
        username,
        passwordHash: await passwords.hash(PASSWORD),
        roleKey: 'KITCHEN_STAFF',
        mustReset: false,
      },
    });

    for (let i = 0; i < 5; i++) {
      const res = await post('/auth/login', { identifier: username, password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const locked = await post('/auth/login', { identifier: username, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(errorCode(locked)).toBe('AUTH_ACCOUNT_LOCKED');

    await prisma.user.deleteMany({ where: { username } });
  });
});

describe('refresh rotation', () => {
  test('rotates the token and kills the family when an old one comes back', async () => {
    const login = await post('/auth/login', { identifier: OWNER, password: PASSWORD });
    const first = login.cookie!;

    const rotated = await post('/auth/refresh', undefined, {
      cookie: `bm_rt=${encodeURIComponent(first)}`,
      'x-refresh-request': '1',
    });
    expect(rotated.status).toBe(200);
    expect(rotated.cookie).toBeTruthy();
    expect(rotated.cookie).not.toBe(first);

    // Inside the 5 second replay window the first token returns the cached
    // response instead of killing the family: that is the three-tabs case.
    const replay = await post('/auth/refresh', undefined, {
      cookie: `bm_rt=${encodeURIComponent(first)}`,
      'x-refresh-request': '1',
    });
    expect(replay.status).toBe(200);

    // Past the window it is real reuse. Force it by expiring the marker.
    await Bun.sleep(0);
    const redis = app.get(
      (await import('../src/common/redis/redis.service')).RedisService,
    );
    const { createHash } = await import('node:crypto');
    await redis.del(`auth:rot:${createHash('sha256').update(first).digest('hex')}`);

    const reuse = await post('/auth/refresh', undefined, {
      cookie: `bm_rt=${encodeURIComponent(first)}`,
      'x-refresh-request': '1',
    });
    expect(reuse.status).toBe(401);
    expect(errorCode(reuse)).toBe('AUTH_TOKEN_REUSED');

    // The whole family is dead, so the token that was valid a moment ago is not.
    const afterReuse = await post('/auth/refresh', undefined, {
      cookie: `bm_rt=${encodeURIComponent(rotated.cookie!)}`,
      'x-refresh-request': '1',
    });
    expect(afterReuse.status).toBe(401);
  });

  test('the cookie alone is not enough without the custom header', async () => {
    const login = await post('/auth/login', { identifier: OWNER, password: PASSWORD });
    const res = await post('/auth/refresh', undefined, {
      cookie: `bm_rt=${encodeURIComponent(login.cookie!)}`,
    });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('AUTH_TOKEN_MISSING');
  });
});

describe('rbac', () => {
  test('kitchen staff cannot reset another user password', async () => {
    const login = await post('/auth/login', { identifier: STAFF, password: PASSWORD });
    const token = login.body?.['accessToken'] as string;
    const res = await post(
      '/auth/admin/reset-password',
      { userId: '00000000-0000-4000-8000-000000000000', reason: 'trying it on' },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('COMMON_FORBIDDEN');
  });

  test('a request with no token is rejected before it reaches a service', async () => {
    const res = await post('/auth/admin/reset-password', {
      userId: '00000000-0000-4000-8000-000000000000',
      reason: 'no token',
    });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('AUTH_TOKEN_MISSING');
  });
});

describe('password change', () => {
  test('an account with no employee record can still change its own password', async () => {
    // The bootstrap OWNER is exactly this account. SELF on auth.password.change
    // means "my login", not "my employee record".
    const login = await post('/auth/login', { identifier: OWNER, password: PASSWORD });
    const token = login.body?.['accessToken'] as string;

    const next = 'patia-thukpa-2026';
    const changed = await post(
      '/auth/change-password',
      { currentPassword: PASSWORD, newPassword: next },
      { authorization: `Bearer ${token}` },
    );
    expect(changed.status).toBe(200);
    expect(changed.cookie).toBeTruthy();

    // Change it back so the rest of the file keeps working in any order.
    const back = await post(
      '/auth/change-password',
      { currentPassword: next, newPassword: PASSWORD },
      { authorization: `Bearer ${changed.body?.['accessToken'] as string}` },
    );
    expect(back.status).toBe(200);
  });

  test('rejects a deny-listed password and an unchanged one', async () => {
    const login = await post('/auth/login', { identifier: OWNER, password: PASSWORD });
    const auth = { authorization: `Bearer ${login.body?.['accessToken'] as string}` };

    const weak = await post(
      '/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'password123' },
      auth,
    );
    expect(weak.status).toBe(422);
    expect(errorCode(weak)).toBe('AUTH_WEAK_PASSWORD');

    const same = await post(
      '/auth/change-password',
      { currentPassword: PASSWORD, newPassword: PASSWORD },
      auth,
    );
    expect(same.status).toBe(422);
    expect(errorCode(same)).toBe('AUTH_SAME_PASSWORD');
  });
});

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  const err = res.body?.['error'] as { code?: string } | undefined;
  return err?.code;
}

// A lock used to be pushed forward on every wrong password, so a cook who kept
// mistyping locked himself out permanently and anyone who knew a username could
// hold an account shut with one request every fifteen minutes.
describe('lockout does not renew itself', () => {
  test('further wrong attempts do not extend an active lock', async () => {
    const username = 'e2e.lockrenew';
    await prisma.user.deleteMany({ where: { username } });
    const passwords = app.get(PasswordService);
    await prisma.user.create({
      data: {
        username,
        passwordHash: await passwords.hash(PASSWORD),
        roleKey: 'KITCHEN_STAFF',
        mustReset: false,
      },
    });

    for (let i = 0; i < 5; i++) {
      await post('/auth/login', { identifier: username, password: 'wrong' });
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(locked.lockedUntil).not.toBeNull();
    const firstLock = locked.lockedUntil!.getTime();

    await Bun.sleep(20);
    await post('/auth/login', { identifier: username, password: 'wrong' });
    await post('/auth/login', { identifier: username, password: 'wrong' });

    const after = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(after.lockedUntil!.getTime()).toBe(firstLock);
    // The counter does not keep climbing either.
    expect(after.failedLogins).toBe(5);

    await prisma.user.deleteMany({ where: { username } });
  });

  test('a stale counter restarts rather than accumulating', async () => {
    const username = 'e2e.lockstale';
    await prisma.user.deleteMany({ where: { username } });
    const passwords = app.get(PasswordService);
    await prisma.user.create({
      data: {
        username,
        passwordHash: await passwords.hash(PASSWORD),
        roleKey: 'KITCHEN_STAFF',
        mustReset: false,
        // Four old failures and a lock that expired long ago.
        failedLogins: 4,
        lockedUntil: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await post('/auth/login', { identifier: username, password: 'wrong' });
    const after = await prisma.user.findUniqueOrThrow({ where: { username } });
    // Five typos spread over a month must not add up to a lockout.
    expect(after.failedLogins).toBe(1);
    expect(after.lockedUntil).toBeNull();

    await prisma.user.deleteMany({ where: { username } });
  });
});
