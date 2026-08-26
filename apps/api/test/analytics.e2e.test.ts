// bun test apps/api
// Daily sales entry and the reporting layer. Assumes `db:seed` has run, which
// leaves 30 trading days of stock movement across both outlets.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { toBusinessDate } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import { AnalyticsModule } from '../src/modules/analytics/analytics.module';
import { SalesModule } from '../src/modules/sales/sales.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;

const PASSWORD = 'saheed-momo-2026';
const OWNER = 'e2e.an.owner';
const MANAGER = 'e2e.an.manager';
const OPS = 'e2e.an.ops';
const KITCHEN = 'e2e.an.kitchen';
const USERNAMES = [OWNER, MANAGER, OPS, KITCHEN];
const PURCHASE_NO = 'PO-E2E-ANALYTICS';
const PRICE_PER_UNIT = '320.00';

const tokens: Record<string, string> = {};
const userIds: string[] = [];
let saheed = '';
let patia = '';
let pricedItemId = '';

const DAY_MS = 86_400_000;
const today = toBusinessDate();
const dayBefore = (n: number): string =>
  new Date(Date.parse(`${today}T00:00:00.000Z`) - n * DAY_MS).toISOString().slice(0, 10);

const D0 = today;
const D1 = dayBefore(1);
const D2 = dayBefore(2);
const D3 = dayBefore(3);
const REPORT_FROM = dayBefore(29);

function dayUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

async function api(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
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

function details(res: { body: Record<string, unknown> | null }): Record<string, unknown> {
  return ((res.body?.['error'] as { details?: Record<string, unknown> } | undefined)?.details ??
    {}) as Record<string, unknown>;
}

/** A sales entry written straight to the table, bypassing the create rules. */
async function seedEntry(
  outletId: string,
  businessDate: string,
  net: number,
  orderCount: number,
): Promise<string> {
  const row = await prisma.dailySalesEntry.create({
    data: {
      outletId,
      businessDate: dayUtc(businessDate),
      grossSales: new Prisma.Decimal(net.toFixed(2)),
      discounts: new Prisma.Decimal(0),
      netSales: new Prisma.Decimal(net.toFixed(2)),
      orderCount,
      cashAmount: new Prisma.Decimal(net.toFixed(2)),
      enteredById: userIds[0] ?? '',
    },
  });
  return row.id;
}

beforeAll(async () => {
  // SalesModule and AnalyticsModule are imported alongside AppModule so this
  // suite runs before the orchestrator wires them into the root module.
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, SalesModule, AnalyticsModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');

  const hash = await app.get(PasswordService).hash(PASSWORD);
  saheed = (await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } })).id;
  patia = (await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } })).id;

  await prisma.auditLog.deleteMany({ where: { actor: { username: { in: USERNAMES } } } });
  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });

  const make = async (username: string, roleKey: 'OWNER' | 'STORE_MANAGER' | 'OPERATIONS_MANAGER' | 'KITCHEN_MANAGER', outletId?: string) => {
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, roleKey, mustReset: false },
    });
    if (outletId) await prisma.userOutlet.create({ data: { userId: user.id, outletId } });
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: username, password: PASSWORD }),
    });
    tokens[username] = ((await res.json()) as { accessToken: string }).accessToken;
    userIds.push(user.id);
    return user.id;
  };

  // OWNER and OPERATIONS_MANAGER hold every active outlet at login, so they get
  // no UserOutlet row.
  const ownerId = await make(OWNER, 'OWNER');
  await make(MANAGER, 'STORE_MANAGER', saheed);
  await make(OPS, 'OPERATIONS_MANAGER');
  await make(KITCHEN, 'KITCHEN_MANAGER', saheed);

  await prisma.dailySalesEntry.deleteMany({
    where: { businessDate: { gte: dayUtc(D3) }, outletId: { in: [saheed, patia] } },
  });
  await seedEntry(saheed, D3, 50000, 400);
  await seedEntry(saheed, D2, 52000, 400);
  await seedEntry(patia, D2, 40000, 250);

  await prisma.purchase.deleteMany({ where: { purchaseNo: PURCHASE_NO } });
  await prisma.purchase.create({
    data: {
      purchaseNo: PURCHASE_NO,
      outletId: saheed,
      vendorId: (await prisma.vendor.findFirstOrThrow()).id,
      status: 'RECORDED',
      purchaseDate: dayUtc(D2),
      subtotal: new Prisma.Decimal('40000.00'),
      totalAmount: new Prisma.Decimal('40000.00'),
      recordedById: ownerId,
    },
  });

  // One priced item, observed before the seeded ledger starts, so every wastage
  // row for it in the window values at the same rate.
  const wastage = await prisma.stockTransaction.findFirstOrThrow({
    where: { type: 'WASTAGE', outletId: saheed, businessDate: { gte: dayUtc(REPORT_FROM) } },
  });
  pricedItemId = wastage.itemId;
  await prisma.itemPriceHistory.create({
    data: {
      itemId: pricedItemId,
      vendorId: (await prisma.vendor.findFirstOrThrow()).id,
      unitPrice: new Prisma.Decimal(PRICE_PER_UNIT),
      observedOn: dayUtc(dayBefore(40)),
    },
  });
});

