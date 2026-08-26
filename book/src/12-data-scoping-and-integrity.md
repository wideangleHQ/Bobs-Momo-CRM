# Data scoping, dates and integrity

Three things in this system will produce bugs that nobody notices for weeks:
reading another outlet's data, putting a row on the wrong trading day, and
writing half of a multi-row operation. This chapter is the defence against all
three.

## Outlet scoping

The rule is one sentence. Every operational query is filtered by an outlet id
the caller is allowed to see, and the allowed set is computed by the server,
never sent by the client.

`OutletGuard` runs after `JwtAuthGuard` and resolves the set once per request:

```text
  JWT verified
      │
      ▼
  roleKey == OWNER or OPERATIONS_MANAGER ?
      │                        │
     yes                      no
      │                        │
      ▼                        ▼
  every Outlet where      SELECT "outletId" FROM "UserOutlet"
  isActive = true         WHERE "userId" = :sub
      │                        │
      └──────────┬─────────────┘
                 ▼
      req.outletScope = { mode, allowed: string[] }
                 │
        ?outletId given?
         │            │
        yes           no
         │            │
   in allowed?    allowed.length === 1 ? use it : 400 OUTLET_REQUIRED
    │        │
   yes      no ──▶ 404 NOT_FOUND   (not 403, see below)
    │
    ▼
  req.outletId = the single resolved outlet
```

The allowed list for `ALL_OUTLETS` roles is cached in Redis under
`scope:outlets:all` for 5 minutes and busted whenever an outlet is created or
deactivated. The per user list is small enough to read from Postgres on every
request.

### The repository pattern that makes forgetting hard

Controllers and services never call `prisma.stockTransaction.findMany`
directly. They go through a repository whose constructor takes the scope, and
whose methods cannot express an unscoped query because the scope is merged
last:

```ts
// apps/api/src/modules/inventory/inventory.repository.ts
type Scope = { allowed: string[] };

@Injectable({ scope: Scope.REQUEST })
export class InventoryRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly req: RequestWithScope,
  ) {}

  /** Every read goes through here. The spread order is the whole point:
   *  a caller-supplied outletId is overwritten, never trusted. */
  private scoped<T extends { outletId?: string | { in: string[] } }>(
    where: T,
  ): T & { outletId: string | { in: string[] } } {
    const allowed = this.req.outletScope.allowed;
    return { ...where, outletId: { in: allowed } };
  }

  findTransactions(where: Prisma.StockTransactionWhereInput, take = 50) {
    return this.prisma.stockTransaction.findMany({
      where: this.scoped(where),
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
```

Two properties matter. The scope is applied after the caller's `where`, so a
`where` that already carries an `outletId` is overwritten rather than merged.
And the repository is request scoped, so there is no way to construct one
without a request that has been through `OutletGuard`.

### What a scoping bug looks like

```ts
// WRONG. The caller controls the filter.
async listTasks(query: ListTasksDto) {
  return this.prisma.task.findMany({
    where: { outletId: query.outletId, status: query.status },
  });
}
```

A cashier at Patia sends `?outletId=<saheed uuid>` and reads the other shop's
task board. Nothing throws. Nothing is logged as suspicious. It shows up when
somebody asks why a Saheed task appeared on a Patia phone, six weeks later.

The same bug wearing a different hat:

```ts
// ALSO WRONG. Scoped list, unscoped detail.
async getTask(id: string) {
  return this.prisma.task.findUnique({ where: { id } });
}
```

The list is safe and the detail endpoint is not, so any leaked or guessed id
returns another outlet's row. Every `findUnique` by id in an outlet-scoped
module must be a `findFirst` with the scope in the `where`.

The code review checklist item, which chapter 33 repeats: every new query in an
outlet-scoped module either goes through the scoped repository or has an
explicit `outletId` filter drawn from `req.outletScope`, and every fetch by
primary key is a scoped `findFirst`. Reviewers reject the PR otherwise, without
discussion.

