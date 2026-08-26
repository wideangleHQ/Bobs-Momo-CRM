// bun test apps/api
// The notification pipeline. Assumes `db:seed` has run.
//
// Crons are off for the whole file: the dispatcher is driven by calling
// OutboxDispatcherService.dispatch() directly, so nothing here waits on a timer.
process.env['JOBS_ENABLED'] = 'false';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, type OutboxEvent } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { OutboxDispatcherService } from '../src/modules/notifications/outbox-dispatcher.service';
import { LowStockDigestJob } from '../src/jobs/low-stock-digest.job';

const prisma = new PrismaClient();
let app: INestApplication;
let dispatcher: OutboxDispatcherService;
let url: string;
let token: string;
let outletId: string;
let otherOutletId: string;
let invManagerId: string;
let storeManagerId: string;
let otherManagerId: string;

const PASSWORD = 'saheed-momo-2026';
const INV = 'e2e.notif.inv';
const STORE = 'e2e.notif.store';
const OTHER = 'e2e.notif.other';
const USERNAMES = [INV, STORE, OTHER];

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

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  return (res.body?.['error'] as { code?: string } | undefined)?.code;
}

/** Emits an outbox row already due, so the next claim picks it up. */
function emit(eventKey: string, aggregateId: string, payload: Record<string, unknown>) {
  return prisma.outboxEvent.create({
    data: {
      eventKey,
      aggregateType: 'ItemStock',
      aggregateId,
      payload: payload as Prisma.InputJsonValue,
      availableAt: new Date(Date.now() - 60_000),
    },
  });
}

/**
 * The claim takes 50 rows a tick and the shared test database carries a
 * backlog from other suites, so one tick is not guaranteed to reach this row.
 */
async function dispatchUntil(
  id: string,
  done: (row: OutboxEvent) => boolean,
  maxTicks = 8,
): Promise<OutboxEvent> {
  for (let i = 0; i < maxTicks; i += 1) {
    await dispatcher.dispatch();
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    if (done(row)) return row;
  }
  throw new Error(`outbox ${id} was never reached in ${maxTicks} ticks`);
}

function lowStockPayload(itemId: string) {
  return {
    outletId,
    itemId,
    itemName: 'Chicken Mince',
    outletName: 'BM-SAHEED',
    qtyOnHand: '1.800',
    reorderLevel: '2.000',
    unitCode: 'KG',
  };
}

async function notificationsFor(userId: string, aggregateId: string) {
  return prisma.notification.findMany({
    where: { userId, payload: { path: ['aggregateId'], equals: aggregateId } },
    orderBy: { channel: 'asc' },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    // NotificationsModule is not in app.module.ts yet; the orchestrator wires it.
    imports: [AppModule, NotificationsModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  dispatcher = app.get(OutboxDispatcherService);

  const passwords = app.get(PasswordService);
  const hash = await passwords.hash(PASSWORD);

  const saheed = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  const patia = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } });
  outletId = saheed.id;
  otherOutletId = patia.id;

  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
  const make = async (username: string, roleKey: 'INVENTORY_MANAGER' | 'STORE_MANAGER', at: string) => {
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, roleKey, mustReset: false },
    });
    await prisma.userOutlet.create({ data: { userId: user.id, outletId: at } });
    return user.id;
  };
  invManagerId = await make(INV, 'INVENTORY_MANAGER', outletId);
  storeManagerId = await make(STORE, 'STORE_MANAGER', outletId);
  otherManagerId = await make(OTHER, 'STORE_MANAGER', otherOutletId);

  const res = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: INV, password: PASSWORD }),
  });
  token = ((await res.json()) as { accessToken: string }).accessToken;
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { userId: { in: [invManagerId, storeManagerId, otherManagerId] } },
  });
  await prisma.notificationPreference.deleteMany({
    where: { userId: { in: [invManagerId, storeManagerId, otherManagerId] } },
  });
  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
  await prisma.$disconnect();
  await app?.close();
});