afterAll(async () => {
  await prisma.itemPriceHistory.deleteMany({
    where: { itemId: pricedItemId, observedOn: dayUtc(dayBefore(40)) },
  });
  await prisma.purchase.deleteMany({ where: { purchaseNo: PURCHASE_NO } });
  await prisma.dailySalesEntry.deleteMany({
    where: { businessDate: { gte: dayUtc(D3) }, outletId: { in: [saheed, patia] } },
  });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
  await prisma.$disconnect();
  await app?.close();
});

describe('daily sales entry', () => {
  test('a create computes netSales from gross and discounts', async () => {
    const res = await api('POST', '/sales-entries', tokens[MANAGER] ?? '', {
      outletId: saheed,
      businessDate: D1,
      grossSales: 62480,
      discounts: 1230,
      orderCount: 412,
      cashAmount: 18400,
      upiAmount: 39850,
      cardAmount: 3000,
    });
    expect(res.status).toBe(201);
    expect(res.body?.['netSales']).toBe('61250.00');
    expect(res.body?.['outletCode']).toBe('BM-SAHEED');
  });

  test('a client supplied netSales is rejected by name', async () => {
    const res = await api('POST', '/sales-entries', tokens[OWNER] ?? '', {
      outletId: patia,
      businessDate: D1,
      grossSales: 1000,
      netSales: 999,
      cashAmount: 1000,
    });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('COMMON_VALIDATION_FAILED');
  });

  test('a payment split that does not add up is a 422 carrying the drift', async () => {
    const res = await api('POST', '/sales-entries', tokens[OWNER] ?? '', {
      outletId: patia,
      businessDate: D0,
      grossSales: 40000,
      discounts: 0,
      cashAmount: 20000,
      upiAmount: 19660,
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('PAYMENT_SPLIT_MISMATCH');
    expect(details(res)['drift']).toBe('340.00');
    expect(details(res)['netSales']).toBe('40000.00');
  });

  test('a split inside the one rupee tolerance is accepted', async () => {
    const res = await api('POST', '/sales-entries', tokens[OWNER] ?? '', {
      outletId: patia,
      businessDate: D0,
      grossSales: 40000,
      cashAmount: 20000,
      upiAmount: 19999.25,
    });
    expect(res.status).toBe(201);
    expect(res.body?.['netSales']).toBe('40000.00');
  });

  test('discounts larger than gross are refused', async () => {
    const res = await api('POST', '/sales-entries', tokens[MANAGER] ?? '', {
      outletId: saheed,
      businessDate: D0,
      grossSales: 100,
      discounts: 200,
      cashAmount: 0,
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('DISCOUNT_EXCEEDS_GROSS');
  });

  test('the unique key on outlet and business date turns the second entry into a 409', async () => {
    const first = await prisma.dailySalesEntry.findUniqueOrThrow({
      where: { outletId_businessDate: { outletId: saheed, businessDate: dayUtc(D1) } },
    });
    const res = await api('POST', '/sales-entries', tokens[MANAGER] ?? '', {
      outletId: saheed,
      businessDate: D1,
      grossSales: 62480,
      discounts: 1230,
      cashAmount: 61250,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SALES_ENTRY_EXISTS');
    expect(details(res)['entryId']).toBe(first.id);
    expect(await prisma.dailySalesEntry.count({ where: { outletId: saheed, businessDate: dayUtc(D1) } })).toBe(1);
  });

  test('a retried submit with the same Idempotency-Key replays instead of colliding', async () => {
    const body = {
      outletId: patia,
      businessDate: D1,
      grossSales: 30000,
      cashAmount: 10000,
      upiAmount: 20000,
    };
    const headers = { 'idempotency-key': 'e2e-analytics-patia-d1' };
    const first = await api('POST', '/sales-entries', tokens[OWNER] ?? '', body, headers);
    const second = await api('POST', '/sales-entries', tokens[OWNER] ?? '', body, headers);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body?.['id']).toBe(first.body?.['id'] as string);
    expect(await prisma.dailySalesEntry.count({ where: { outletId: patia, businessDate: dayUtc(D1) } })).toBe(1);
  });

  test('a future business date is refused', async () => {
    const res = await api('POST', '/sales-entries', tokens[OWNER] ?? '', {
      outletId: saheed,
      businessDate: new Date(Date.parse(`${today}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10),
      grossSales: 100,
      cashAmount: 100,
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('SALES_ENTRY_FUTURE_DATE');
  });

  test('the list is paged and scoped to the caller outlets', async () => {
    const res = await api('GET', `/sales-entries?from=${D3}&to=${D0}&pageSize=50`, tokens[MANAGER] ?? '');
    expect(res.status).toBe(200);
    const rows = res.body?.['data'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r['outletCode'] === 'BM-SAHEED')).toBe(true);
    // Newest first, so a two outlet day reads as a pair.
    expect(rows[0]?.['businessDate']).toBe(D1);
  });

  test('an entry in another outlet is a 404, not a 403', async () => {
    const other = await prisma.dailySalesEntry.findFirstOrThrow({ where: { outletId: patia } });
    const res = await api('GET', `/sales-entries/${other.id}`, tokens[MANAGER] ?? '');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('BM-PATIA');
  });
});

describe('the 48 hour lock', () => {
  test('inside the window sales.entry.amend is enough, and netSales follows the patch', async () => {
    const entry = await prisma.dailySalesEntry.findUniqueOrThrow({
      where: { outletId_businessDate: { outletId: saheed, businessDate: dayUtc(D1) } },
    });
    const res = await api('PATCH', `/sales-entries/${entry.id}`, tokens[MANAGER] ?? '', {
      discounts: 2480,
      cashAmount: 17150,
    });
    expect(res.status).toBe(200);
    // 62480 gross less the new 2480 discount, and the split still adds up.
    expect(res.body?.['netSales']).toBe('60000.00');
  });

  test('a patch that breaks the split is refused even inside the window', async () => {
    const entry = await prisma.dailySalesEntry.findUniqueOrThrow({
      where: { outletId_businessDate: { outletId: saheed, businessDate: dayUtc(D1) } },
    });
    const res = await api('PATCH', `/sales-entries/${entry.id}`, tokens[MANAGER] ?? '', {
      discounts: 5000,
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('PAYMENT_SPLIT_MISMATCH');
  });

  test('three business days back the amend permission is no longer enough', async () => {
    const entry = await prisma.dailySalesEntry.findUniqueOrThrow({
      where: { outletId_businessDate: { outletId: saheed, businessDate: dayUtc(D3) } },
    });
    const res = await api('PATCH', `/sales-entries/${entry.id}`, tokens[MANAGER] ?? '', {
      grossSales: 51000,
      cashAmount: 51000,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SALES_ENTRY_LOCKED');
  });

  test('a holder of sales.entry.unlock can still amend a locked day', async () => {
    const entry = await prisma.dailySalesEntry.findUniqueOrThrow({
      where: { outletId_businessDate: { outletId: saheed, businessDate: dayUtc(D3) } },
    });
    const res = await api('PATCH', `/sales-entries/${entry.id}`, tokens[OWNER] ?? '', {
      grossSales: 51000,
      cashAmount: 51000,
    });
    expect(res.status).toBe(200);
    expect(res.body?.['netSales']).toBe('51000.00');
    const audits = await prisma.auditLog.count({
      where: { entityId: entry.id, action: 'sales.entry.amend' },
    });
    expect(audits).toBe(1);
  });

  test('a stamped lockedAt closes the entry even inside the window', async () => {
    const entry = await prisma.dailySalesEntry.findUniqueOrThrow({
      where: { outletId_businessDate: { outletId: saheed, businessDate: dayUtc(D2) } },
    });
    await prisma.dailySalesEntry.update({ where: { id: entry.id }, data: { lockedAt: new Date() } });
    const res = await api('PATCH', `/sales-entries/${entry.id}`, tokens[MANAGER] ?? '', {
      grossSales: 52001,
      cashAmount: 52001,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SALES_ENTRY_LOCKED');
    await prisma.dailySalesEntry.update({ where: { id: entry.id }, data: { lockedAt: null } });
  });
});

describe('the missing entry list', () => {
  test('names every active outlet with no row for that trading day', async () => {
    const service = app.get(await import('../src/modules/sales/sales.service').then((m) => m.SalesService));
    const missing = await service.findMissingEntries(D3);
    // Only SAHEED was entered on D3.
    expect(missing.map((m) => m.outletCode)).toEqual(['BM-PATIA']);
    expect(await service.findMissingEntries(D2)).toEqual([]);
  });
});

describe('inventory consumption', () => {
  test('issued plus wastage matches a hand computed sum from the ledger', async () => {
    const ledger = await prisma.stockTransaction.findMany({
      where: {
        outletId: saheed,
        type: { in: ['ISSUED', 'WASTAGE'] },
        businessDate: { gte: dayUtc(REPORT_FROM), lte: dayUtc(D0) },
      },
      select: { itemId: true, type: true, quantity: true },
    });
    const byItem = new Map<string, { issued: Prisma.Decimal; wastage: Prisma.Decimal }>();
    for (const row of ledger) {
      const acc = byItem.get(row.itemId) ?? {
        issued: new Prisma.Decimal(0),
        wastage: new Prisma.Decimal(0),
      };
      if (row.type === 'WASTAGE') acc.wastage = acc.wastage.plus(row.quantity);
      else acc.issued = acc.issued.plus(row.quantity);
      byItem.set(row.itemId, acc);
    }
    const [topItemId, top] = [...byItem.entries()].sort(([, a], [, b]) =>
      b.issued.plus(b.wastage).comparedTo(a.issued.plus(a.wastage)),
    )[0] ?? ['', { issued: new Prisma.Decimal(0), wastage: new Prisma.Decimal(0) }];

    const res = await api(
      'GET',
      `/analytics/consumption?from=${REPORT_FROM}&to=${D0}&outletId=${saheed}`,
      tokens[MANAGER] ?? '',
    );
    expect(res.status).toBe(200);
    const rows = res.body?.['rows'] as Array<Record<string, unknown>>;
    const first = rows[0];
    expect(first?.['itemId']).toBe(topItemId);
    expect(first?.['issuedQty']).toBe(top.issued.toFixed(3));
    expect(first?.['wastageQty']).toBe(top.wastage.toFixed(3));
    expect(first?.['consumedQty']).toBe(top.issued.plus(top.wastage).toFixed(3));

    // The drill-through series for one item sums to the same figure.
    const series = await api(
      'GET',
      `/analytics/consumption?from=${REPORT_FROM}&to=${D0}&outletId=${saheed}&itemId=${topItemId}`,
      tokens[MANAGER] ?? '',
    );
    const totals = series.body?.['totals'] as Record<string, string>;
    expect(totals['consumedQty']).toBe(top.issued.plus(top.wastage).toFixed(3));
  });

  test('the category rollup keeps units apart', async () => {
    const res = await api(
      'GET',
      `/analytics/consumption?from=${REPORT_FROM}&to=${D0}&outletId=${saheed}`,
      tokens[MANAGER] ?? '',
    );
    const categories = res.body?.['byCategory'] as Array<Record<string, string>>;
    const keys = categories.map((c) => `${c['categoryName']}|${c['unitCode']}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(categories.every((c) => typeof c['unitCode'] === 'string' && c['unitCode'].length > 0)).toBe(true);
  });

  test('a span wider than 92 days is refused before the query runs', async () => {
    const res = await api(
      'GET',
      `/analytics/consumption?from=${dayBefore(200)}&to=${D0}`,
      tokens[MANAGER] ?? '',
    );
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('DATE_RANGE_TOO_LARGE');
    expect(details(res)['maxDays']).toBe(92);
  });

  test('another outlet asked for by id is a 404', async () => {
    const res = await api(
      'GET',
      `/analytics/consumption?from=${REPORT_FROM}&to=${D0}&outletId=${patia}`,
      tokens[MANAGER] ?? '',
    );
    expect(res.status).toBe(404);
  });
});

describe('waste analysis', () => {
  test('wastage is valued at the price observed on or before the day it was binned', async () => {
    const wastage = await prisma.stockTransaction.aggregate({
      where: {
        itemId: pricedItemId,
        outletId: saheed,
        type: 'WASTAGE',
        businessDate: { gte: dayUtc(REPORT_FROM), lte: dayUtc(D0) },
      },
      _sum: { quantity: true },
    });
    const qty = wastage._sum.quantity ?? new Prisma.Decimal(0);
    const expected = qty.mul(PRICE_PER_UNIT).toDecimalPlaces(2).toFixed(2);

    const res = await api(
      'GET',
      `/analytics/waste?from=${REPORT_FROM}&to=${D0}&outletId=${saheed}&itemId=${pricedItemId}`,
      tokens[MANAGER] ?? '',
    );
    expect(res.status).toBe(200);
    expect(res.body?.['approximation']).toBe(true);
    const totals = res.body?.['totals'] as Record<string, unknown>;
    expect(totals['approxValue']).toBe(expected);
    expect(totals['unpricedRowCount']).toBe(0);
  });

  test('an item with no price history contributes zero and says so', async () => {
    const other = await prisma.stockTransaction.findFirstOrThrow({
      where: {
        type: 'WASTAGE',
        outletId: saheed,
        itemId: { not: pricedItemId },
        businessDate: { gte: dayUtc(REPORT_FROM) },
      },
    });
    const res = await api(
      'GET',
      `/analytics/waste?from=${REPORT_FROM}&to=${D0}&outletId=${saheed}&itemId=${other.itemId}`,
      tokens[MANAGER] ?? '',
    );
    const rows = res.body?.['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r['approxValue'] === '0.00')).toBe(true);
    expect(rows.every((r) => r['hasUnpricedRows'] === true)).toBe(true);
  });
});

describe('the sales report', () => {
  test('rows carry their comparisons and the window names its missing days', async () => {
    const res = await api('GET', `/analytics/sales?from=${D2}&to=${D0}`, tokens[OWNER] ?? '');
    expect(res.status).toBe(200);
    const rows = res.body?.['rows'] as Array<Record<string, unknown>>;
    const saheedD1 = rows.find((r) => r['outletId'] === saheed && r['businessDate'] === D1);
    expect(saheedD1?.['netSales']).toBe('60000.00');
    expect(saheedD1?.['prevDayNet']).toBe('52000.00');
    expect(saheedD1?.['prevDayChangePct']).toBe(15.38);
    // SAHEED never got a D0 entry.
    expect(res.body?.['missingDates']).toContain(D0);
  });

  test('combined does not double count a two outlet day', async () => {
    const res = await api(
      'GET',
      `/analytics/sales?from=${D1}&to=${D1}&groupBy=combined`,
      tokens[OWNER] ?? '',
    );
    const rows = res.body?.['rows'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.['netSales']).toBe('90000.00');
    expect(rows[0]?.['outletId']).toBeNull();
  });
});

describe('gross margin', () => {
  test('every response carries the approximation flag and the caveat', async () => {
    const res = await api('GET', `/analytics/gross-margin?from=${D3}&to=${D0}`, tokens[OWNER] ?? '');
    expect(res.status).toBe(200);
    expect(res.body?.['approximation']).toBe(true);
    expect(String(res.body?.['caveat'])).toContain('not profit');
    expect(String(res.body?.['caveat'])).toContain('Excludes labour');
    expect((res.body?.['excludes'] as string[]).length).toBe(6);
  });

  test('the margin is net sales less recorded purchases, per outlet', async () => {
    const res = await api('GET', `/analytics/gross-margin?from=${D3}&to=${D0}`, tokens[OWNER] ?? '');
    const rows = res.body?.['rows'] as Array<Record<string, unknown>>;
    const row = rows.find((r) => r['outletCode'] === 'BM-SAHEED');
    const sum = await prisma.dailySalesEntry.aggregate({
      where: { outletId: saheed, businessDate: { gte: dayUtc(D3), lte: dayUtc(D0) } },
      _sum: { netSales: true },
    });
    const net = sum._sum.netSales ?? new Prisma.Decimal(0);
    expect(row?.['netSales']).toBe(net.toFixed(2));
    expect(row?.['purchaseCost']).toBe('40000.00');
    expect(row?.['grossMarginApprox']).toBe(net.minus(40000).toFixed(2));
  });

  test('a role without analytics.pnl.read cannot read it', async () => {
    const res = await api('GET', `/analytics/gross-margin?from=${D3}&to=${D0}`, tokens[MANAGER] ?? '');
    expect(res.status).toBe(403);
  });
});

describe('the dashboard', () => {
  test('the owner variant carries every tile and both outlets', async () => {
    const res = await api('GET', '/analytics/dashboard', tokens[OWNER] ?? '');
    expect(res.status).toBe(200);
    expect(res.body?.['variant']).toBe('owner');
    expect(Object.keys(res.body?.['tiles'] as Record<string, unknown>).length).toBe(9);
    expect(JSON.stringify(res.body)).toContain('BM-PATIA');
  });

  test('an outlet manager sees the outlet variant and nothing from the other outlet', async () => {
    const res = await api('GET', '/analytics/dashboard', tokens[MANAGER] ?? '');
    expect(res.body?.['variant']).toBe('outlet');
    expect(JSON.stringify(res.body)).not.toContain('BM-PATIA');
  });

  test('a functional manager gets no money field at all', async () => {
    const res = await api('GET', '/analytics/dashboard', tokens[KITCHEN] ?? '');
    expect(res.body?.['variant']).toBe('functional');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('netSales');
    expect(body).not.toContain('value');
  });

  test('a second call inside the TTL is served from cache', async () => {
    const first = await api('GET', '/analytics/dashboard', tokens[OWNER] ?? '');
    const second = await api('GET', '/analytics/dashboard', tokens[OWNER] ?? '');
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
  });
});

describe('csv export', () => {
  test('the export runs the report through the caller outlet array', async () => {
    const res = await fetch(
      `${url}/analytics/export?report=sales&from=${D2}&to=${D0}&outletId=${saheed}`,
      { headers: { authorization: `Bearer ${tokens[OPS] ?? ''}` } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="bobsmomo_sales_BM-SAHEED_${D2}_${D0}.csv"`,
    );

    // Response.text() strips a leading byte order mark, so the bytes are what
    // proves Excel on Windows will open Odia and Hindi names correctly.
    const bytes = new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3);
    expect([...bytes]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'business_date,outlet_code,gross_sales,discounts,net_sales,order_count,avg_order_value,cash,upi,card,other',
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((l) => l.includes('BM-SAHEED'))).toBe(true);
    expect(text).not.toContain('BM-PATIA');
    // Money reads the way a printed total reads in Bhubaneswar.
    expect(lines.slice(1).some((l) => l.includes('"60,000.00"'))).toBe(true);
  });

  test('a null order count is an empty cell, never a zero', async () => {
    await prisma.dailySalesEntry.update({
      where: { outletId_businessDate: { outletId: saheed, businessDate: dayUtc(D2) } },
      data: { orderCount: null },
    });
    const res = await fetch(
      `${url}/analytics/export?report=sales&from=${D2}&to=${D2}&outletId=${saheed}`,
      { headers: { authorization: `Bearer ${tokens[OPS] ?? ''}` } },
    );
    const line = (await res.text()).trim().split('\r\n')[1] ?? '';
    expect(line).toContain('",,');
    expect(line).not.toContain(',0,');
  });

  test('an outlet the caller does not hold is a 404', async () => {
    const res = await fetch(
      `${url}/analytics/export?report=sales&from=${D2}&to=${D0}&outletId=11111111-1111-4111-8111-111111111111`,
      { headers: { authorization: `Bearer ${tokens[OPS] ?? ''}` } },
    );
    expect(res.status).toBe(404);
  });

  test('a role without analytics.export.create is refused', async () => {
    const res = await fetch(`${url}/analytics/export?report=sales&from=${D2}&to=${D0}`, {
      headers: { authorization: `Bearer ${tokens[MANAGER] ?? ''}` },
    });
    expect(res.status).toBe(403);
  });

  test('the export writes an audit row naming the resolved outlets', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'analytics.export.create' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.entityType).toBe('AnalyticsExport');
    expect(JSON.stringify(audit?.after)).toContain(saheed);
  });
});