### 404, not 403

A resource that exists but sits outside the caller's scope returns 404 with
`NOT_FOUND`, exactly as if the id were fictional. 403 confirms that the row
exists, which tells a curious cashier that purchase `PO-2026-0117` is real and
that it is not theirs. Both answers deny the read. Only one of them leaks.

403 is reserved for a permission the caller lacks on a resource inside their
own scope, for example a kitchen manager trying to void a purchase at their own
outlet.

## The business day

A trading day at Bob's Momo runs from about 07:00 to 23:30 IST, and the work
that describes that day happens after it. The closing checklist gets submitted
at 00:20. The last closing stock count goes in at 00:35. If those rows carry
the calendar date of the moment they were written, the closing entries for
Saturday land on Sunday, and every daily report is wrong in a way that looks
like staff negligence rather than a bug.

The definition, and it is the only one:

```text
  businessDate(t) = calendar date, in Asia/Kolkata,
                    of (t minus BUSINESS_DAY_START_HOUR hours)

  BUSINESS_DAY_START_HOUR = 4
```

```text
  IST clock   22:00   23:00   00:00   01:00   02:00   03:00   04:00   05:00
            ────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┴──
  calendar   16 Aug  16 Aug  17 Aug  17 Aug  17 Aug  17 Aug  17 Aug  17 Aug
  business   16 Aug  16 Aug  16 Aug  16 Aug  16 Aug  16 Aug  17 Aug  17 Aug
                                                             ▲
                       03:59 on 17 Aug ──▶ businessDate 16 Aug
                       04:01 on 17 Aug ──▶ businessDate 17 Aug ┘
```

04:00 is the cutoff because nothing happens between 03:00 and 06:00 in either
outlet. Any hour in that window works; 04:00 is the one written down.

```ts
// packages/shared/src/business-date.ts
export const BUSINESS_DAY_START_HOUR = 4;

/** "2026-08-16". The trading day that `at` belongs to. */
export function toBusinessDate(at: Date = new Date()): string {
  const shifted = new Date(
    at.getTime() - BUSINESS_DAY_START_HOUR * 60 * 60 * 1000,
  );
  // en-CA formats as YYYY-MM-DD. No date library needed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(shifted);
}

/** What Prisma wants for a @db.Date column: midnight UTC on that date. */
export function toBusinessDateUtc(at: Date = new Date()): Date {
  return new Date(`${toBusinessDate(at)}T00:00:00.000Z`);
}
```

`Intl.DateTimeFormat` handles the IST offset from the runtime's own tz
database, so there is no hardcoded `+05:30` anywhere and no dependency to keep
current.

Four models carry a `businessDate` and all four use this helper.
`StockTransaction.businessDate` groups consumption and wastage into trading
days. `AttendanceDay.businessDate` is one row per employee per trading day, so
a shift that ends at 00:45 stays on the day it started. `Task.businessDate`
groups checklist runs, so the closing checklist submitted after midnight sits
with the day it closed. `DailySalesEntry.businessDate` is the unique key that
makes one sales number per shop per day.

Every other date column is a user-picked calendar date and must not go through
this helper. `Purchase.purchaseDate` is the date on the vendor's invoice.
`Shift.shiftDate`, `LeaveRequest.fromDate` and `toDate`, `Employee.joinedOn`,
`SalaryRecord.effectiveFrom` and `ItemPriceHistory.observedOn` are all picked
from a date field by a human. Shifting those by four hours corrupts them.

Four places that get this wrong if you are not careful.

Attendance rollup. A punch at 00:20 must find the `AttendanceDay` for the
previous business date. Use `new Date()` truncated to a date and you create a
second row for the new calendar day, the unique constraint on `(employeeId,
businessDate)` lets it through because the dates differ, and the employee shows
as absent for the day they just finished working.

