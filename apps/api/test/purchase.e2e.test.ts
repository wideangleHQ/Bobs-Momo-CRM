// bun test apps/api
// The other half of the money path. Assumes `db:seed` has run.
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

let buyerToken: string; // PURCHASE_MANAGER, ALL_OUTLETS on purchase keys
let askerToken: string; // KITCHEN_MANAGER, OWN_OUTLET, may request but not approve
let outletId: string;
let vendorId: string;
let itemA: string;
let itemB: string;

const PASSWORD = 'saheed-momo-2026';
const BUYER = 'e2e.pur.buyer';
const ASKER = 'e2e.pur.asker';
const VENDOR = 'E2E Test Supplier';
const SKUS = ['ITM-E2E-PUR-A', 'ITM-E2E-PUR-B'];

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = buyerToken,
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

async function cleanup(): Promise<void> {
  const testUsers = await prisma.user.findMany({
    where: { username: { in: [BUYER, ASKER] } },
    select: { id: true },
  });
  const ids = testUsers.map((u) => u.id);

  await prisma.itemPriceHistory.deleteMany({ where: { item: { sku: { in: SKUS } } } });
  await prisma.purchaseItem.deleteMany({ where: { item: { sku: { in: SKUS } } } });
  await prisma.purchase.deleteMany({ where: { vendor: { name: { startsWith: 'E2E Test' } } } });
  await prisma.purchaseRequest.deleteMany({ where: { requestedById: { in: ids } } });
  await prisma.stockTransaction.deleteMany({ where: { item: { sku: { in: SKUS } } } });
  await prisma.itemStock.deleteMany({ where: { item: { sku: { in: SKUS } } } });
  await prisma.vendorItem.deleteMany({ where: { item: { sku: { in: SKUS } } } });
  await prisma.inventoryItem.deleteMany({ where: { sku: { in: SKUS } } });
  await prisma.vendor.deleteMany({ where: { name: { startsWith: 'E2E Test' } } });
  await prisma.user.deleteMany({ where: { username: { in: [BUYER, ASKER] } } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');

  await cleanup();

  const passwords = app.get(PasswordService);
  const hash = await passwords.hash(PASSWORD);
  const outlet = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  outletId = outlet.id;

  const buyer = await prisma.user.create({
    data: { username: BUYER, passwordHash: hash, roleKey: 'PURCHASE_MANAGER', mustReset: false },
  });
  await prisma.userOutlet.create({ data: { userId: buyer.id, outletId } });
  const asker = await prisma.user.create({
    data: { username: ASKER, passwordHash: hash, roleKey: 'KITCHEN_MANAGER', mustReset: false },
  });
  await prisma.userOutlet.create({ data: { userId: asker.id, outletId } });

  const login = async (identifier: string) => {
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password: PASSWORD }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  buyerToken = await login(BUYER);
  askerToken = await login(ASKER);

  const category = await prisma.itemCategory.findFirstOrThrow();
  const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'KG' } });
  const [a, b] = await Promise.all(
    SKUS.map((sku, i) =>
      prisma.inventoryItem.create({
        data: { sku, name: `E2E Purchase Item ${i}`, categoryId: category.id, unitId: unit.id },
      }),
    ),
  );
  itemA = a!.id;
  itemB = b!.id;

  const vendor = await prisma.vendor.create({ data: { name: VENDOR, phone: '9438000000' } });
  vendorId = vendor.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app?.close();
});

describe('vendors', () => {
  test('a case-different name is refused with a link to the existing row', async () => {
    const res = await api('POST', '/vendors', { name: VENDOR.toLowerCase() });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('VENDOR_NAME_TAKEN');
    const details = (res.body?.['error'] as { details: { existingId: string }[] }).details;
    expect(details[0]?.existingId).toBe(vendorId);
  });

  test('item links are replaced wholesale', async () => {
    const res = await api('PUT', `/vendors/${vendorId}/items`, { itemIds: [itemA, itemB] });
    expect(res.status).toBe(200);
    expect((res.body?.['itemIds'] as string[]).sort()).toEqual([itemA, itemB].sort());

    const trimmed = await api('PUT', `/vendors/${vendorId}/items`, { itemIds: [itemA] });
    expect(trimmed.body?.['itemIds']).toEqual([itemA]);
  });
});

