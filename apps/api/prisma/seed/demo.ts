import * as argon2 from 'argon2';
import { Prisma, type PrismaClient, type RoleKey, type StockTxnType } from '@prisma/client';
import { businessDateOffset } from '@bobs-momo/shared';

const DEMO_PASSWORD = 'ChangeMe123!';

const STAFF: ReadonlyArray<{
  username: string;
  role: RoleKey;
  fullName: string;
  outlet: string;
  department: string;
  designation: string;
  phone: string;
}> = [
  { username: 'ops.manager', role: 'OPERATIONS_MANAGER', fullName: 'Rashmi Panda', outlet: 'BM-SAHEED', department: 'Admin', designation: 'Operations Manager', phone: '9937100001' },
  { username: 'store.saheed', role: 'STORE_MANAGER', fullName: 'Sanjay Behera', outlet: 'BM-SAHEED', department: 'Admin', designation: 'Store Manager', phone: '9937100002' },
  { username: 'store.patia', role: 'STORE_MANAGER', fullName: 'Priya Mohanty', outlet: 'BM-PATIA', department: 'Admin', designation: 'Store Manager', phone: '9937100003' },
  { username: 'kitchen.saheed', role: 'KITCHEN_MANAGER', fullName: 'Tenzin Norbu', outlet: 'BM-SAHEED', department: 'Kitchen', designation: 'Head Chef', phone: '9937100004' },
  { username: 'kitchen.patia', role: 'KITCHEN_MANAGER', fullName: 'Bikash Sahoo', outlet: 'BM-PATIA', department: 'Kitchen', designation: 'Head Chef', phone: '9937100005' },
  { username: 'inventory', role: 'INVENTORY_MANAGER', fullName: 'Alok Jena', outlet: 'BM-SAHEED', department: 'Store', designation: 'Inventory Manager', phone: '9937100006' },
  { username: 'purchase', role: 'PURCHASE_MANAGER', fullName: 'Manas Nayak', outlet: 'BM-SAHEED', department: 'Store', designation: 'Purchase Manager', phone: '9937100007' },
  { username: 'hr', role: 'HR_ACCOUNTS', fullName: 'Sujata Das', outlet: 'BM-SAHEED', department: 'Admin', designation: 'HR and Accounts', phone: '9937100008' },
  { username: 'chef.saheed', role: 'KITCHEN_STAFF', fullName: 'Ramesh Barik', outlet: 'BM-SAHEED', department: 'Kitchen', designation: 'Momo Chef', phone: '9937100009' },
  { username: 'chef.patia', role: 'KITCHEN_STAFF', fullName: 'Lipsa Rout', outlet: 'BM-PATIA', department: 'Kitchen', designation: 'Momo Chef', phone: '9937100010' },
  { username: 'counter.saheed', role: 'COUNTER_CASHIER', fullName: 'Debashish Sahu', outlet: 'BM-SAHEED', department: 'Counter', designation: 'Counter Cashier', phone: '9937100011' },
  { username: 'counter.patia', role: 'COUNTER_CASHIER', fullName: 'Ananya Pati', outlet: 'BM-PATIA', department: 'Counter', designation: 'Counter Cashier', phone: '9937100012' },
];

const VENDORS = [
  { name: 'Saheed Nagar Poultry', phone: '9438200001', gstin: '21ABCDE1234F1Z5' },
  { name: 'Jagannath Vegetables', phone: '9438200002', gstin: '21BCDEF2345G1Z4' },
  { name: 'Utkal Provision Stores', phone: '9438200003', gstin: '21CDEFG3456H1Z3' },
];

// Reorder levels for the items that actually run out. Open question 6 in
// chapter 42: the client supplies the real numbers in week 1.
const REORDER: Record<string, number> = {
  'ITM-CHICKEN-MINCE': 8, 'ITM-CHICKEN-BONELESS': 5, 'ITM-MUTTON-MINCE': 3,
  'ITM-CABBAGE': 10, 'ITM-ONION': 12, 'ITM-GARLIC': 3, 'ITM-GINGER': 3,
  'ITM-MAIDA': 15, 'ITM-REFINED-OIL': 10, 'ITM-SOY-SAUCE': 4,
  'ITM-BOX-MOMO-6': 200, 'ITM-BOX-MOMO-10': 200, 'ITM-CHUTNEY-CUP': 300,
  'ITM-CARRY-BAG': 250, 'ITM-EGG': 60, 'ITM-NOODLE-THUKPA': 20,
};