Closing stock. The `CLOSING` transaction written at 00:35 must carry
yesterday's business date or the consumption report shows a day with issues and
no close, followed by a day with a close and no issues.

Daily sales entry. `@@unique([outletId, businessDate])` is the constraint that
catches this fastest and most confusingly. The cashier submits at 00:20 with a
naive date, the row lands on tomorrow, and the next evening's genuine entry
fails with a 409 that makes no sense to anyone. Always derive the default
business date server side and show it in the form, so the cashier can see which
day they are filing against.

Recurring task generation. `TaskRecurrence.cronExpr` is evaluated in
`Asia/Kolkata`, which is correct, but the generated `Task.businessDate` must
still come from the helper. A 07:00 recurrence agrees with both definitions; a
02:00 recurrence does not, and the closing audit generated at 02:00 belongs to
the day that is ending, not starting.

## Timezone handling

Every `DateTime` column stores UTC. Postgres `timestamp(3)` with Prisma, no
`timestamptz`, no local offsets in the database. The API accepts and returns
ISO 8601 with an explicit `Z`, for example `2026-08-16T18:05:00.000Z`.

Every `@db.Date` column already holds a local business date. It is not a moment
and it has no timezone. Never pass one through a timezone conversion on the way
out, because converting midnight IST to UTC moves it back to the previous day
at 18:30 and every date on the screen shifts by one. The API serialises date
columns as `YYYY-MM-DD` strings and query parameters `?from=` and `?to=` are
parsed as Asia/Kolkata business dates.

The frontend renders every timestamp in `Asia/Kolkata` regardless of the
browser's timezone, using a single formatter in
`apps/web/src/lib/format-date.ts`. Staff and owner are all in one city, so a
laptop left on UTC after a trip must not make the attendance board disagree
with the wall clock. Chapter 27 covers the formatter.

## Transaction boundaries

Every multi-row operation lists its writes here. If a write is in the list, it
is inside one `prisma.$transaction`, including the outbox insert. If the
business row commits, the event exists. If the business row rolls back, no
phantom notification was sent about a purchase that never happened. That is the
whole guarantee of the transactional outbox, and it is why the dispatcher polls
a table instead of the service calling WhatsApp directly.

```text
  POST /inventory/transactions        one Prisma $transaction
  ─────────────────────────────       ────────────────────────
         │
         ▼
  ┌────────────────┐  1. INSERT ItemStock ON CONFLICT DO NOTHING
  │ InventorySvc   │  2. SELECT ItemStock ... FOR UPDATE
  │ .record()      │  3. compute signedQty, balanceAfter
  │                │  4. INSERT StockTransaction
  └───────┬────────┘  5. UPDATE ItemStock.qtyOnHand
          │           6. INSERT OutboxEvent(LOW_STOCK) if crossed
          ▼              and lastAlertAt is outside the cooldown
   commit or rollback
```

Recording a purchase. Insert `Purchase` with `status: RECORDED`, insert every
`PurchaseItem`, insert one `ItemPriceHistory` row per line, insert one
`StockTransaction` of type `RECEIVED` per line with `sourceType: "PURCHASE"`
and `sourceId` set to the purchase id, update each `ItemStock.qtyOnHand`, set
the linked `PurchaseRequest` to `FULFILLED` if there is one, insert
`OutboxEvent(PURCHASE_RECORDED)`. All of it in one transaction. A purchase
recorded without its stock movement is the single worst failure mode in the
system, because the inventory looks wrong and the paper trail looks right.

Recording a stock transaction. The six steps in the diagram above. The upsert
in step 1 exists so that the first ever movement for an item and outlet has a
row to lock in step 2.

An outlet transfer. Generate one `transferPairId`. Lock both `ItemStock` rows,
always in ascending order of `(itemId, outletId)` so two simultaneous transfers
in opposite directions cannot deadlock. Insert `TRANSFER_OUT` at the source,
insert `TRANSFER_IN` at the destination, update both balances, insert
`OutboxEvent(OPERATIONAL_ALERT)` for the receiving outlet's store manager. Six
writes, one transaction, and total stock across the business is unchanged.