describe('the dispatcher', () => {
  const aggregateId = crypto.randomUUID();

  test('an emitted event reaches the outlet managers and nobody else', async () => {
    const row = await emit('LOW_STOCK', aggregateId, lowStockPayload(crypto.randomUUID()));
    const done = await dispatchUntil(row.id, (r) => r.status !== 'PENDING');

    expect(done.status).toBe('DONE');
    expect(done.processedAt).not.toBeNull();

    // LOW_STOCK is INVENTORY_MANAGER union STORE_MANAGER at the stock row's
    // outlet, over both of its default channels.
    const inv = await notificationsFor(invManagerId, aggregateId);
    expect(inv.map((n) => n.channel)).toEqual(['IN_APP', 'WHATSAPP']);
    expect(inv[0]?.title).toBe('Low stock: Chicken Mince');
    expect(inv[0]?.status).toBe('SENT');
    expect(inv[1]?.status).toBe('QUEUED');

    const store = await notificationsFor(storeManagerId, aggregateId);
    expect(store.map((n) => n.channel)).toEqual(['IN_APP', 'WHATSAPP']);

    // The Patia manager holds STORE_MANAGER but not at this outlet.
    expect(await notificationsFor(otherManagerId, aggregateId)).toHaveLength(0);
  });

  test('redelivering the same row writes no second notification', async () => {
    const before = await notificationsFor(invManagerId, aggregateId);
    const stale = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId, eventKey: 'LOW_STOCK' },
    });
    await prisma.outboxEvent.update({
      where: { id: stale.id },
      data: { status: 'PENDING', availableAt: new Date(Date.now() - 60_000) },
    });

    await dispatchUntil(stale.id, (r) => r.status === 'DONE');
    expect(await notificationsFor(invManagerId, aggregateId)).toHaveLength(before.length);
  });

  test('a failing row backs off instead of being lost', async () => {
    const row = await emit('NOT_A_REAL_EVENT', crypto.randomUUID(), { outletId });
    const failed = await dispatchUntil(row.id, (r) => r.attempts > 0);

    expect(failed.status).toBe('PENDING');
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toContain('NOT_A_REAL_EVENT');

    // First backoff is 30 seconds, so the next tick must step over it.
    const delay = failed.availableAt.getTime() - Date.now();
    expect(delay).toBeGreaterThan(20_000);
    expect(delay).toBeLessThanOrEqual(30_000);

    await dispatcher.dispatch();
    const untouched = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(untouched.attempts).toBe(1);

    await prisma.outboxEvent.delete({ where: { id: row.id } });
  });

  test('the fifth attempt marks the row dead', async () => {
    const row = await emit('NOT_A_REAL_EVENT', crypto.randomUUID(), { outletId });
    await prisma.outboxEvent.update({ where: { id: row.id }, data: { attempts: 4 } });

    const dead = await dispatchUntil(row.id, (r) => r.attempts > 4);
    expect(dead.status).toBe('DEAD');
    expect(dead.attempts).toBe(5);

    await prisma.outboxEvent.delete({ where: { id: row.id } });
  });
});

