# Testing strategy

Bob's Momo currently runs on paper. A kitchen manager writes "chicken mince 8
kg" in a register and everyone believes it, because the register is what they
have always believed. We are asking them to believe a screen instead.

That trade only works while the screen is right. If a stock balance shows 2.4 kg
when the fridge holds 6 kg, or a purchase total prints Rs 4,180 when the vendor
bill says Rs 4,810, the staff will do exactly what any sensible person does:
they will go back to the register, keep the paper in parallel, and the project
will have failed while still technically running. Nobody will file a bug. They
will just stop trusting it.

So the test suite is not a quality ritual here. It is the thing that keeps the
numbers right long enough for the habit to form. Test the money and the stock
paths as if there is no undo, because for a small business there mostly is not.

## The pyramid, with counts

The shape below is the target at the end of the three week build. The counts are
what the module chapters actually specify, not aspirations.

```text
                        ┌──────────────────────┐
                        │  6 browser journeys  │   Playwright
                        │  ~4 min wall clock   │   real Chromium
                        └──────────────────────┘
                   ┌────────────────────────────────┐
                   │   ~90 e2e API tests            │  supertest
                   │   ~70 s against test Postgres  │  seeded DB
                   └────────────────────────────────┘
              ┌──────────────────────────────────────────┐
              │   ~70 integration tests                  │ repositories
              │   transactions, constraints, outbox      │ real Postgres
              └──────────────────────────────────────────┘
        ┌────────────────────────────────────────────────────────┐
        │   ~55 component tests (Testing Library + MSW)          │
        │   ~230 unit tests (services, guards, pure helpers)     │
        │   under 15 s total, no I/O                             │
        └────────────────────────────────────────────────────────┘
```

Unit tests cover service methods with the repository mocked, plus the pure
helpers that carry real logic: the business date resolver from
[chapter 12](12-data-scoping-and-integrity.md), the signed quantity rules from
[chapter 16](16-inventory.md), the purchase total arithmetic, the permission
resolver from [chapter 14](14-rbac-and-permissions.md), and the cron to next-run helper. These
run on `bun test` with no database and no network. If a unit test needs a
container to start, it is not a unit test.

Integration tests hit a real PostgreSQL 15. They exist because the interesting
failures in this system are transactional: does the outbox row disappear when
the business write rolls back, does the unique index on `(itemId, outletId)`
actually fire, does `SELECT ... FOR UPDATE` serialise two concurrent issues of
the same item. A mock cannot answer any of those.

End to end API tests drive the HTTP surface through supertest against a booted
Nest application and a seeded test database. They are where the request
envelope, the guards, the zod pipe, the error codes from
[chapter 15](15-api-conventions.md) and the response shape get checked together.

Component tests use Testing Library with MSW intercepting fetch. They cover the
forms that a wrong keystroke makes expensive: the stock transaction form, the
purchase line editor, the sales entry form, the leave request form.

Browser tests are six Playwright journeys and no more. They are slow, they flake
under load, and each one costs maintenance for the whole life of the project. Six
is the number of flows where a break would stop the business.

## Coverage targets

| Scope | Statement floor | Enforced by |
|---|---|---|
| `apps/api` overall | 80 percent | `vitest --coverage` threshold in CI |
| `modules/inventory` | 100 percent | per-directory threshold |
| `modules/purchase` | 100 percent | per-directory threshold |
| `modules/sales` | 100 percent | per-directory threshold |
| `common/outbox` | 100 percent | per-directory threshold |
| `apps/web` | no numeric floor | reviewed by hand |

A single blanket number is easy to game and tells you nothing about risk. Eighty
percent across the API can be reached while leaving `voidPurchase()` untested,
because there is a lot of cheap controller and DTO surface to inflate the
denominator. A per-module floor puts the demand where the risk is: anything that
moves stock, moves money, or emits an event that will move either has to be
covered completely, and everything else has to be covered well enough.

The 100 percent floors are branch coverage as well as statements on those four
directories. That is deliberate. `if (newBalance.lt(0))` having its false branch
covered and its true branch untested is precisely the gap that ships negative
stock to production.

## The test database

Every test worker gets its own Postgres schema in one database. Migrations run
once for the whole suite, not once per worker, and definitely not once per test.