describe('the request state machine', () => {
  let requestId: string;

  test('a kitchen manager can raise a request and it queues an event', async () => {
    const before = await prisma.outboxEvent.count({ where: { eventKey: 'PURCHASE_REQUESTED' } });
    const res = await api(
      'POST',
      '/purchase-requests',
      { outletId, lines: [{ itemId: itemA, quantity: 20 }] },
      askerToken,
    );
    expect(res.status).toBe(201);
    expect(res.body?.['status']).toBe('PENDING');
    expect(String(res.body?.['requestNo'])).toMatch(/^PR-\d{4}-\d{4}$/);
    requestId = res.body?.['id'] as string;

    expect(await prisma.outboxEvent.count({ where: { eventKey: 'PURCHASE_REQUESTED' } })).toBe(
      before + 1,
    );
  });

  test('the requester cannot approve their own request', async () => {
    const res = await api('POST', `/purchase-requests/${requestId}/approve`, {}, askerToken);
    expect(res.status).toBe(403);
  });

  test('the purchase manager approves it', async () => {
    const res = await api('POST', `/purchase-requests/${requestId}/approve`, {
      decisionNote: 'Order from the usual supplier',
    });
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('APPROVED');
  });

  test('an approved request cannot be approved again or rejected', async () => {
    const again = await api('POST', `/purchase-requests/${requestId}/approve`, {});
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('PR_INVALID_TRANSITION');

    const reject = await api('POST', `/purchase-requests/${requestId}/reject`, {});
    expect(reject.status).toBe(409);
  });

  test('recording a purchase against it marks it fulfilled', async () => {
    const res = await api('POST', '/purchases', {
      outletId,
      vendorId,
      requestId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 20, unitPrice: 100 }],
    });
    expect(res.status).toBe(201);
    expect(res.body?.['requestFulfilled']).toBe(true);

    const request = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe('FULFILLED');
  });

  test('a second purchase cannot fulfil the same request', async () => {
    const res = await api('POST', '/purchases', {
      outletId,
      vendorId,
      requestId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 1, unitPrice: 100 }],
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('PR_INVALID_TRANSITION');
  });
});

describe('recording a purchase', () => {
  let purchaseId: string;

  test('the server computes every money field and receives the stock', async () => {
    const res = await api('POST', '/purchases', {
      outletId,
      vendorId,
      invoiceNo: 'SV/8842',
      purchaseDate: toBusinessDate(),
      taxAmount: 50,
      lines: [
        { itemId: itemA, quantity: 15, unitPrice: 212.5 },
        { itemId: itemB, quantity: 4, unitPrice: 310 },
      ],
    });
    expect(res.status).toBe(201);
    purchaseId = res.body?.['id'] as string;

    // 15 * 212.50 = 3187.50, 4 * 310 = 1240.00, subtotal 4427.50, plus 50 tax.
    expect(res.body?.['subtotal']).toBe('4427.50');
    expect(res.body?.['totalAmount']).toBe('4477.50');
    expect(String(res.body?.['purchaseNo'])).toMatch(/^PO-\d{4}-\d{4}$/);

    const lines = res.body?.['lines'] as { itemId: string; balanceAfter: string }[];
    expect(lines.find((l) => l.itemId === itemB)?.balanceAfter).toBe('4.000');

    const stock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId: itemB, outletId } },
    });
    expect(stock.qtyOnHand.toFixed(3)).toBe('4.000');
  });

  test('a client-supplied total is a 400, not a silently ignored field', async () => {
    const res = await api('POST', '/purchases', {
      outletId,
      vendorId,
      purchaseDate: toBusinessDate(),
      totalAmount: 1,
      lines: [{ itemId: itemA, quantity: 1, unitPrice: 10 }],
    });
    expect(res.status).toBe(400);
  });

  test('the receipt lands in the ledger tagged to the purchase', async () => {
    const rows = await prisma.stockTransaction.findMany({
      where: { sourceType: 'PURCHASE', sourceId: purchaseId },
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.type === 'RECEIVED')).toBe(true);
  });

  test('a price more than 25 percent off the last observation is flagged, not blocked', async () => {
    const res = await api('POST', '/purchases', {
      outletId,
      vendorId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemB, quantity: 1, unitPrice: 420 }],
    });
    expect(res.status).toBe(201);
    const warnings = res.body?.['priceWarnings'] as { itemId: string; changePct: string }[];
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.itemId).toBe(itemB);
    expect(Number(warnings[0]?.changePct)).toBeCloseTo(35.5, 0);
  });

  test('an inactive vendor is refused', async () => {
    const dead = await prisma.vendor.create({
      data: { name: 'E2E Test Retired Supplier', isActive: false },
    });
    const res = await api('POST', '/purchases', {
      outletId,
      vendorId: dead.id,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 1, unitPrice: 10 }],
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('VENDOR_INACTIVE');
  });

  test('the same idempotency key does not receive the stock twice', async () => {
    const key = `e2e-pur-${Date.now()}`;
    const body = {
      outletId,
      vendorId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 3, unitPrice: 100 }],
    };
    const first = await api('POST', '/purchases', body, buyerToken, { 'idempotency-key': key });
    const second = await api('POST', '/purchases', body, buyerToken, { 'idempotency-key': key });
    expect(second.body?.['purchaseNo']).toBe(first.body?.['purchaseNo']);

    const count = await prisma.purchase.count({ where: { purchaseNo: String(first.body?.['purchaseNo']) } });
    expect(count).toBe(1);
  });
});