// Deterministic pseudo-random so two seed runs produce the same history and a
// screenshot from Tuesday still matches the database on Thursday.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const d3 = (n: number): Prisma.Decimal => new Prisma.Decimal(n.toFixed(3));

export async function seedDemo(prisma: PrismaClient): Promise<string[]> {
  const outlets = new Map((await prisma.outlet.findMany()).map((o) => [o.code, o]));
  const created: string[] = [];
  const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  let seq = 1;
  for (const s of STAFF) {
    const outlet = outlets.get(s.outlet);
    if (!outlet) throw new Error(`demo seed: unknown outlet ${s.outlet}`);
    const department = await prisma.department.findUnique({
      where: { outletId_name: { outletId: outlet.id, name: s.department } },
    });

    const user = await prisma.user.upsert({
      where: { username: s.username },
      update: { roleKey: s.role },
      create: { username: s.username, passwordHash: hash, roleKey: s.role, mustReset: true },
    });
    // OWNER and OPERATIONS_MANAGER get all outlets computed at login.
    if (s.role !== 'OPERATIONS_MANAGER') {
      await prisma.userOutlet.upsert({
        where: { userId_outletId: { userId: user.id, outletId: outlet.id } },
        update: {},
        create: { userId: user.id, outletId: outlet.id },
      });
    }

    const employeeCode = `BM-EMP-${String(seq++).padStart(4, '0')}`;
    await prisma.employee.upsert({
      where: { employeeCode },
      update: { fullName: s.fullName, outletId: outlet.id, departmentId: department?.id ?? null },
      create: {
        employeeCode,
        userId: user.id,
        fullName: s.fullName,
        phone: s.phone,
        outletId: outlet.id,
        departmentId: department?.id ?? null,
        designation: s.designation,
        joinedOn: businessDateOffset(-365),
      },
    });
    created.push(s.username);
  }

  for (const v of VENDORS) {
    await prisma.vendor.upsert({ where: { name: v.name }, update: {}, create: v });
  }

  const items = await prisma.inventoryItem.findMany({ where: { isActive: true } });
  const seedUser = await prisma.user.findFirstOrThrow({ where: { roleKey: 'OWNER' } });

  // 30 trading days of movement so reports and dashboards have something to
  // draw. Wiped and rebuilt on every demo seed run, which keeps it idempotent.
  await prisma.stockTransaction.deleteMany({ where: { sourceType: 'SEED' } });

  for (const outlet of outlets.values()) {
    const rand = lcg(outlet.code.length * 7919 + outlet.code.charCodeAt(3));
    for (const item of items) {
      let balance = 20 + Math.floor(rand() * 60);
      const rows: Prisma.StockTransactionCreateManyInput[] = [
        {
          itemId: item.id, outletId: outlet.id, type: 'OPENING',
          quantity: d3(balance), signedQty: d3(balance), balanceAfter: d3(balance),
          businessDate: businessDateOffset(-30), sourceType: 'SEED',
          createdById: seedUser.id, createdAt: businessDateOffset(-30),
        },
      ];

      for (let day = 29; day >= 0; day--) {
        const date = businessDateOffset(-day);
        const push = (type: StockTxnType, qty: number, reason?: string): void => {
          const sign = type === 'RECEIVED' ? 1 : -1;
          balance += sign * qty;
          rows.push({
            itemId: item.id, outletId: outlet.id, type,
            quantity: d3(qty), signedQty: d3(sign * qty), balanceAfter: d3(balance),
            businessDate: date, reason, sourceType: 'SEED',
            createdById: seedUser.id, createdAt: date,
          });
        };

        const used = Number((1 + rand() * 6).toFixed(3));
        if (balance - used > 0) push('ISSUED', used);
        if (item.isPerishable && rand() < 0.15) {
          const wasted = Number((0.2 + rand() * 0.8).toFixed(3));
          if (balance - wasted > 0) push('WASTAGE', wasted, 'Spoilage found at opening count');
        }
        if (balance < 15 && rand() < 0.6) push('RECEIVED', Math.ceil(20 + rand() * 30));
      }

      await prisma.stockTransaction.createMany({ data: rows });
      await prisma.itemStock.upsert({
        where: { itemId_outletId: { itemId: item.id, outletId: outlet.id } },
        update: { qtyOnHand: d3(balance), reorderLevel: REORDER[item.sku] ?? null },
        create: {
          itemId: item.id, outletId: outlet.id,
          qtyOnHand: d3(balance),
          reorderLevel: REORDER[item.sku] ?? null,
        },
      });
    }
  }

  return created;
}
