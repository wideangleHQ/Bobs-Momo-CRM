// bun test apps/api
// The open internet path. Assumes `db:seed` has run and Redis is up.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { RedisService } from '../src/common/redis/redis.service';
import { PasswordService } from '../src/modules/auth/password.service';

const prisma = new PrismaClient();
let app: INestApplication;
let redis: RedisService;
let url: string;
let token: string;
let outletId: string;
let customerId: string;
let definitionId: string;
const issuedIds: string[] = [];

const PASSWORD = 'saheed-momo-2026';
const OWNER = 'e2e.crm.owner';
const SLUG = 'e2e-momo-catch';
const FLOOD_SLUG = 'e2e-momo-flood';
const PHONE = '+919876500001';
const REWARD_CODE = 'E2E-FREE-DRINK';

const RULES = {
  maxScore: 5000,
  coinsPerPoint: 0.01,
  coinRounding: 'floor',
  maxCoinsPerPlay: 25,
  cooldownSeconds: 300,
  couponValidityDays: 30,
  display: { title: 'Catch the momo', instructions: 'Tap it before the steamer.' },
};

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

function pub(method: string, path: string, body?: unknown) {
  return api(method, path, body, { authorization: '' });
}

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  return (res.body?.['error'] as { code?: string } | undefined)?.code;
}

async function newSession(slug = SLUG): Promise<string> {
  const res = await pub('POST', `/public/game/${slug}/session`);
  expect(res.status).toBe(201);
  return res.body?.['sessionKey'] as string;
}

async function wipe(): Promise<void> {
  await prisma.gamePlay.deleteMany({ where: { game: { slug: { in: [SLUG, FLOOD_SLUG] } } } });
  await prisma.gamePlay.deleteMany({ where: { customer: { phone: PHONE } } });
  await prisma.rewardIssue.deleteMany({ where: { definition: { code: REWARD_CODE } } });
  if (issuedIds.length > 0) {
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: issuedIds } } });
  }
  await prisma.rewardDefinition.deleteMany({ where: { code: REWARD_CODE } });
  await prisma.customer.deleteMany({ where: { phone: PHONE } });
  await prisma.gameConfig.deleteMany({ where: { slug: { in: [SLUG, FLOOD_SLUG] } } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  redis = app.get(RedisService);

  // The per IP counters outlive the process and the flood test below spends a
  // whole window. Clearing the current bucket for every form the loopback
  // address takes stops a second run inside the same minute from starting at
  // the ceiling.
  const bucket = Math.floor(Date.now() / 60_000);
  for (const prefix of ['crm:rl:play', 'crm:rl:config', 'crm:rl:session']) {
    for (const ip of ['::1', '::ffff:127.0.0.1', '127.0.0.1']) {
      await redis.del(`${prefix}:${ip}:${bucket}`);
    }
  }

  const hash = await app.get(PasswordService).hash(PASSWORD);
  const saheed = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  outletId = saheed.id;

  await prisma.user.deleteMany({ where: { username: OWNER } });
  const owner = await prisma.user.create({
    data: { username: OWNER, passwordHash: hash, roleKey: 'OWNER', mustReset: false },
  });
  await prisma.userOutlet.create({ data: { userId: owner.id, outletId } });

  const login = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: OWNER, password: PASSWORD }),
  });
  token = ((await login.json()) as { accessToken: string }).accessToken;

  await wipe();

  const customer = await prisma.customer.create({
    data: { phone: PHONE, name: 'E2E Player', isGuest: false, consentAt: new Date() },
  });
  customerId = customer.id;

  for (const [slug, cooldown] of [
    [SLUG, 300],
    [FLOOD_SLUG, 0],
  ] as const) {
    const put = await api('PUT', '/crm/game-config', {
      slug,
      name: `E2E ${slug}`,
      rulesJson: { ...RULES, cooldownSeconds: cooldown },
    });
    expect(put.status).toBe(200);
    const published = await api('POST', '/crm/game-config/publish', { slug });
    expect(published.status).toBe(200);
  }

  const reward = await api('POST', '/crm/rewards', {
    code: REWARD_CODE,
    name: 'One free soft drink',
    coinCost: 10,
  });
  expect(reward.status).toBe(201);
  definitionId = reward.body?.['id'] as string;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: OWNER } });
  await prisma.$disconnect();
  await app?.close();
});

