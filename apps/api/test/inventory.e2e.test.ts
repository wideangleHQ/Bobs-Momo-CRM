// bun test apps/api
// The money path. Assumes `db:seed` has run.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { toBusinessDate } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;
let token: string;
let staffToken: string;
let outletId: string;
let otherOutletId: string;
let itemId: string;

const PASSWORD = 'saheed-momo-2026';
const MANAGER = 'e2e.inv.manager';
const STAFF = 'e2e.inv.staff';
const SKU = 'ITM-E2E-TEST-ITEM';

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

function today(): string {
  return toBusinessDate();
}

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  return (res.body?.['error'] as { code?: string } | undefined)?.code;
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

  const saheed = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  const patia = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } });
  outletId = saheed.id;
  otherOutletId = patia.id;

  await prisma.user.deleteMany({ where: { username: { in: [MANAGER, STAFF] } } });
  const manager = await prisma.user.create({
    data: { username: MANAGER, passwordHash: hash, roleKey: 'INVENTORY_MANAGER', mustReset: false },
  });
  await prisma.userOutlet.create({ data: { userId: manager.id, outletId } });
  const staff = await prisma.user.create({
    data: { username: STAFF, passwordHash: hash, roleKey: 'KITCHEN_MANAGER', mustReset: false },
  });
  await prisma.userOutlet.create({ data: { userId: staff.id, outletId } });

  const login = async (identifier: string) => {
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password: PASSWORD }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  token = await login(MANAGER);
  staffToken = await login(STAFF);

  const category = await prisma.itemCategory.findFirstOrThrow();
  const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'KG' } });
  await prisma.stockTransaction.deleteMany({ where: { item: { sku: SKU } } });
  await prisma.itemStock.deleteMany({ where: { item: { sku: SKU } } });
  await prisma.inventoryItem.deleteMany({ where: { sku: SKU } });
  const item = await prisma.inventoryItem.create({
    data: { sku: SKU, name: 'E2E Test Item', categoryId: category.id, unitId: unit.id },
  });
  itemId = item.id;
});

afterAll(async () => {
  await prisma.stockTransaction.deleteMany({ where: { item: { sku: SKU } } });
  await prisma.itemStock.deleteMany({ where: { item: { sku: SKU } } });
  await prisma.inventoryItem.deleteMany({ where: { sku: SKU } });
  await prisma.user.deleteMany({ where: { username: { in: [MANAGER, STAFF] } } });
  await prisma.$disconnect();
  await app?.close();
});

describe('the ledger', () => {
  test('an opening balance creates the stock row and the balance follows it', async () => {
    const res = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'OPENING',
      quantity: 20,
      businessDate: today(),
    });
    expect(res.status).toBe(201);
    expect(res.body?.['balanceAfter']).toBe('20.000');

    const stock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId, outletId } },
    });
    expect(stock.qtyOnHand.toFixed(3)).toBe('20.000');
  });

  test('a second opening on the same day is a conflict', async () => {
    const res = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'OPENING',
      quantity: 5,
      businessDate: today(),
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INVENTORY_OPENING_ALREADY_RECORDED');
  });

  test('an issue moves the balance down and records the sign', async () => {
    const res = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'ISSUED',
      quantity: 6,
      businessDate: today(),
      note: 'Morning momo prep',
    });
    expect(res.status).toBe(201);
    expect(res.body?.['signedQty']).toBe('-6.000');
    expect(res.body?.['balanceAfter']).toBe('14.000');
  });

  test('issuing more than is on hand is blocked, and the balance does not move', async () => {
    const res = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'ISSUED',
      quantity: 999,
      businessDate: today(),
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('INVENTORY_NEGATIVE_STOCK_BLOCKED');

    const stock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId, outletId } },
    });
    expect(stock.qtyOnHand.toFixed(3)).toBe('14.000');
  });

  test('wastage without a reason is rejected', async () => {
    const res = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'WASTAGE',
      quantity: 1,
      businessDate: today(),
    });
    expect(res.status).toBe(400);
  });

  test('an adjustment may drive the balance negative, with a reason', async () => {
    const res = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'ADJUSTMENT',
      signedQty: -20,
      businessDate: today(),
      reason: 'Physical count came back lower than the ledger',
    });
    expect(res.status).toBe(201);
    expect(res.body?.['balanceAfter']).toBe('-6.000');
  });

  test('a kitchen manager cannot record an adjustment', async () => {
    const res = await api(
      'POST',
      '/inventory/transactions',
      {
        itemId,
        outletId,
        type: 'ADJUSTMENT',
        signedQty: 5,
        businessDate: today(),
        reason: 'trying it on',
      },
      { authorization: `Bearer ${staffToken}` },
    );
    expect(res.status).toBe(403);
  });

  test('a future date and an over-long backdate are both refused', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    const ahead = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'RECEIVED',
      quantity: 1,
      businessDate: future,
    });
    expect(errorCode(ahead)).toBe('INVENTORY_FUTURE_BUSINESS_DATE');

    const behind = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'RECEIVED',
      quantity: 1,
      businessDate: stale,
    });
    expect(errorCode(behind)).toBe('INVENTORY_BACKDATE_LIMIT_EXCEEDED');
  });

  test('the balance always equals the sum of the ledger', async () => {
    const rows = await prisma.stockTransaction.findMany({ where: { itemId, outletId } });
    const sum = rows.reduce((acc, r) => acc + Number(r.signedQty), 0);
    const stock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId, outletId } },
    });
    expect(Number(stock.qtyOnHand)).toBeCloseTo(sum, 3);
  });
});