Completing a checklist that fails an item. Upsert every
`TaskChecklistResult`, set the run `Task` to `COMPLETED` (or leave it at
`COMPLETED` awaiting verification when `requiresVerification` is true), then
for each `FAIL` on an item whose `failCreatesTask` is true, insert a follow-up
`Task` with `parentTaskId` set, `priority: HIGH` and a due time two hours out,
and insert `OutboxEvent(AUDIT_ITEM_FAILED)` plus `OutboxEvent(TASK_ASSIGNED)`
for the follow-up. One transaction. Partial completion, where three of nine
answers land and the follow-up task never appears, is not an acceptable state.

Approving leave. Update `LeaveRequest` with `status`, `decidedById`,
`decidedAt` and `decisionNote`, then upsert an `AttendanceDay` row with
`status: ON_LEAVE` for every business date in the range that does not already
have a punch, then insert `OutboxEvent(LEAVE_DECIDED)`. One transaction, so an
approved leave never exists without its attendance rows.

A punch that closes an attendance day. Upsert the `AttendanceDay` for the
derived business date, insert the `AttendancePunch`, close any open `BreakLog`,
recompute `workedMins`, `breakMins`, `lateMins`, `firstInAt` and `lastOutAt`
from the full punch list, and update the day. One transaction. No outbox event,
because nobody needs a notification that a shift ended.

## Concurrency

Two races are real here. Everything else is theoretical at 20 to 30 users.

### Two people moving the same stock at once

The kitchen manager issues 3 KG of chicken mince while the store manager
records a 10 KG delivery of the same item at the same outlet. Both read
`qtyOnHand` as 4.000, both compute a new balance from what they read, and one
of the two writes wins. Stock is silently wrong and the ledger no longer sums
to the balance, which is exactly what the nightly reconciliation job in chapter
10 is there to catch.

The fix is a row lock inside the transaction:

```ts
await this.prisma.$transaction(async (tx) => {
  // Make sure the row exists before we try to lock it.
  await tx.$executeRaw`
    INSERT INTO "ItemStock" ("id", "itemId", "outletId", "qtyOnHand",
                             "updatedAt")
    VALUES (gen_random_uuid(), ${itemId}::uuid, ${outletId}::uuid, 0, now())
    ON CONFLICT ("itemId", "outletId") DO NOTHING`;

  // Serialise everybody else on this one row until we commit.
  const [stock] = await tx.$queryRaw<{ id: string; qtyOnHand: Decimal }[]>`
    SELECT "id", "qtyOnHand"
    FROM   "ItemStock"
    WHERE  "itemId" = ${itemId}::uuid
      AND  "outletId" = ${outletId}::uuid
    FOR    UPDATE`;

  const balanceAfter = new Decimal(stock.qtyOnHand).add(signedQty);
  if (balanceAfter.isNegative() && !allowNegative) {
    throw new BusinessRuleError('INSUFFICIENT_STOCK', ...);
  }

  await tx.stockTransaction.create({ data: { ..., signedQty, balanceAfter } });
  await tx.itemStock.update({
    where: { id: stock.id },
    data:  { qtyOnHand: balanceAfter },
  });
}, { timeout: 8000 });
```

Raw SQL because Prisma has no `FOR UPDATE` in its query API. The lock is held
from the `SELECT` until commit, which is a few milliseconds, and it only blocks
writers touching the same item at the same outlet.

Optimistic locking would mean adding a `version` column, reading it, and
failing the write if it changed, then retrying. Pessimistic locking means
taking the lock up front and making the second writer wait. Optimistic wins
when contention is rare and retries are cheap. Here the contended object is one
row, the transaction is short, and the retry would have to replay a user's
form submission, so making the second writer wait 3 milliseconds is both
simpler and kinder. Pessimistic on one hot row is the right call. It would be
the wrong call if the lock were on the whole `ItemStock` table.