```ts
// apps/api/test/setup/db.ts
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const workerId = process.env.VITEST_WORKER_ID ?? '1';
const schema = `test_w${workerId}`;
const baseUrl = process.env.TEST_DATABASE_URL!;   // see chapter 09

export const databaseUrl = `${baseUrl}?schema=${schema}`;

export const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

// Runs once per worker, before any test file in that worker.
export async function migrateSchema(): Promise<void> {
  execSync('bunx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

// Cached after the first call. Ordering does not matter because CASCADE
// follows the foreign keys for us.
let truncateSql: string | null = null;

export async function resetSchema(): Promise<void> {
  if (truncateSql === null) {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = ${schema}
        AND tablename NOT IN ('_prisma_migrations')
    `;
    const list = rows
      .map((r) => `"${schema}"."${r.tablename}"`)
      .join(', ');
    truncateSql = `TRUNCATE ${list} RESTART IDENTITY CASCADE`;
  }
  await prisma.$executeRawUnsafe(truncateSql);
  await seedReferenceData(prisma);   // units and categories only
}
```

Wire it up per worker and per test:

```ts
// apps/api/test/setup/global.ts
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { migrateSchema, resetSchema, prisma } from './db';

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await migrateSchema();
});

beforeEach(async () => {
  await resetSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

The reason for truncate rather than drop and recreate is time. On this schema,
`prisma migrate deploy` takes roughly 4 to 6 seconds against a local Postgres.
A single `TRUNCATE ... RESTART IDENTITY CASCADE` across the 40-odd tables takes
under 20 milliseconds. With around 160 database-touching tests, recreating the
schema each time would add close to fifteen minutes to every CI run and nobody
would run the suite locally. Truncating adds about three seconds in total.

`RESTART IDENTITY` matters less than it would elsewhere, because every primary
key in this schema is a UUID default. It is there for the sequences behind
`requestNo` and `purchaseNo` generation, so `PR-2026-0001` is the first request
in every test rather than whatever number the previous file left behind.

Reference data is the one exception to the clean slate. `Unit` and `ItemCategory`
rows are inserted by `seedReferenceData` after every truncate, because they are
closed enumerations in practice (KG, G, L, ML, PCS, PKT) and forcing every test
to create a unit before it can create an item is noise with no return.

## Fixtures and factories

One factory per aggregate, each with defaults that produce a valid row and an
overrides argument for the field the test actually cares about. Factories write
to the database and return the created row. They are not builders and they do not
return unsaved objects.

```ts
// apps/api/test/factories/item.factory.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../setup/db';

let seq = 0;

export async function makeItem(overrides: {
  outletId: string;
  sku?: string;
  name?: string;
  qtyOnHand?: Prisma.Decimal | string;
  reorderLevel?: Prisma.Decimal | string | null;
  isPerishable?: boolean;
}) {
  seq += 1;
  const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'KG' } });
  const category = await prisma.itemCategory.findFirstOrThrow({
    where: { name: 'Vegetables' },
  });

  const item = await prisma.inventoryItem.create({
    data: {
      sku: overrides.sku ?? `ITM-TEST-${seq}`,
      name: overrides.name ?? `Test item ${seq}`,
      categoryId: category.id,
      unitId: unit.id,
      isPerishable: overrides.isPerishable ?? false,
    },
  });

  const stock = await prisma.itemStock.create({
    data: {
      itemId: item.id,
      outletId: overrides.outletId,
      qtyOnHand: overrides.qtyOnHand ?? '0',
      reorderLevel: overrides.reorderLevel ?? null,
    },
  });

  return { item, stock };
}
```

```ts
// apps/api/test/factories/user.factory.ts
import { RoleKey } from '@prisma/client';
import { hash } from 'argon2';
import { prisma } from '../setup/db';

let seq = 0;

export async function makeUser(overrides: {
  roleKey: RoleKey;
  outletIds?: string[];
  mustReset?: boolean;
  status?: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  password?: string;
}) {
  seq += 1;
  const password = overrides.password ?? 'Test-Passw0rd!';

  const user = await prisma.user.create({
    data: {
      username: `test_user_${seq}`,
      email: `test_user_${seq}@example.test`,
      passwordHash: await hash(password),
      roleKey: overrides.roleKey,
      mustReset: overrides.mustReset ?? false,
      status: overrides.status ?? 'ACTIVE',
      outlets: {
        create: (overrides.outletIds ?? []).map((outletId) => ({ outletId })),
      },
    },
  });

  return { user, password };
}
```

The rule is that a test never reads a row it did not create, with the single
exception of `Unit` and `ItemCategory`. No test asserts on the demo outlet from
`seed.ts`, no test assumes `BM-SAHEED` exists, no test counts rows globally
without an outlet filter. When a test needs two outlets it calls `makeOutlet()`
twice. This keeps the suite parallel-safe and keeps the production seed free to
change without breaking sixty tests.

## The test catalogue

This is the required list. A ticket in one of these modules is not done until the
tests named here exist and pass. Regression-critical tests are the ones that must
never be deleted or skipped to make a build green; a failure there blocks the
merge and the conversation is about the code, not the test.

### Auth and session

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `login returns access and refresh on valid credentials` | e2e | 200, body has `accessToken`, refresh cookie set with `HttpOnly`, `Secure`, `SameSite=Lax` | yes |
| `login rejects wrong password without revealing which field failed` | e2e | 401, `code: INVALID_CREDENTIALS`, identical message for unknown username | yes |
| `login increments failedLogins and locks after 5` | integration | 6th attempt returns 423, `lockedUntil` set 15 min ahead | yes |
| `locked account rejects even a correct password` | integration | 423 while `lockedUntil` is in the future | yes |
| `successful login resets failedLogins to 0` | integration | counter zeroed, `lastLoginAt` updated | no |
| `refresh rotates the token and revokes the old one` | integration | old `tokenHash` has `revokedAt`, new row shares `familyId` | yes |
| `reusing a revoked refresh token kills the whole family` | integration | every row with that `familyId` gets `revokedAt`, response 401 | yes |
| `expired refresh token is rejected` | integration | 401, no new token issued | yes |
| `mustReset user gets 403 on every endpoint except password change` | e2e | `code: PASSWORD_RESET_REQUIRED` on `/inventory/items`, 200 on `/auth/password` | yes |
| `argon2id verify is used, not a plain comparison` | unit | hash string starts `$argon2id$` | yes |
| `logout revokes the presented refresh token only` | integration | sibling sessions still valid | no |

### RBAC and outlet scope

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `route permission matrix` (table-driven, see below) | e2e | every route by every role returns the documented status | yes |
| `every controller method carries a @Permissions decorator` | unit | reflection sweep over the route table, zero undecorated handlers | yes |
| `OWN_OUTLET user gets 404 for another outlet's item stock` | e2e | 404, not 403, body has no outlet name | yes |
| `ALL_OUTLETS user reads both outlets` | e2e | 200, `meta.total` covers both | no |
| `SELF scope lets kitchen staff read own attendance only` | e2e | own `employeeId` 200, colleague 404 | yes |
| `outletId query param outside scope is rejected` | e2e | 404 on `?outletId=<other>` | yes |
| `permission resolver caches per user and invalidates on role change` | integration | second call hits Redis, role update clears the key | no |

### Inventory

The money path. This list is deliberately exhaustive.

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `RECEIVED increases qtyOnHand by quantity` | integration | balance moves +q, `signedQty` positive | yes |
| `ISSUED decreases qtyOnHand by quantity` | integration | balance moves -q, `signedQty` negative | yes |
| `WASTAGE decreases and requires a reason` | e2e | missing reason returns 400 `VALIDATION_FAILED`; with reason, 201 and balance falls | yes |
| `ADJUSTMENT accepts positive and negative signedQty` | integration | both directions land, reason required on both | yes |
| `CLOSING writes signedQty zero and does not move the balance` | integration | `balanceAfter` equals `qtyOnHand` before and after | yes |
| `OPENING on a fresh item sets the balance from zero` | integration | first row `balanceAfter` equals quantity | yes |
| `balanceAfter on every row equals the running sum of signedQty` | integration | walk the ledger, compare to `ItemStock.qtyOnHand` | yes |
| `stock balance invariant after a random sequence` | property | see the fast-check section below | yes |
| `negative stock guard rejects an over-issue` | e2e | 422 `INSUFFICIENT_STOCK`, message names the on-hand quantity, no ledger row written | yes |
| `negative stock guard rejects an over-transfer` | e2e | 422, neither TRANSFER_OUT nor TRANSFER_IN written | yes |
| `ADJUSTMENT may not drive the balance below zero either` | integration | 422, balance unchanged | yes |
| `crossing reorderLevel emits one LOW_STOCK outbox event` | integration | exactly one `OutboxEvent` with `eventKey: LOW_STOCK` | yes |
| `low stock cooldown suppresses a second alert inside the window` | integration | second issue in the same 6 hours writes no event, `lastAlertAt` unchanged | yes |
| `low stock alert fires again after the cooldown expires` | integration | `lastAlertAt` backdated 7 hours, event emitted | yes |
| `null reorderLevel never alerts` | integration | balance goes to 0, zero events | yes |
| `restocking above reorderLevel clears lastAlertAt` | integration | `lastAlertAt` null after RECEIVED lifts balance | no |
| `transfer writes a paired OUT and IN sharing transferPairId` | integration | two rows, same `transferPairId`, opposite signs, different `outletId` | yes |
| `transfer is atomic: a failing IN rolls back the OUT` | integration | force a constraint error on the destination, assert zero rows | yes |
| `transfer to the same outlet is rejected` | e2e | 422 `INVALID_TRANSFER` | no |
| `concurrent issues on one item do not oversell` | integration | two parallel transactions issuing 3 of 5, one succeeds, one gets 422, final balance 2 | yes |
| `concurrent receives both land and the balance is the sum` | integration | 10 parallel receives of 1.000, final balance 10.000 | yes |
| `idempotent replay returns the first response and writes nothing` | e2e | same `Idempotency-Key` twice, identical body, one ledger row | yes |
| `different Idempotency-Key writes a second row` | e2e | two rows, two distinct ids | no |
| `quantity of zero is rejected` | unit | 400, `quantity` must be greater than 0 | no |
| `quantity with 4 decimal places is rejected` | unit | 400, scale limited to 3 | no |
| `businessDate resolves via the 04:00 IST rule` | unit | 00:30 IST on the 12th records against the 11th | yes |
| `stock history filters by item, outlet and date range` | e2e | rows outside the range absent, ordering newest first | no |
| `consumption report sums ISSUED and WASTAGE only` | integration | RECEIVED and TRANSFER rows excluded from the total | yes |
| `reorderLevel change writes an AuditLog with before and after` | integration | one audit row, both snapshots present | yes |
| `stock transaction form blocks submit while the request is in flight` | component | second click does not fire a second fetch | yes |

### Purchase and vendor

The other money path.

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `purchase totals are computed server-side` | e2e | client posts `subtotal: 1`, response and row carry the recomputed value | yes |
| `lineTotal equals quantity times unitPrice at 2 decimal places` | unit | 3.333 x 120.00 rounds to 399.96, half-up | yes |
| `subtotal equals the sum of lineTotals` | unit | no floating point drift over 12 lines | yes |
| `totalAmount equals subtotal plus taxAmount` | unit | exact decimal equality | yes |
| `recording a purchase writes one RECEIVED row per line` | integration | line count equals ledger row count, `sourceType: PURCHASE`, `sourceId` set | yes |
| `recording a purchase updates every affected ItemStock` | integration | each balance rises by its line quantity | yes |
| `recording a purchase upserts ItemPriceHistory per line` | integration | one row per item and vendor and date, `unitPrice` matches | yes |
| `all six writes happen in one transaction` | integration | force a failure on the price history insert, assert no purchase, no items, no ledger rows, no outbox row | yes |
| `outbox rollback: business failure leaves no event` | integration | failing transaction produces zero `OutboxEvent` rows | yes |
| `outbox commit: success leaves exactly one PURCHASE_RECORDED event` | integration | one row, `status: PENDING` | yes |
| `voiding a purchase writes compensating ADJUSTMENT rows` | integration | one negative row per original line, `sourceId` points at the purchase, originals untouched | yes |
| `voiding sets status VOIDED with voidedAt and voidReason` | integration | fields set, `totalAmount` unchanged | yes |
| `voiding twice is rejected` | e2e | second call 409 `INVALID_STATE_TRANSITION` | yes |
| `voiding is refused if it would drive stock negative` | integration | 422, purchase stays RECORDED, no compensating rows | yes |
| `void does not delete ItemPriceHistory` | integration | price rows survive, chart history intact | no |
| `purchaseNo is unique under concurrency` | integration | 20 parallel records produce 20 distinct numbers | yes |
| `idempotent replay of POST /purchases` | e2e | same key twice, one purchase, identical response | yes |
| `purchase request approve notifies the requester` | integration | one `PURCHASE_DECIDED` outbox event | no |
| `purchase request reject requires a decisionNote` | e2e | 400 without it | no |
| `approving an already-decided request is rejected` | e2e | 409 | yes |
| `fulfilling a request from a purchase sets status FULFILLED` | integration | `requestId` linked, status moved | no |
| `price history endpoint returns points ordered by observedOn` | e2e | ascending, one point per vendor per date | no |
| `purchase line editor recomputes the displayed total on quantity change` | component | rendered total matches the server formula | yes |

### Workforce: attendance, shifts, leave, salary

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `punch IN creates an AttendanceDay when none exists` | integration | one day row, `firstInAt` set, status PRESENT | yes |
| `punch OUT sets lastOutAt and recomputes workedMins` | integration | minutes match the punch pair, breaks deducted | yes |
| `double punch IN without an OUT is rejected` | e2e | 409 `PUNCH_OUT_OF_ORDER` | yes |
| `punch is idempotent under the Idempotency-Key header` | e2e | one punch row after two identical posts | yes |
| `punch at 00:30 IST belongs to the previous business date` | unit | `businessDate` is the prior day | yes |
| `manager punch edit records editedById and editReason` | integration | source `MANAGER_EDIT`, both fields set, AuditLog written | yes |
| `punch edit without a reason is rejected` | e2e | 400 | yes |
| `break start then end computes durationMins` | integration | duration matches, `breakMins` on the day updated | no |
| `overlapping break is rejected` | e2e | 409 | no |
| `attendance rollup is safe to re-run` | integration | run the job twice for the same date, all fields identical, no duplicate rows | yes |
| `attendance rollup marks a scheduled employee with no punches ABSENT` | integration | status ABSENT, `workedMins` 0 | yes |
| `rollup does not overwrite an ON_LEAVE day` | integration | approved leave day keeps ON_LEAVE after the job runs | yes |
| `leave approval writes ON_LEAVE attendance rows for every day in range` | integration | 3-day leave produces 3 `AttendanceDay` rows with ON_LEAVE | yes |
| `leave approval is idempotent against existing attendance rows` | integration | pre-existing PRESENT day is updated, not duplicated | yes |
| `leave rejection writes no attendance rows` | integration | zero rows created | yes |
| `leave decision by a manager of another outlet is refused` | e2e | 404 | yes |
| `dayCount is computed server-side from the date range` | unit | client-supplied value ignored, half days honoured | yes |
| `leave request overlapping an approved leave is rejected` | e2e | 409 `OVERLAPPING_LEAVE` | no |
| `salary read requires workforce.salary.read` | e2e | 403 for STORE_MANAGER, 200 for HR_ACCOUNTS | yes |
| `salary read writes an AuditLog row` | integration | action `workforce.salary.read`, no amounts in the log message | yes |
| `new salary record closes the previous effectiveTo` | integration | prior row gets `effectiveTo` one day before the new `effectiveFrom` | yes |
| `shift roster rejects a duplicate employee, date and start` | integration | unique constraint returns 409 | no |

### Tasks, checklists and audits

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `creating a task with an assignee emits TASK_ASSIGNED` | integration | one outbox event | no |
| `overdue sweep flags tasks past dueAt` | integration | status OVERDUE, `overdueNotifiedAt` set | yes |
| `overdue sweep notifies once only` | integration | run twice, exactly one `TASK_OVERDUE` event | yes |
| `overdue sweep ignores COMPLETED and VERIFIED tasks` | integration | zero events for those rows | yes |
| `recurring task generation is idempotent for a given slot` | integration | run the cron twice for 07:00 on the same date, one task | yes |
| `recurring generation respects lastRunAt after a restart` | integration | job replay does not backfill duplicates | yes |
| `recurrence cron is evaluated in Asia/Kolkata` | unit | `0 7 * * *` fires at 01:30 UTC | yes |
| `checklist run creates one result slot per template item` | integration | count matches template | no |
| `a FAIL item with failCreatesTask spawns a child task` | integration | child has `parentTaskId`, `AUDIT_ITEM_FAILED` event emitted | yes |
| `a PASS item creates no child task` | integration | zero children | no |
| `requiresPhoto item without an attachment cannot be submitted` | e2e | 400 | no |
| `verification is refused when requiresVerification is false` | e2e | 409 | no |
| `verifying a task writes AuditLog and sets verifiedById` | integration | both present | no |
| `task attachment upload rejects a non-image mime type` | e2e | 400 `UNSUPPORTED_MEDIA_TYPE` | yes |

### Notifications and outbox

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `dispatcher claims a PENDING row and marks it PROCESSING` | integration | status transition visible to a second worker | yes |
| `two dispatchers do not process the same event twice` | integration | `SKIP LOCKED` claim, one delivery | yes |
| `a failed delivery increments attempts and backs off availableAt` | integration | attempt 2 available later than attempt 1 | yes |
| `an event moves to DEAD after 5 attempts` | integration | status DEAD, `lastError` populated | yes |
| `a DEAD event is never retried by the cron` | integration | further runs skip it | yes |
| `notification preference off suppresses that channel` | integration | `NotificationStatus.SUPPRESSED`, no WhatsApp call | yes |
| `WhatsApp adapter failure does not lose the in-app notification` | integration | IN_APP SENT, WHATSAPP FAILED, both rows present | yes |
| `WhatsApp payload contains no access token in the logged line` | unit | redaction helper strips it | yes |
| `SALES_ENTRY_MISSING fires once per outlet per day` | integration | second run of the 23:30 job emits nothing | yes |

### Sales and analytics

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `netSales equals grossSales minus discounts` | unit | server recomputes, client value ignored | yes |
| `payment split must equal netSales` | e2e | mismatch returns 422 `PAYMENT_SPLIT_MISMATCH` | yes |
| `one sales entry per outlet per business date` | integration | second insert returns 409 | yes |
| `an entry older than 48 hours is locked against edits` | e2e | 409 `SALES_ENTRY_LOCKED` | yes |
| `unlocking a locked entry requires the unlock permission and writes AuditLog` | e2e | 403 for STORE_MANAGER, 200 plus audit row for OWNER | yes |
| `dashboard totals match the sum of the underlying rows` | integration | compare endpoint output against a direct SQL sum | yes |
| `dashboard respects outlet scope` | e2e | OWN_OUTLET user sees one outlet's numbers only | yes |
| `dashboard cache returns within 400ms p95 on a warm key` | integration | timed assertion against the Redis-backed path | no |
| `waste analysis counts WASTAGE rows only` | integration | ADJUSTMENT rows excluded | yes |
| `empty date range renders an empty state, not a crash` | component | no thrown error, empty message shown | no |

### CRM and game layer

| Test | Type | Assertion | Regression-critical |
|---|---|---|---|
| `unpublished game config is not served on the public endpoint` | e2e | 404 | yes |
| `publishing a config bumps version and writes AuditLog` | integration | version + 1, `publishedAt` set, audit row present | yes |
| `guest play earns zero coins` | integration | `coinsEarned` 0, no `Customer` row created | yes |
| `identified play credits coins once` | integration | balance rises by the rule amount, replay of the same `sessionKey` inside the cooldown rejected | yes |
| `reward redemption debits coins and marks the coupon REDEEMED` | integration | balance falls by `coinCost`, status changed, `redeemedAt` set | yes |
| `redeeming an already-redeemed coupon is rejected` | e2e | 409, balance unchanged | yes |
| `redeeming with insufficient coins is rejected` | e2e | 422, no `RewardIssue` row | yes |
| `public game endpoints are rate limited per IP` | e2e | 429 after the configured burst | yes |
| `coupon codes are unpredictable` | unit | 128 bits of entropy, no sequential pattern across 1000 draws | yes |

### The six browser journeys

| Journey | Covers |
|---|---|
| Login, forced password reset, land on dashboard | auth, `mustReset`, role-based nav |
| Record opening stock, issue stock, see the balance change | the inventory core loop |
| Raise a purchase request, approve it, record the purchase, confirm stock rose | the full purchase to inventory chain |
| Complete the kitchen opening checklist with one FAIL and a photo | task engine, upload, follow-up task |
| Request leave, approve it as a manager, see ON_LEAVE on the roster | leave workflow across two roles |
| Enter daily sales, see the figure on the owner dashboard | sales entry to analytics |

## Property-based testing the stock ledger

The stock balance invariant is the rule most likely to break in a way example
tests never catch, because the failure needs a specific sequence of transaction
types nobody thought to write down. Generate the sequences instead.

```ts
// apps/api/src/modules/inventory/inventory.invariant.spec.ts
import fc from 'fast-check';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../test/setup/db';
import { makeOutlet } from '../../../test/factories/outlet.factory';
import { makeItem } from '../../../test/factories/item.factory';
import { makeUser } from '../../../test/factories/user.factory';
import { InventoryService } from './inventory.service';

const txnArb = fc.record({
  type: fc.constantFrom(
    'RECEIVED', 'ISSUED', 'WASTAGE', 'ADJUSTMENT', 'CLOSING',
  ),
  quantity: fc.integer({ min: 1, max: 5000 }).map((n) =>
    new Prisma.Decimal(n).div(1000),        // 0.001 to 5.000, 3 dp
  ),
  sign: fc.constantFrom(1, -1),             // only read for ADJUSTMENT
});

it('balance always equals the ledger sum and never goes negative',
   async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(txnArb, { minLength: 1, maxLength: 40 }),
      async (ops) => {
        const outlet = await makeOutlet();
        const { user } = await makeUser({ roleKey: 'INVENTORY_MANAGER',
                                          outletIds: [outlet.id] });
        const { item } = await makeItem({ outletId: outlet.id,
                                          qtyOnHand: '100.000' });

        for (const op of ops) {
          try {
            await service.recordTransaction(
              { itemId: item.id, outletId: outlet.id, type: op.type,
                quantity: op.quantity, signHint: op.sign,
                reason: 'property test' },
              user,
            );
          } catch (e) {
            // INSUFFICIENT_STOCK is a legal outcome, not a failure.
            if (e.code !== 'INSUFFICIENT_STOCK') throw e;
          }
        }

        const rows = await prisma.stockTransaction.findMany({
          where: { itemId: item.id, outletId: outlet.id },
          orderBy: { createdAt: 'asc' },
        });
        const stock = await prisma.itemStock.findFirstOrThrow({
          where: { itemId: item.id, outletId: outlet.id },
        });

        const sum = rows.reduce(
          (acc, r) => acc.add(r.signedQty), new Prisma.Decimal(0),
        );

        // 1. balance equals the ledger sum
        expect(stock.qtyOnHand.equals(sum)).toBe(true);
        // 2. balanceAfter on the last row equals the balance
        expect(rows.at(-1)!.balanceAfter.equals(stock.qtyOnHand)).toBe(true);
        // 3. no row ever left the balance negative
        for (const r of rows) {
          expect(r.balanceAfter.gte(0)).toBe(true);
        }
      },
    ),
    { numRuns: 60 },
  );
}, 120_000);
```

Sixty runs of up to forty operations is around 1,500 recorded transactions and
takes roughly 40 seconds against a local Postgres. That is affordable once per CI
run. When fast-check finds a counterexample it shrinks it to the smallest failing
sequence, which is usually three or four operations and reads like a hand-written
regression test. Copy that shrunk sequence into a normal example test and keep it
forever.

## RBAC test automation

Permissions rot silently. Someone adds `PATCH /inventory/items/:id/reorder-level`
in a hurry, forgets `@Permissions('inventory.item.update')`, and the guard defaults
to allowing any authenticated user. Nothing fails. The endpoint ships.

The fix is a single table-driven test that enumerates every route and every role,
and a route table that is generated from the application rather than hand-written.

```ts
// apps/api/test/rbac/route-matrix.e2e-spec.ts
import { RoleKey } from '@prisma/client';
import request from 'supertest';
import { app, tokenFor } from '../setup/app';
import { ROUTES } from './route-table';

const ROLES: RoleKey[] = [
  'OWNER', 'OPERATIONS_MANAGER', 'STORE_MANAGER', 'KITCHEN_MANAGER',
  'INVENTORY_MANAGER', 'PURCHASE_MANAGER', 'HR_ACCOUNTS',
  'KITCHEN_STAFF', 'COUNTER_CASHIER',
];

describe.each(ROUTES)('$method $path', (route) => {
  it.each(ROLES)('%s', async (role) => {
    const token = await tokenFor(role);
    const res = await request(app.getHttpServer())
      [route.method.toLowerCase()](route.samplePath)
      .set('Authorization', `Bearer ${token}`)
      .send(route.sampleBody ?? {});

    const allowed = route.allowedRoles.includes(role);
    if (allowed) {
      expect(res.status).not.toBe(403);
    } else {
      expect(res.status).toBe(403);
    }
  });
});

// Separate test: no route may exist without a declared permission.
it('every route declares a permission key', () => {
  const undecorated = discoverRoutes(app).filter((r) => !r.permission);
  expect(undecorated).toEqual([]);
});
```

`discoverRoutes` walks the Nest router and reads the `permissions` metadata from
each handler. `ROUTES` in `route-table.ts` is the checked-in expectation: path,
method, permission key and the roles from the [chapter 14](14-rbac-and-permissions.md) matrix. A
new endpoint fails two ways at once. If it has no decorator, the second test
fails with the route name printed. If it has a decorator but nobody added it to
`route-table.ts`, the discovery diff fails. Either way the author has to think
about who is allowed to call it, which is the whole point.

At nine roles and roughly seventy routes this generates around 630 assertions and
runs in about twelve seconds, because each role's token is created once and
cached for the file.

## What is deliberately not tested

Gaps that are choices, so nobody spends a Tuesday closing them by accident.

The WhatsApp Cloud API itself is never called in tests. The adapter is tested
against a stubbed HTTP client that returns Meta's documented success and error
shapes. Whether Meta's sandbox is up is not our test suite's business, and a live
call would cost money per test run.

Prisma is not tested. Whether `findMany` respects `where` is Prisma's problem.
Repository tests exist to check our SQL-shaped decisions (indexes used, `FOR
UPDATE` taken, cascade behaviour), not the ORM.

Framework wiring is not unit tested. There is no test that `AppModule` imports
`InventoryModule`. If it does not, ninety e2e tests fail at boot and the message
is clearer than any assertion would be.

The Next.js pages are not snapshot tested. Snapshots of markup churn on every
Tailwind class change and get regenerated without being read, so they detect
nothing while costing review time. Component tests assert behaviour instead.

Load and stress testing is out. Two outlets, 30 users, a few hundred writes a
day. A load test would tell us the system handles 100x the traffic it will ever
see. The relevant performance checks are the p95 assertions on the dashboard and
list endpoints, which are in the catalogue above.

Browser compatibility beyond Chromium is out. Playwright runs Chromium only. The
staff use Android phones and the managers use Chrome on Windows. Adding WebKit
triples the browser suite runtime to cover nobody.

Accessibility is checked by hand against the checklist in
[chapter 29](28-ui-system.md), not by an automated axe run in CI.
Automated checks catch about a third of real issues and the false positive rate
on shadcn components would train everyone to ignore the job.

## Coverage map

Generated at the end of week 3. Gaps are tracked, not hidden.

```text
CODE PATHS                                 USER FLOWS
[+] inventory/inventory.service.ts         [+] Record stock issue
  ├── recordTransaction()                    ├── [TESTED] happy path
  │   ├── [TESTED] happy + guards            ├── [TESTED] over-issue blocked
  │   ├── [TESTED] negative guard            ├── [TESTED] double submit
  │   ├── [TESTED] cooldown branch           └── [GAP] [->E2E] offline retry
  │   └── [TESTED] idempotent replay       [+] Transfer between outlets
  ├── transferStock()                        ├── [TESTED] paired rows
  │   ├── [TESTED] pair + rollback           └── [GAP] [->E2E] partial network
  │   └── [GAP] [->UNIT] same-outlet msg   [+] Record a purchase
  └── recomputeBalance()                      ├── [TESTED] totals server-side
      └── [TESTED] property-based            ├── [TESTED] stock received
[+] purchase/purchase.service.ts             └── [TESTED] void compensates
  ├── record()                             [+] Approve leave
  │   ├── [TESTED] 6-write transaction       ├── [TESTED] ON_LEAVE days
  │   ├── [TESTED] outbox rollback           └── [TESTED] cross-outlet 404
  │   └── [TESTED] purchaseNo race         [+] Kitchen opening checklist
  ├── void()                                 ├── [TESTED] FAIL spawns task
  │   ├── [TESTED] compensating rows         └── [GAP] [->E2E] photo timeout
  │   ├── [TESTED] double-void 409         [+] Daily sales entry
  │   └── [TESTED] negative refusal          ├── [TESTED] split must balance
  └── decideRequest()                        └── [TESTED] 48h lock
      └── [TESTED] status machine          [+] Owner dashboard
[+] common/outbox/outbox.service.ts          ├── [TESTED] totals match SQL
  ├── [TESTED] enqueue in tx                 └── [GAP] [->PERF] cold cache p95
  ├── [TESTED] SKIP LOCKED claim           [+] Game play and redeem
  ├── [TESTED] backoff + DEAD                ├── [TESTED] coins credited
  └── [GAP] [->INT] clock skew replay        └── [GAP] [->E2E] coupon race
[+] workforce/attendance.service.ts
  ├── [TESTED] punch ordering
  ├── [TESTED] rollup idempotent
  └── [GAP] [->UNIT] DST-free tz assert
[+] crm/reward.service.ts
  ├── [TESTED] debit + redeem
  └── [GAP] [->INT] concurrent redeem

COVERAGE: 34/42 paths tested (81%)
GAPS: 8  (3 E2E, 2 UNIT, 2 INT, 1 PERF)
REGRESSION-CRITICAL GAPS: 1  (concurrent redeem)
```

The one regression-critical gap is the concurrent coupon redemption path, which
needs the same `FOR UPDATE` treatment the stock path already has. That is a week
3 ticket, not a nice to have, and it is on the board with that label.

## Definition of done

A ticket is not done until every line is true.

- [ ] The zod schema for the request and response lives in `packages/shared` and
      is the only place that shape is defined.
- [ ] The controller method carries a `@Permissions('module.resource.action')`
      decorator and the route is added to `route-table.ts`.
- [ ] Every business rule stated in the module chapter has a named test in the
      catalogue above, and it passes.
- [ ] Anything that moves stock or money is inside a single `$transaction`, and
      there is an integration test that forces a mid-transaction failure and
      asserts nothing was written.
- [ ] Any emitted event is written to `OutboxEvent` inside that same transaction,
      with a test proving no event survives a rollback.
- [ ] Every state-changing action writes an `AuditLog` row, with a test.
- [ ] Error responses use a registered code from
      [chapter 15](15-api-conventions.md), and the message names the value that
      failed rather than saying "invalid input".
- [ ] Outlet scope is enforced and there is a 404 test for a caller outside scope.
- [ ] Coverage on the touched module is at or above its floor, and the four
      100 percent modules are still at 100.
- [ ] `bun run lint`, `bun run typecheck` and `bun test` pass locally before the
      pull request opens.
- [ ] If the change touches a Playwright journey, that journey passes against a
      locally seeded database.
- [ ] The chapter in this book that documents the module reflects the change.