describe('idempotency', () => {
  test('the same key replays the first response instead of issuing twice', async () => {
    const key = `e2e-${Date.now()}`;
    const body = {
      itemId,
      outletId,
      type: 'RECEIVED',
      quantity: 10,
      businessDate: today(),
    };
    const first = await api('POST', '/inventory/transactions', body, { 'idempotency-key': key });
    const second = await api('POST', '/inventory/transactions', body, { 'idempotency-key': key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body?.['id']).toBe(first.body?.['id']);

    const received = await prisma.stockTransaction.count({
      where: { itemId, outletId, type: 'RECEIVED' },
    });
    expect(received).toBe(1);
  });

  test('reusing a key with a different body is a conflict', async () => {
    const key = `e2e-conflict-${Date.now()}`;
    const base = { itemId, outletId, type: 'RECEIVED', businessDate: today() };
    await api('POST', '/inventory/transactions', { ...base, quantity: 1 }, { 'idempotency-key': key });
    const clash = await api(
      'POST',
      '/inventory/transactions',
      { ...base, quantity: 2 },
      { 'idempotency-key': key },
    );
    expect(clash.status).toBe(409);
    expect(errorCode(clash)).toBe('IDEMPOTENCY_KEY_REPLAYED');
  });
});

describe('low stock', () => {
  test('fires on the downward crossing and stays quiet after it', async () => {
    await api('PATCH', `/inventory/stock/${itemId}/reorder-level`, {
      outletId,
      reorderLevel: 10,
    });
    // Get comfortably above the threshold first.
    await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'RECEIVED',
      quantity: 40,
      businessDate: today(),
    });
    await prisma.itemStock.update({
      where: { itemId_outletId: { itemId, outletId } },
      data: { lastAlertAt: null },
    });
    const before = await prisma.outboxEvent.count({ where: { eventKey: 'LOW_STOCK' } });

    const stock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId, outletId } },
    });
    const toIssue = Number(stock.qtyOnHand) - 5;

    const crossing = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'ISSUED',
      quantity: toIssue,
      businessDate: today(),
    });
    expect(crossing.body?.['lowStockRaised']).toBe(true);
    expect(await prisma.outboxEvent.count({ where: { eventKey: 'LOW_STOCK' } })).toBe(before + 1);

    // Still below the threshold, so no second alert. Six issues in an afternoon
    // must not become six WhatsApp messages.
    const again = await api('POST', '/inventory/transactions', {
      itemId,
      outletId,
      type: 'ISSUED',
      quantity: 1,
      businessDate: today(),
    });
    expect(again.body?.['lowStockRaised']).toBe(false);
    expect(await prisma.outboxEvent.count({ where: { eventKey: 'LOW_STOCK' } })).toBe(before + 1);
  });
});

describe('outlet scope', () => {
  test('an OWN_OUTLET role cannot write to the other outlet', async () => {
    // The kitchen manager holds inventory.transaction.create at OWN_OUTLET.
    // The inventory manager holds it at ALL_OUTLETS and legitimately reaches
    // both, which is why this case uses the kitchen manager.
    const res = await api(
      'POST',
      '/inventory/transactions',
      {
        itemId,
        outletId: otherOutletId,
        type: 'RECEIVED',
        quantity: 1,
        businessDate: today(),
      },
      { authorization: `Bearer ${staffToken}` },
    );
    // 404, not 403: a 403 would confirm the other outlet exists.
    expect(res.status).toBe(404);
  });

  test('the stock list is narrowed to the caller outlet without a parameter', async () => {
    const res = await api('GET', '/inventory/stock?pageSize=100', undefined, {
      authorization: `Bearer ${staffToken}`,
    });
    expect(res.status).toBe(200);
    const rows = res.body?.['data'] as unknown as { outletId: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.outletId === outletId)).toBe(true);
  });
});

// belowReorder used to filter the page Prisma had already returned and report
// the survivors as the total, so page one of the reorder list showed whichever
// of the first 25 items alphabetically happened to be low and told the manager
// that was all of them.
describe('the reorder list is complete', () => {
  test('belowReorder counts every low item, not just the ones on page one', async () => {
    const rows = await prisma.itemStock.findMany({
      where: { outletId, reorderLevel: { not: null }, item: { isActive: true } },
      select: { qtyOnHand: true, reorderLevel: true },
    });
    const expected = rows.filter(
      (r) => r.reorderLevel !== null && r.qtyOnHand.lessThan(r.reorderLevel),
    ).length;

    // A page size deliberately smaller than the catalogue.
    const res = await api(
      'GET',
      `/inventory/stock?belowReorder=true&pageSize=5&outletId=${outletId}`,
    );
    expect(res.status).toBe(200);
    const meta = res.body?.['meta'] as { total: number };
    expect(meta.total).toBe(expected);

    // And every row it did return really is below its level.
    const data = res.body?.['data'] as { isBelowReorder: boolean }[];
    expect(data.every((r) => r.isBelowReorder)).toBe(true);
  });
});