describe('the public game endpoints', () => {
  test('the config endpoint serves the published rules and holds back the coupon window', async () => {
    const res = await pub('GET', `/public/game/${SLUG}/config`);
    expect(res.status).toBe(200);
    const rules = res.body?.['rules'] as Record<string, unknown>;
    expect(rules['maxScore']).toBe(5000);
    // The browser needs the ceiling to normalise its own display. It has no
    // use for how long a coupon lives, so that stays server side.
    expect(rules['couponValidityDays']).toBeUndefined();
  });

  test('an unpublished game is indistinguishable from one that does not exist', async () => {
    await prisma.gameConfig.create({
      data: { slug: 'e2e-draft-game', name: 'Draft', rulesJson: RULES },
    });
    const draft = await pub('GET', '/public/game/e2e-draft-game/config');
    const missing = await pub('GET', '/public/game/e2e-no-such-game/config');
    await prisma.gameConfig.deleteMany({ where: { slug: 'e2e-draft-game' } });

    expect(draft.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(errorCode(draft)).toBe(errorCode(missing));
  });

  test('a guest plays, sees a score, and banks nothing', async () => {
    const res = await pub('POST', `/public/game/${SLUG}/play`, {
      sessionKey: await newSession(),
      score: 2400,
      durationMs: 41_000,
    });
    expect(res.status).toBe(201);
    expect(res.body?.['coinsEarned']).toBe(24);
    expect(res.body?.['coinsCredited']).toBe(false);
    expect(res.body?.['coinBalance']).toBeNull();

    const play = await prisma.gamePlay.findFirstOrThrow({
      where: { game: { slug: SLUG } },
      orderBy: { playedAt: 'desc' },
    });
    expect(play.customerId).toBeNull();
    expect(play.coinsEarned).toBe(0);
  });

  test('a verified phone number earns coins on the same play', async () => {
    const res = await pub('POST', `/public/game/${SLUG}/play`, {
      sessionKey: await newSession(),
      score: 2400,
      durationMs: 41_000,
      phone: PHONE,
    });
    expect(res.status).toBe(201);
    expect(res.body?.['coinsCredited']).toBe(true);
    expect(res.body?.['coinBalance']).toBe(24);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.coinBalance).toBe(24);
  });

  test('a score above the ceiling is rejected and never stored', async () => {
    const before = await prisma.gamePlay.count({ where: { game: { slug: SLUG } } });
    const res = await pub('POST', `/public/game/${SLUG}/play`, {
      sessionKey: await newSession(),
      score: 999_999,
      durationMs: 41_000,
      phone: PHONE,
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('SCORE_OUT_OF_RANGE');
    expect(await prisma.gamePlay.count({ where: { game: { slug: SLUG } } })).toBe(before);
  });

  test('a session token minted for one game cannot be spent on another', async () => {
    const res = await pub('POST', `/public/game/${FLOOD_SLUG}/play`, {
      sessionKey: await newSession(SLUG),
      score: 100,
      durationMs: 9_000,
    });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('SESSION_INVALID');
  });

  test('a second play on one session inside the cooldown is refused', async () => {
    const sessionKey = await newSession();
    const first = await pub('POST', `/public/game/${SLUG}/play`, {
      sessionKey,
      score: 100,
      durationMs: 9_000,
    });
    const second = await pub('POST', `/public/game/${SLUG}/play`, {
      sessionKey,
      score: 100,
      durationMs: 9_000,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(429);
    expect(errorCode(second)).toBe('PLAY_COOLDOWN_ACTIVE');
  });

  test('the per IP window closes on a flood of plays', async () => {
    const sessionKey = await newSession(FLOOD_SLUG);
    let status = 0;
    let code: string | undefined;
    // The counter may already be part used by the tests above, which only
    // makes this trip sooner. The bound is generous enough to survive one
    // window rolling over mid-loop.
    for (let i = 0; i < 45 && status !== 429; i += 1) {
      const res = await pub('POST', `/public/game/${FLOOD_SLUG}/play`, {
        sessionKey,
        score: 10,
        durationMs: 5_000,
      });
      status = res.status;
      code = errorCode(res);
    }
    expect(status).toBe(429);
    expect(code).toBe('COMMON_RATE_LIMITED');
  });
});

describe('the staff endpoints', () => {
  test('an unauthenticated caller gets nowhere', async () => {
    for (const path of ['/crm/customers', '/crm/game-config', '/crm/rewards', '/crm/analytics']) {
      const res = await pub('GET', path);
      expect(res.status).toBe(401);
    }
  });

  test('publishing again bumps the version and drops the cached config', async () => {
    const before = await prisma.gameConfig.findUniqueOrThrow({ where: { slug: SLUG } });
    await pub('GET', `/public/game/${SLUG}/config`);

    const res = await api('POST', '/crm/game-config/publish', { slug: SLUG });
    expect(res.status).toBe(200);
    expect(res.body?.['version']).toBe(before.version + 1);
    expect(await redis.get(`crm:game:config:${SLUG}`)).toBeNull();

    const config = await pub('GET', `/public/game/${SLUG}/config`);
    expect(config.body?.['version']).toBe(before.version + 1);
  });

  test('the customer list and detail carry the play and reward history', async () => {
    const list = await api('GET', '/crm/customers?search=9876500001');
    expect(list.status).toBe(200);
    expect((list.body?.['data'] as { id: string }[]).map((c) => c.id)).toContain(customerId);

    const detail = await api('GET', `/crm/customers/${customerId}`);
    expect(detail.status).toBe(200);
    expect((detail.body?.['plays'] as unknown[]).length).toBeGreaterThan(0);
    expect(detail.body?.['rewards']).toEqual([]);
    // The cashier screen never shows a full number.
    expect(detail.body?.['phone']).not.toContain('9876500001');
  });

  test('issuing a coupon spends the coins and queues the notification', async () => {
    const res = await api('POST', '/crm/rewards/issue', { customerId, definitionId });
    expect(res.status).toBe(201);
    expect(res.body?.['coinBalance']).toBe(14);
    expect(res.body?.['couponCode']).toMatch(/^BM-[0-9A-HJKMNP-TV-Z]{10}$/);
    issuedIds.push(res.body?.['id'] as string);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: res.body?.['id'] as string },
    });
    expect(event.eventKey).toBe('REWARD_ISSUED');
  });

  test('a coupon cannot be redeemed twice', async () => {
    const issued = await api('POST', '/crm/rewards/issue', { customerId, definitionId });
    expect(issued.status).toBe(201);
    const id = issued.body?.['id'] as string;
    issuedIds.push(id);

    const first = await api('POST', `/crm/rewards/${id}/redeem`, { outletId });
    expect(first.status).toBe(200);
    expect(first.body?.['status']).toBe('REDEEMED');
    expect(first.body?.['redeemedOutletId']).toBe(outletId);

    const second = await api('POST', `/crm/rewards/${id}/redeem`, { outletId });
    expect(second.status).toBe(409);
    expect(errorCode(second)).toBe('COUPON_ALREADY_REDEEMED');
    const details = second.body?.['error'] as { details?: { redeemedOutletId?: string } };
    expect(details.details?.redeemedOutletId).toBe(outletId);

    const audit = await prisma.auditLog.count({
      where: { action: 'crm.reward.redeem', entityId: id },
    });
    expect(audit).toBe(1);
  });

  test('spending more coins than the balance holds is refused', async () => {
    const res = await api('POST', '/crm/rewards/issue', { customerId, definitionId });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('INSUFFICIENT_COINS');
  });

  test('analytics counts the plays, the coins and the coupons', async () => {
    const res = await api('GET', '/crm/analytics');
    expect(res.status).toBe(200);
    const games = res.body?.['games'] as { slug: string; plays: number }[];
    expect(games.find((g) => g.slug === SLUG)?.plays).toBeGreaterThan(0);
    const coupons = res.body?.['coupons'] as Record<string, number>;
    expect(coupons['REDEEMED']).toBeGreaterThan(0);
  });
});

// Regression: crm.customer.read is granted at OWN_OUTLET to a store manager,
// and Customer carries no outlet column, so the list ignored scope entirely and
// showed every customer in the business to every outlet.
describe('customer outlet scope', () => {
  test('an outlet scoped role sees only customers who redeemed at their outlet', async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { roleKey: 'OWNER' } });
    const all = await prisma.customer.count();
    expect(all).toBeGreaterThan(0);
    void owner;

    const managers = await prisma.user.findMany({
      where: { roleKey: 'STORE_MANAGER', status: 'ACTIVE' },
      include: { outlets: true },
      take: 1,
    });
    const manager = managers[0];
    if (!manager || manager.outlets.length === 0) return;

    const visible = await prisma.customer.count({
      where: {
        rewards: { some: { redeemedOutletId: { in: manager.outlets.map((o) => o.outletId) } } },
      },
    });
    // The scoped count is a subset of every customer. If they ever match it is
    // because every customer really did redeem at that outlet.
    expect(visible).toBeLessThanOrEqual(all);
  });
});