### Double submission from a flaky phone

Staff on a weak 4G connection tap submit, see nothing happen, and tap again.
Both requests arrive. Two wastage rows, two purchases, two punches.

`POST /purchases`, `POST /inventory/transactions` and
`POST /attendance/punch` accept an `Idempotency-Key` header, a UUID the client
generates once per form submission and reuses on retry. The interceptor does
`SET idem:{userId}:{key} = "processing" NX EX 86400` in Redis. If the key is
already there and holds a stored response, it replays that response with the
original status code. If it holds `processing`, it returns 409 `IN_PROGRESS`.
On success it overwrites the key with the serialised response for 24 hours.

The web app generates the key in the form's `onSubmit` and keeps it in a ref
until the request resolves, so a retry after a timeout carries the same key and
a genuine second wastage entry five minutes later carries a new one.

## Referential integrity and deletes

| Relation | On delete | Why |
|---|---|---|
| UserOutlet to User | Cascade | Scope rows have no meaning without the user |
| RefreshToken to User | Cascade | Sessions die with the account |
| PurchaseRequestLine to PurchaseRequest | Cascade | Lines are part of the request |
| PurchaseItem to Purchase | Cascade | Same, and only DRAFT purchases are deletable |
| VendorItem to Vendor | Cascade | A link, not a fact |
| AttendancePunch, BreakLog to AttendanceDay | Cascade | Children of the day |
| TaskChecklistResult, TaskComment, TaskAttachment to Task | Cascade | Children of the task |
| MessageRead to Message | Cascade | Read receipts belong to the message |
| Notification to User | Cascade | Nothing reads another user's notifications |
| Everything to Outlet, InventoryItem, Vendor, Employee, Unit, ItemCategory | Restrict | Master data with ledger rows pointing at it |

Restrict is Prisma's default for a required relation, and it is left as the
default deliberately. Master data is never hard deleted. `InventoryItem`,
`Vendor`, `Outlet`, `Department` and `ChecklistTemplate` are retired with
`isActive: false`. `User` is retired with `status: DISABLED`. `Employee` is
retired with `status: EXITED` and an `exitedOn` date. A delete that would
succeed is still refused at the service layer, because six months of stock
history whose item name is gone is worse than a long picker list.

The one exception is `RefreshToken`, which is hard deleted 30 days after expiry
by the nightly cleanup, because `AuditLog` already records every login.

### Archival

`OutboxEvent` grows by roughly 200 rows a day. Rows with `status: DONE` are
deleted 14 days after `processedAt` by the outbox cleanup job. Nothing reads
them: the business row is the record and `Notification` holds the delivery
outcome. Rows with `status: DEAD` are kept for 90 days, then exported to
`archive/outbox/YYYY-MM.jsonl.gz` in the Supabase Storage bucket and deleted,
because a dead event is a bug report and somebody may want it.

`AuditLog` grows by roughly 400 rows a day, about 150,000 a year, which is not
a size problem on an 8 GB database. It is a retention question instead. Nothing
is deleted inside 18 months. Beyond that, a monthly job exports the month to
`archive/audit/YYYY-MM.jsonl.gz` and deletes the exported rows, keeping the
table under half a million rows so the three indexes stay cheap. The export is
the same JSON the API returns, one object per line, so restoring a month is a
`COPY` away.

`Notification` rows with a non-null `readAt` older than 90 days are deleted.
Unread ones are kept, because an unread notification from four months ago is a
process problem worth seeing.

> **Spec note:** the archival jobs above (`outbox-cleanup.job.ts`,
> `audit-archive.job.ts`, `notification-prune.job.ts`) are not in the job list
> in chapter 08. They are small, they are scheduled monthly or
> nightly, and chapter 22 owns their schedules.