describe('the inbox', () => {
  test('the list is the caller alone, in-app only', async () => {
    const res = await api('GET', '/notifications?page=1&pageSize=50');
    expect(res.status).toBe(200);
    const data = res.body?.['data'] as { id: string; eventKey: string }[];
    expect(data.length).toBeGreaterThan(0);

    const ids = new Set(data.map((n) => n.id));
    const others = await prisma.notification.findMany({ where: { userId: storeManagerId } });
    expect(others.length).toBeGreaterThan(0);
    expect(others.some((n) => ids.has(n.id))).toBe(false);

    const mine = await prisma.notification.findMany({ where: { id: { in: [...ids] } } });
    expect(mine.every((n) => n.userId === invManagerId && n.channel === 'IN_APP')).toBe(true);
  });

  test('the unread count matches the unread rows', async () => {
    const expected = await prisma.notification.count({
      where: { userId: invManagerId, channel: 'IN_APP', readAt: null },
    });
    const res = await api('GET', '/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body?.['count']).toBe(expected);
  });

  test('marking one read drops the count by one', async () => {
    const before = (await api('GET', '/notifications/unread-count')).body?.['count'] as number;
    const target = await prisma.notification.findFirstOrThrow({
      where: { userId: invManagerId, channel: 'IN_APP', readAt: null },
    });

    const res = await api('POST', `/notifications/${target.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body?.['readAt']).toBeTruthy();

    const after = (await api('GET', '/notifications/unread-count')).body?.['count'] as number;
    expect(after).toBe(before - 1);
  });

  test("another user's notification is a 404, not a 403", async () => {
    const theirs = await prisma.notification.findFirstOrThrow({
      where: { userId: storeManagerId },
    });
    const res = await api('POST', `/notifications/${theirs.id}/read`);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('NOTIFICATION_NOT_FOUND');
  });

  test('read-all clears the badge', async () => {
    const res = await api('POST', '/notifications/read-all', {});
    expect(res.status).toBe(200);
    expect(res.body?.['updated']).toBeGreaterThanOrEqual(0);
    expect((await api('GET', '/notifications/unread-count')).body?.['count']).toBe(0);
  });
});

describe('preferences', () => {
  test('the matrix comes back with defaults and the in-app row locked', async () => {
    const res = await api('GET', '/notifications/preferences');
    expect(res.status).toBe(200);
    const data = res.body?.['data'] as {
      eventKey: string;
      channel: string;
      enabled: boolean;
      locked: boolean;
    }[];
    const inApp = data.find((p) => p.eventKey === 'LOW_STOCK' && p.channel === 'IN_APP');
    expect(inApp).toEqual({ eventKey: 'LOW_STOCK', channel: 'IN_APP', enabled: true, locked: true });
    expect(data.find((p) => p.eventKey === 'LOW_STOCK' && p.channel === 'WHATSAPP')?.enabled).toBe(
      true,
    );
  });

  test('the in-app channel cannot be turned off', async () => {
    const res = await api('PUT', '/notifications/preferences', {
      preferences: [{ eventKey: 'LOW_STOCK', channel: 'IN_APP', enabled: false }],
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CHANNEL_NOT_DISABLEABLE');
  });

  test('an unknown event key is rejected by name', async () => {
    const res = await api('PUT', '/notifications/preferences', {
      preferences: [{ eventKey: 'MOMO_BURNED', channel: 'WHATSAPP', enabled: false }],
    });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_EVENT_KEY');
  });

  test('a channel with no template for the event is rejected', async () => {
    const res = await api('PUT', '/notifications/preferences', {
      preferences: [{ eventKey: 'PURCHASE_DECIDED', channel: 'WHATSAPP', enabled: false }],
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CHANNEL_NOT_AVAILABLE');
  });

  test('a disabled channel is skipped for that user only', async () => {
    const put = await api('PUT', '/notifications/preferences', {
      preferences: [{ eventKey: 'LOW_STOCK', channel: 'WHATSAPP', enabled: false }],
    });
    expect(put.status).toBe(200);

    const aggregateId = crypto.randomUUID();
    const row = await emit('LOW_STOCK', aggregateId, lowStockPayload(crypto.randomUUID()));
    await dispatchUntil(row.id, (r) => r.status === 'DONE');

    // The in-app row is the record and survives the mute. WhatsApp does not.
    expect((await notificationsFor(invManagerId, aggregateId)).map((n) => n.channel)).toEqual([
      'IN_APP',
    ]);
    // Nobody else's preferences moved.
    expect((await notificationsFor(storeManagerId, aggregateId)).map((n) => n.channel)).toEqual([
      'IN_APP',
      'WHATSAPP',
    ]);
  });
});

describe('the low stock digest', () => {
  const SKU = 'ITM-E2E-NOTIF-DIGEST';
  let itemId: string;

  test('emits one alert per outlet listing everything below reorder level', async () => {
    const category = await prisma.itemCategory.findFirstOrThrow();
    const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'KG' } });
    await prisma.itemStock.deleteMany({ where: { item: { sku: SKU } } });
    await prisma.inventoryItem.deleteMany({ where: { sku: SKU } });
    const item = await prisma.inventoryItem.create({
      data: { sku: SKU, name: 'E2E Digest Item', categoryId: category.id, unitId: unit.id },
    });
    itemId = item.id;
    await prisma.itemStock.create({
      data: {
        itemId,
        outletId,
        qtyOnHand: new Prisma.Decimal('1.000'),
        reorderLevel: new Prisma.Decimal('5.000'),
      },
    });

    const job = app.get(LowStockDigestJob);
    const sent = await job.run();
    expect(sent).toBeGreaterThan(0);

    const alert = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventKey: 'OPERATIONAL_ALERT', aggregateId: outletId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    const payload = alert.payload as {
      userIds: string[];
      items: Record<string, string>[];
    };
    expect(payload.userIds).toContain(invManagerId);
    expect(payload.userIds).toContain(storeManagerId);
    expect(payload.userIds).not.toContain(otherManagerId);

    const line = payload.items.find((i) => i.itemId === itemId);
    expect(line).toEqual({
      itemId,
      itemName: 'E2E Digest Item',
      qtyOnHand: '1.000',
      reorderLevel: '5.000',
      unitCode: 'KG',
    });

    await dispatchUntil(alert.id, (r) => r.status === 'DONE');
    const inbox = await notificationsFor(invManagerId, outletId);
    expect(inbox.some((n) => n.eventKey === 'OPERATIONAL_ALERT')).toBe(true);

    await prisma.itemStock.deleteMany({ where: { itemId } });
    await prisma.inventoryItem.delete({ where: { id: itemId } });
    await prisma.outboxEvent.deleteMany({
      where: { eventKey: 'OPERATIONAL_ALERT', aggregateId: outletId, id: alert.id },
    });
  });
});