describe('voiding', () => {
  test('a void reverses the stock with adjustments and leaves the price history', async () => {
    const created = await api('POST', '/purchases', {
      outletId,
      vendorId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 7, unitPrice: 150 }],
    });
    const id = created.body?.['id'] as string;

    const beforeStock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId: itemA, outletId } },
    });
    const priceRows = await prisma.itemPriceHistory.count({ where: { itemId: itemA } });

    const res = await api('POST', `/purchases/${id}/void`, { reason: 'Wrong vendor selected' });
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('VOIDED');

    const afterStock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId: itemA, outletId } },
    });
    expect(Number(beforeStock.qtyOnHand) - Number(afterStock.qtyOnHand)).toBeCloseTo(7, 3);

    // The original RECEIVED row stays. The reversal is a new ADJUSTMENT.
    const reversals = await prisma.stockTransaction.findMany({
      where: { sourceType: 'PURCHASE_VOID', sourceId: id },
    });
    expect(reversals.length).toBe(1);
    expect(reversals[0]?.type).toBe('ADJUSTMENT');
    expect(reversals[0]?.reason).toContain('Wrong vendor selected');

    // A void usually means the paperwork was wrong, not that the price was.
    expect(await prisma.itemPriceHistory.count({ where: { itemId: itemA } })).toBe(priceRows);
  });

  test('voiding twice is a conflict', async () => {
    const created = await api('POST', '/purchases', {
      outletId,
      vendorId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 1, unitPrice: 150 }],
    });
    const id = created.body?.['id'] as string;
    await api('POST', `/purchases/${id}/void`, { reason: 'Duplicate entry' });
    const again = await api('POST', `/purchases/${id}/void`, { reason: 'Duplicate entry' });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('PURCHASE_ALREADY_VOIDED');
  });

  test('a void may drive the balance negative when the kitchen already used the stock', async () => {
    const created = await api('POST', '/purchases', {
      outletId,
      vendorId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemB, quantity: 5, unitPrice: 100 }],
    });
    const id = created.body?.['id'] as string;

    // Empty the shelf, then void the delivery that filled it.
    const stock = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId: itemB, outletId } },
    });
    await prisma.itemStock.update({ where: { id: stock.id }, data: { qtyOnHand: 0 } });

    const res = await api('POST', `/purchases/${id}/void`, { reason: 'Never actually delivered' });
    expect(res.status).toBe(200);

    const after = await prisma.itemStock.findUniqueOrThrow({ where: { id: stock.id } });
    // The ledger now says the outlet used stock it never received, which is the
    // discrepancy a manager needs to see rather than a blocked void.
    expect(Number(after.qtyOnHand)).toBeCloseTo(-5, 3);
  });
});

describe('the ledger still reconciles', () => {
  test('every balance equals the sum of its ledger rows', async () => {
    for (const itemId of [itemA, itemB]) {
      const rows = await prisma.stockTransaction.findMany({ where: { itemId, outletId } });
      const sum = rows.reduce((acc, r) => acc + Number(r.signedQty), 0);
      const stock = await prisma.itemStock.findUnique({
        where: { itemId_outletId: { itemId, outletId } },
      });
      // itemB had its balance forced to zero above, so only itemA is expected
      // to reconcile. Skip the one the test deliberately falsified.
      if (itemId === itemA) expect(Number(stock?.qtyOnHand)).toBeCloseTo(sum, 3);
    }
  });
});

// The RECORDED check used to sit outside the transaction with no status guard
// on the write, so two concurrent voids both applied compensating rows and
// stock came off twice. The ledger still summed to qtyOnHand, so no consistency
// check could catch it: the balance was simply wrong by the size of the bill.
describe('concurrent void', () => {
  test('two voids at once reverse the stock exactly once', async () => {
    const created = await api('POST', '/purchases', {
      outletId,
      vendorId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 9, unitPrice: 100 }],
    });
    const id = created.body?.['id'] as string;

    const before = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId: itemA, outletId } },
    });

    const results = await Promise.all([
      api('POST', `/purchases/${id}/void`, { reason: 'Double tap one' }),
      api('POST', `/purchases/${id}/void`, { reason: 'Double tap two' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);

    const after = await prisma.itemStock.findUniqueOrThrow({
      where: { itemId_outletId: { itemId: itemA, outletId } },
    });
    // Exactly 9 back off, not 18.
    expect(Number(before.qtyOnHand) - Number(after.qtyOnHand)).toBeCloseTo(9, 3);

    const reversals = await prisma.stockTransaction.count({
      where: { sourceType: 'PURCHASE_VOID', sourceId: id },
    });
    expect(reversals).toBe(1);
  });

  test('two purchases cannot both fulfil one approved request', async () => {
    const request = await api(
      'POST',
      '/purchase-requests',
      { outletId, lines: [{ itemId: itemA, quantity: 4 }] },
      askerToken,
    );
    const requestId = request.body?.['id'] as string;
    await api('POST', `/purchase-requests/${requestId}/approve`, {});

    const body = {
      outletId,
      vendorId,
      requestId,
      purchaseDate: toBusinessDate(),
      lines: [{ itemId: itemA, quantity: 4, unitPrice: 50 }],
    };
    const results = await Promise.all([
      api('POST', '/purchases', body),
      api('POST', '/purchases', body),
    ]);
    const ok = results.filter((r) => r.status === 201);
    // One receives the stock. The other is told the request is spoken for.
    expect(ok.length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(1);
  });
});
