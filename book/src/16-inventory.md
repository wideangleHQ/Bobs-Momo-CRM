# Inventory management

This chapter implements FR-INV-001 (record stock transaction), FR-INV-002 (low
stock alert) and FR-INV-003 (stock history and consumption view). It is the
module the client asked about first in discovery, and the one where a wrong
number costs real money.

## A day at the counter

At 06:30 the kitchen manager at BM-SAHEED unlocks the shutter, opens the
walk-in fridge and writes numbers on a paper register: chicken mince 8 kg,
cabbage 12 kg, maida 25 kg. That is the opening stock. At 07:10 a vendor's van
arrives at the back door with 15 kg of chicken mince against a handwritten
bill. At 11:00 the prep team draws 6 kg of that mince for the day's momo
filling. At 15:00 two kilos of paneer that sat out overnight go into the bin.
At 23:00, after the last order, someone counts the fridge again and writes the
closing numbers.

Five events, five different people, one paper register, and by Friday nobody
can tell you how much chicken the Patia outlet actually used on Tuesday. That
is the problem this module solves. The system does not try to be clever about
it. It records the same five events the paper register records, in the same
order, with a name attached to each one and a running balance the machine
maintains instead of a human.

## The stock pipeline

The SRS workflow is opening, received, issued, wastage, closing. Each stage
writes one or more rows into `StockTransaction` and moves `ItemStock.qtyOnHand`
by `signedQty`.

```text
  06:30                 07:10                 11:00
  Opening stock         Stock received        Stock issued
  ─────────────         ──────────────        ────────────
  counted, or           vendor delivery       kitchen draws
  carried from          recorded against      for prep and
  yesterday's close     a Purchase            service
        │                      │                    │
        ▼                      ▼                    ▼
  ┌───────────┐          ┌───────────┐        ┌───────────┐
  │ OPENING   │          │ RECEIVED  │        │ ISSUED    │
  │ signed +  │          │ signed +  │        │ signed -  │
  └─────┬─────┘          └─────┬─────┘        └─────┬─────┘
        │                      │                    │
        └──────────┬───────────┴─────────┬──────────┘
                   │                     │
                   ▼                     ▼
        ┌────────────────────┐  ┌──────────────────────┐
        │ StockTransaction   │  │ ItemStock.qtyOnHand  │
        │ append-only ledger │─▶│ running balance,     │
        │ balanceAfter on    │  │ one row per          │
        │ every row          │  │ (item, outlet)       │
        └────────────────────┘  └──────────────────────┘
                   ▲                     ▲
        ┌──────────┴───────────┬─────────┴──────────┐
        │                      │                    │
  ┌───────────┐          ┌────────────┐       ┌───────────┐
  │ WASTAGE   │          │ ADJUSTMENT │       │ CLOSING   │
  │ signed -  │          │ signed +/- │       │ signed 0  │
  └───────────┘          └────────────┘       └───────────┘
        │                      │                    │
  15:00 spoiled          any time, always     23:00 counted,
  batch binned           with a reason        one row per item
  with a reason          string               per business date
```

`CLOSING` carries `signedQty` of zero. It is a marker that says "a human
counted this shelf and agreed with the number". If the count disagrees with the
ledger, the variance is written first as an `ADJUSTMENT` row and the `CLOSING`
marker follows with `balanceAfter` equal to the counted quantity. Closing never
silently rewrites the balance.

## Master data

Four models carry the master data. Three are global, one is per outlet.

| Model | Scope | Rows expected in Phase 1 |
|---|---|---|
| `Unit` | global | 6 to 10 |
| `ItemCategory` | global | 5 to 12 |
| `InventoryItem` | global | 80 to 200 |
| `ItemStock` | per (item, outlet) | items x 2 outlets |

`Unit` holds the measure an item is counted in: `KG`, `G`, `L`, `ML`, `PCS`,
`PKT`. The unit code is what the kitchen manager sees next to every quantity
field. There is no unit conversion in Phase 1. If the vendor sells chicken by
the kilo and the kitchen issues it by the kilo, one unit is enough. An item
that genuinely needs two units (bought by the sack, issued by the kilo) gets
two items and a manual conversion by whoever records the transfer, and that
limitation is written into the seed data notes so nobody discovers it at 2am.

`ItemCategory` is a flat list. No hierarchy. The wastage report groups by it and
the purchase spend report groups by it, and two levels of nesting buy nothing
for 12 categories.

`InventoryItem` is the item master.

| Field | Type | Notes |
|---|---|---|
| `sku` | String, unique | `ITM-CHICKEN-MINCE` |
| `name` | String | display name, free text |
| `categoryId` | uuid | required |
| `unitId` | uuid | required, effectively immutable |
| `isPerishable` | Boolean | default false |
| `isActive` | Boolean | default true |

### The SKU convention

SKUs follow `ITM-<SLUG>` where the slug is the item name upper-cased, spaces
and slashes replaced by hyphens, and any character outside `A-Z0-9-` dropped.
`Chicken Mince (Boneless)` becomes `ITM-CHICKEN-MINCE-BONELESS`. The server
generates the SKU from the name on create and rejects a client-supplied SKU
that does not match the pattern `^ITM-[A-Z0-9-]{2,48}$`.

The SKU exists for humans, not for the database. Every foreign key uses the
uuid. The SKU is what appears on a printed count sheet and what someone types
into the search box, so it has to be readable and stable. It is never
regenerated when the item name changes, because a stable identifier that drifts
is worse than no identifier.

### What isPerishable actually does

`isPerishable` drives the grouping and the default filter on the wastage report.
That is all it does in Phase 1. It does not trigger expiry tracking, it does not
create FEFO issue ordering, it does not change any validation, and it does not
affect the low stock threshold. Saying so plainly here is deliberate: a flag
named `isPerishable` reads like it enforces something, and the next engineer
will assume shelf-life logic exists somewhere. It does not. Batch and expiry
tracking is future scope and needs a `StockBatch` model that Phase 1 does not
have.

### Deactivation, never deletion

An item is retired with `isActive = false`. There is no delete endpoint and
there never will be one, because every `StockTransaction`, `PurchaseItem`,
`ItemPriceHistory` and `PurchaseRequestLine` row points at the item id. Deleting
the item would either fail on the foreign key or, worse, orphan six months of
history that a report still needs to render.

Deactivation rules:

- An inactive item is excluded from item pickers and from the default
  `GET /inventory/items` listing. `?isActive=false` still returns it.
- New `StockTransaction` rows for an inactive item are rejected with 422
  `ITEM_INACTIVE`. Historical rows stay readable.
- Its `ItemStock` rows are left alone. If the item is deactivated with 3.2 kg
  on hand, the balance stays at 3.2 kg and shows on the stock list with an
  inactive badge, because pretending the fridge is empty is a lie.
- Reactivation is a `PATCH` with `isActive: true`. Nothing else changes.

## The ledger

`StockTransaction` is append only. No endpoint issues an `UPDATE` against it and
no service method does either. The repository layer exposes `create` and read
methods for this model and nothing else, which makes the rule enforceable by
code review rather than by memory.

Every row carries three quantity columns and they mean different things.
`quantity` is always positive and is what the user typed. `signedQty` is
`quantity` with the sign applied by transaction type. `balanceAfter` is the
value of `ItemStock.qtyOnHand` immediately after this row was applied, computed
inside the same locked transaction. `balanceAfter` is what makes the ledger
auditable without replaying it: any single row tells you what the balance was
at that instant.

### The eight transaction types

| Type | Sign | Reason required | Permission key | Typical trigger | Backdating |
|---|---|---|---|---|---|
| `OPENING` | + | no | `inventory.transaction.create` | first ever row for an item at an outlet, or a full physical recount | today only |
| `RECEIVED` | + | no | `inventory.transaction.create` | vendor delivery, normally written by the purchase service | up to 7 days |
| `ISSUED` | - | no | `inventory.transaction.create` | kitchen draws stock for prep or service | up to 7 days |
| `WASTAGE` | - | yes | `inventory.transaction.create` | spoilage, spillage, a dropped tray | up to 7 days |
| `ADJUSTMENT` | + or - | yes | `inventory.adjustment.create` | physical count variance, correcting an earlier mistake, void of a purchase | up to 7 days |
| `TRANSFER_OUT` | - | no | `inventory.transfer.create` | stock sent to the other outlet | today only |
| `TRANSFER_IN` | + | no | `inventory.transfer.create` | paired row at the receiving outlet | today only |
| `CLOSING` | 0 | no | `inventory.transaction.create` | end of day count, one per item per date | today only |

Backdating is capped at 7 calendar days by `INVENTORY_BACKDATE_LIMIT_DAYS`.
A `businessDate` in the future is always rejected. The 7 day window exists
because staff write on paper for two days and then catch up, and a hard
today-only rule would push them straight back to the paper register. The window
is short enough that a reconciled month does not move under the owner's feet.

`ADJUSTMENT` sits behind its own permission key, `inventory.adjustment.create`,
which the kitchen manager does not hold. Anyone can record that stock was used
or wasted. Only an inventory manager or above can declare that the ledger itself
was wrong.

### Correcting a mistake

There is exactly one correction mechanism. A kitchen manager issues 60 kg of
cabbage instead of 6 kg. The 60 kg row stays in the ledger forever. The fix is a
new `ADJUSTMENT` row of `+54` with
`reason: "Correcting ISSUED txn 4f2a..., typed 60 instead of 6"` and
`note` carrying the original transaction id.

The wrong row is not edited, not soft-deleted and not flagged. Two reasons.
First, the balance history stays reconstructible: replaying `signedQty` from the
first row always lands on the current `qtyOnHand`, and any test can assert that.
Second, the mistake itself is data. The wastage and consumption reports for that
day show a 60 kg issue and a 54 kg correction, and a manager reviewing the month
can see that someone is fat-fingering the quantity field, which is a real
operational signal that an edit would erase.

## Maintaining the balance

Every write to the ledger runs inside a Prisma `$transaction` with a row lock on
the `ItemStock` row. Without the lock, two kitchen staff submitting issues for
the same item within the same second both read `qtyOnHand = 10`, both write
`balanceAfter = 4`, and the balance ends at 4 instead of -2 with one of them
blocked.

```ts
// apps/api/src/modules/inventory/inventory.service.ts

const SIGN: Record<StockTxnType, -1 | 0 | 1> = {
  OPENING: 1, RECEIVED: 1, TRANSFER_IN: 1,
  ISSUED: -1, WASTAGE: -1, TRANSFER_OUT: -1,
  ADJUSTMENT: 0,          // sign comes from the caller's signed input
  CLOSING: 0,
};

const REASON_REQUIRED: StockTxnType[] = ["WASTAGE", "ADJUSTMENT"];
const NEGATIVE_BLOCKED: StockTxnType[] = ["ISSUED", "TRANSFER_OUT"];

async applyTransaction(input: ApplyTxnInput, actor: Actor) {
  return this.prisma.$transaction(async (tx) => {
    // 1. lock the balance row, creating it on first use
    await tx.$executeRaw`
      INSERT INTO "ItemStock" ("id","itemId","outletId","qtyOnHand")
      VALUES (gen_random_uuid(), ${input.itemId}::uuid,
              ${input.outletId}::uuid, 0)
      ON CONFLICT ("itemId","outletId") DO NOTHING`;

    const [stock] = await tx.$queryRaw<ItemStockRow[]>`
      SELECT "id","qtyOnHand","reorderLevel","lastAlertAt"
      FROM "ItemStock"
      WHERE "itemId" = ${input.itemId}::uuid
        AND "outletId" = ${input.outletId}::uuid
      FOR UPDATE`;

    // 2. read balance and compute the signed movement
    const before = new Decimal(stock.qtyOnHand);
    const signed =
      input.type === "ADJUSTMENT"
        ? new Decimal(input.signedQty)          // caller supplies the sign
        : new Decimal(input.quantity).mul(SIGN[input.type]);
    const after = before.plus(signed);

    // 3. validate
    if (REASON_REQUIRED.includes(input.type) && !input.reason?.trim()) {
      throw new BusinessError("REASON_REQUIRED", 400);
    }
    if (after.lt(0) && NEGATIVE_BLOCKED.includes(input.type)) {
      throw new BusinessError("NEGATIVE_STOCK_BLOCKED", 422, {
        onHand: before.toFixed(3), requested: input.quantity,
      });
    }

    // 4. append the ledger row with the post-state on it
    const txn = await tx.stockTransaction.create({
      data: {
        itemId: input.itemId, outletId: input.outletId, type: input.type,
        quantity: signed.abs(), signedQty: signed, balanceAfter: after,
        businessDate: input.businessDate, reason: input.reason ?? null,
        note: input.note ?? null, sourceType: input.sourceType ?? "MANUAL",
        sourceId: input.sourceId ?? null,
        transferPairId: input.transferPairId ?? null,
        createdById: actor.userId,
      },
    });

    // 5. move the running balance
    await tx.itemStock.update({
      where: { id: stock.id },
      data: { qtyOnHand: after },
    });

    // 6. reorder check, transition + cooldown, see below
    await this.maybeRaiseLowStock(tx, stock, before, after);

    return txn;
  });
}
```

The `ON CONFLICT DO NOTHING` insert before the `SELECT ... FOR UPDATE` handles
the first ever transaction for an item at an outlet without a separate code
path. `FOR UPDATE` on a row that does not exist locks nothing, so the row has to
be there before the lock is taken.

Nothing in this method touches JavaScript floats. The zod layer accepts a
number, the service converts to `Prisma.Decimal` on entry, and every arithmetic
operation from that point is decimal. A float `0.1 + 0.2` in a quantity column
is the kind of bug that shows up as a 0.0000000004 kg discrepancy six weeks
later.

```text
  POST /inventory/transactions
  ────────────────────────────
          │
          ▼
   Idempotency-Key seen in Redis?  ──yes──▶ replay stored 201 response
          │ no
          ▼
   zod parse + outlet in caller scope? ──no──▶ 400 / 404
          │ yes
          ▼
  ┌─────────────────── BEGIN $transaction ────────────────────┐
  │                                                            │
  │  upsert ItemStock row  ──▶  SELECT ... FOR UPDATE          │
  │          │                                                 │
  │          ▼                                                 │
  │   before = qtyOnHand                                       │
  │   signed = quantity * SIGN[type]                           │
  │   after  = before + signed                                 │
  │          │                                                 │
  │          ├── reason missing on WASTAGE/ADJUSTMENT ─▶ 400   │
  │          ├── after < 0 and type in {ISSUED,                │
  │          │      TRANSFER_OUT}              ────────▶ 422   │
  │          ▼                                                 │
  │   INSERT StockTransaction (balanceAfter = after)           │
  │          │                                                 │
  │          ▼                                                 │
  │   UPDATE ItemStock SET qtyOnHand = after                   │
  │          │                                                 │
  │          ▼                                                 │
  │   crossed reorderLevel and cooldown elapsed?               │
  │          │ yes                                             │
  │          ├──▶ INSERT OutboxEvent (LOW_STOCK)               │
  │          └──▶ UPDATE ItemStock SET lastAlertAt = now()     │
  └──────────────────── COMMIT or ROLLBACK ────────────────────┘
          │
          ▼
   store response under Idempotency-Key, TTL 24h  ──▶  201
```

## The negative stock rule

Issuing more than the ledger says is on hand is blocked with 422
`NEGATIVE_STOCK_BLOCKED` for `ISSUED` and `TRANSFER_OUT`. It is permitted for
`ADJUSTMENT`, which still requires a reason.

The reasoning is about which error is more likely. When a kitchen manager types
an issue of 12 kg against a balance of 4 kg, the overwhelmingly likely
explanation is a typo or a wrong item selection, not a fridge that contains
negative chicken. Blocking costs the user five seconds and a re-read of the
number. Allowing it silently corrupts every consumption figure downstream.

`ADJUSTMENT` is the opposite case. A physical count that comes back lower than
the ledger is evidence that the ledger was already wrong, usually because
someone issued stock and never recorded it. Blocking the adjustment would force
the manager to keep a number they know is false. So the adjustment is allowed to
drive the balance below zero, and the mandatory `reason` string is the audit
trail for why.

The audit consequence is that a negative `qtyOnHand` is a visible, tracked
condition rather than an impossible one. `GET /inventory/stock` returns
`isNegative: true` on any row below zero, the UI renders it in red, and the
daily low stock digest job includes negative balances at the top of the list.
A negative balance is not a database error, it is an operations problem with a
name attached to it in `StockTransaction.createdById`.

`RECEIVED`, `WASTAGE` and `TRANSFER_IN` are not in the blocked set either.
`WASTAGE` can in principle drive the balance negative for the same reason
`ADJUSTMENT` can: you cannot argue with a bin full of spoiled paneer. It is left
unblocked and it requires a reason.

## Low stock alerts

FR-INV-002 wants the manager notified when stock falls below a configured
threshold, with no duplicate alerts inside a cooldown window. Two guards do
that work, and they guard different things.

The first is the transition guard. The alert fires when the balance moves from
at-or-above `reorderLevel` to below it. It does not fire on every subsequent
transaction while the balance stays below. Without this, a kitchen issuing
cabbage six times in an afternoon against a threshold of 10 kg generates six
identical WhatsApp messages and the manager mutes the number.

The second is the cooldown. `ItemStock.lastAlertAt` records when the last
`LOW_STOCK` event was queued for that row, and a new alert is suppressed if the
last one was under `INVENTORY_LOW_STOCK_COOLDOWN_HOURS` (12) ago. The cooldown
catches the sawtooth case: the balance crosses down, a small delivery pushes it
back up, and it crosses down again forty minutes later. That is one operational
fact, not two.

```ts
private async maybeRaiseLowStock(
  tx: Prisma.TransactionClient,
  stock: ItemStockRow,
  before: Decimal,
  after: Decimal,
) {
  if (stock.reorderLevel === null) return;          // no threshold, no alert

  const level = new Decimal(stock.reorderLevel);
  const crossedDown = before.gte(level) && after.lt(level);
  if (!crossedDown) return;

  const cooldownMs = this.config.lowStockCooldownHours * 60 * 60 * 1000;
  const cooled =
    stock.lastAlertAt === null ||
    Date.now() - stock.lastAlertAt.getTime() >= cooldownMs;
  if (!cooled) return;

  await tx.outboxEvent.create({
    data: {
      eventKey: "LOW_STOCK",
      aggregateType: "ItemStock",
      aggregateId: stock.id,
      payload: {
        itemId: stock.itemId, outletId: stock.outletId,
        qtyOnHand: after.toFixed(3),
        reorderLevel: level.toFixed(3),
      },
    },
  });

  await tx.itemStock.update({
    where: { id: stock.id },
    data: { lastAlertAt: new Date() },
  });
}
```

```text
             stock movement committed
                        │
                        ▼
              reorderLevel is null?
                 │             │
                yes            no
                 │             │
                 ▼             ▼
            no alert    before >= level AND after < level?
                             │                 │
                            no                yes
                             │                 │
                             ▼                 ▼
                        no alert     lastAlertAt is null OR
                                     older than 12 hours?
                                          │          │
                                         no         yes
                                          │          │
                                          ▼          ▼
                                     suppressed   OutboxEvent
                                     (sawtooth)   LOW_STOCK
                                                       │
                                                       ▼
                                                lastAlertAt = now()
```

The event goes into `OutboxEvent` inside the same transaction as the stock
movement. It is never dispatched inline. If the stock write rolls back, so does
the alert, and there is no window where a manager gets a WhatsApp message about
a transaction that did not happen. The outbox dispatcher (chapter 22) picks it
up within its poll interval and routes it to the outlet's Inventory Manager and
Store Manager on `IN_APP` and `WHATSAPP`.

When `reorderLevel` is null, no alert ever fires for that item at that outlet.
Null is the seeded default for every `ItemStock` row, per decision 3 in chapter 04 in
this handbook. The client supplies threshold values in week 1 and until
they do, the low stock feature is functionally dormant. This is worth saying out
loud during UAT, because "the alerts do not work" and "you have not given us
threshold numbers yet" look identical from the client's side of the table.

A balance that sits below threshold for days generates exactly one alert. The
follow-up is `low-stock-digest.job.ts`, a 09:00 IST cron that emails or posts a
single digest of every item currently below its reorder level per outlet. One
transition alert for the event, one daily digest for the standing condition.

## Opening and closing stock

The opening balance for a business date is not stored. It is derived: it is the
`balanceAfter` of the most recent `StockTransaction` for that item and outlet
with a `businessDate` strictly earlier than the date being asked about, ordered
by `businessDate` then `createdAt`. In normal operation that row is the previous
day's `CLOSING` marker.

An explicit `OPENING` row is written in exactly two situations. The first is day
one of an item at an outlet, when the client's initial stock take is loaded and
there is no prior balance to carry forward. The second is after a full physical
recount, when a manager decides to redeclare the balance rather than adjust it
line by line. Both are rare, both are behind
`inventory.transaction.create`, and a partial unique index stops a second one
landing on the same date:

```sql
CREATE UNIQUE INDEX stock_txn_one_opening_per_day
  ON "StockTransaction" ("itemId", "outletId", "businessDate")
  WHERE type = 'OPENING';

CREATE UNIQUE INDEX stock_txn_one_closing_per_day
  ON "StockTransaction" ("itemId", "outletId", "businessDate")
  WHERE type = 'CLOSING';
```

The database enforces the rule. The service catches the unique violation and
maps it to 409 `OPENING_ALREADY_RECORDED` or 409 `CLOSING_ALREADY_RECORDED`.
Doing the check in application code with a `findFirst` before the insert would
race under a double-tapped submit button, and the constraint costs nothing.

The closing flow runs around 23:00. The user opens the closing screen, which
lists every item with a non-zero balance or any movement that day plus the
computed balance, and types what they actually counted. `POST /inventory/closing`
takes the whole outlet in one request. Per line, inside one transaction:

```text
  for each line { itemId, countedQty }:

     computed = ItemStock.qtyOnHand  (locked)
     variance = countedQty - computed

     variance != 0 ?
         │ yes                              │ no
         ▼                                  │
   ADJUSTMENT row                           │
     signedQty = variance                   │
     reason    = "Closing count variance"   │
     note      = "computed 8.400,           │
                  counted 8.000"            │
     ItemStock.qtyOnHand = countedQty       │
         │                                  │
         └──────────────┬───────────────────┘
                        ▼
              CLOSING marker row
                signedQty    = 0
                quantity     = countedQty
                balanceAfter = countedQty
```

Writing the variance as an `ADJUSTMENT` and the count as a `CLOSING` marker
keeps two facts separate that a single row would blur: the balance changed, and
a human verified the shelf. The wastage report reads `WASTAGE` rows only, so a
count variance never shows up as wastage, which is correct because an unexplained
2 kg shortfall is not the same thing as 2 kg someone watched go into the bin.

The closing endpoint is idempotent through the unique index rather than through
Redis. A resubmitted closing hits `CLOSING_ALREADY_RECORDED` on the first line
and the whole transaction rolls back, so a partial closing is never left behind.

## Outlet to outlet transfer

decision 2 in chapter 04 in this handbook puts transfers in scope. The ledger
design already supports them, so the marginal cost is one endpoint.

A transfer writes two rows in one transaction, across two outlets, sharing a
`transferPairId` generated by the service:

```text
  POST /inventory/transfers
  { fromOutletId, toOutletId, itemId, quantity, note }
  ─────────────────────────────────────────────────────
                          │
                          ▼
              pairId = crypto.randomUUID()
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
  lock ItemStock                       lock ItemStock
  (item, fromOutlet)                   (item, toOutlet)
        │                                    │
        │  locks taken in outletId           │
        │  sort order to avoid deadlock      │
        ▼                                    ▼
  TRANSFER_OUT                         TRANSFER_IN
  signedQty = -quantity                signedQty = +quantity
  transferPairId = pairId              transferPairId = pairId
  sourceType = "TRANSFER"              sourceType = "TRANSFER"
        │                                    │
        └─────────────────┬──────────────────┘
                          ▼
              one COMMIT, or neither row exists
```

Both locks are acquired in a deterministic order (ascending `outletId`) so two
simultaneous transfers in opposite directions cannot deadlock each other.

`TRANSFER_OUT` is subject to the negative stock block. You cannot send stock you
do not have. `TRANSFER_IN` is not, because arriving stock never reduces a
balance.

`fromOutletId === toOutletId` is rejected with 422 `TRANSFER_SAME_OUTLET` before
any lock is taken. It is a UI bug or a mis-click, and letting it through would
write two rows that cancel out and pollute both the transfer report and the
ledger.

Scope is the interesting part. `OutletGuard` requires the caller to hold both
outlets. `OWNER` and `OPERATIONS_MANAGER` carry `ALL_OUTLETS` and always do. A
`STORE_MANAGER` or `INVENTORY_MANAGER` scoped to BM-SAHEED alone does not, and
`POST /inventory/transfers` returns 404 `OUTLET_NOT_IN_SCOPE` naming the
outlet id they supplied, never the one they cannot see. Per the API conventions,
a resource outside your scope is a 404, not a 403, so a single-outlet user
cannot probe for the existence of another outlet's data.

The practical consequence is that in Phase 1 only cross-outlet roles can move
stock between outlets. That is acceptable for two outlets 9 km apart with a
shared operations manager, and it avoids building a two-sided handshake (send,
then confirm receipt) that would need an in-transit state, a dispute flow and a
notification. Phase 1 has no in-transit state: the stock lands at the
destination the moment the transaction commits, even though the auto rickshaw
carrying it takes 25 minutes. Whoever records the transfer is expected to do it
on arrival, and the note field is where they write the vehicle or the person's
name.

> **Spec note:** this chapter introduces the permission keys
> `inventory.item.create`, `inventory.item.read`, `inventory.item.update`,
> `inventory.item.deactivate`, `inventory.category.read`,
> `inventory.category.create`, `inventory.unit.read`, `inventory.unit.create`,
> `inventory.stock.read`, `inventory.stock.configure`,
> `inventory.transaction.create`, `inventory.transaction.read`,
> `inventory.adjustment.create`, `inventory.transfer.create`,
> `inventory.transaction.create` and `inventory.report.read`. Chapter 14 owns the
> role mapping.

> **Spec note:** the error envelope sample in chapter 15 uses `INSUFFICIENT_STOCK` as an illustrative code. The registered
> code for a blocked issue is `NEGATIVE_STOCK_BLOCKED`. The registry in
> chapter 15 is authoritative; `INSUFFICIENT_STOCK` is not emitted anywhere.

## Endpoint reference

Base path `/api/v1`. Every endpoint requires `Authorization: Bearer <accessJwt>`
and returns 401 `UNAUTHENTICATED` without it, 403 `FORBIDDEN` when the
permission key is missing. Those two rows are omitted from each error table
below. Scope `NONE` means the resource is global master data with no outlet
dimension.

Shared primitives, defined once in `packages/shared/src/inventory/primitives.ts`
and reused by every schema in this chapter and the next:

```ts
export const uuid = z.string().uuid();

// Decimal(14,3). Parsed as a number, converted to Prisma.Decimal in the
// service before any arithmetic. Never used in float math past the controller.
export const qty = z.coerce.number().finite().positive()
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6,
    { message: "at most 3 decimal places" });

export const signedQty = z.coerce.number().finite()
  .refine((n) => n !== 0, { message: "must not be zero" })
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6,
    { message: "at most 3 decimal places" });

// YYYY-MM-DD, read as an Asia/Kolkata business date. See chapter 12.
export const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
```

### GET /inventory/items

Permission `inventory.item.read`. Scope `NONE`.

```ts
export const listItemsQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(64).optional(),   // name or SKU, ILIKE
  categoryId: uuid.optional(),
  isActive: z.coerce.boolean().default(true),
  outletId: uuid.optional(),        // when set, joins the ItemStock balance
});
```

`GET /api/v1/inventory/items?q=chick&outletId=8b1f...&pageSize=2`

```json
{
  "data": [
    {
      "id": "3c9a1e42-7f10-4a0b-9c33-11d2b4a55e01",
      "sku": "ITM-CHICKEN-MINCE",
      "name": "Chicken Mince",
      "category": { "id": "b2...", "name": "Meat" },
      "unit": { "id": "u1...", "code": "KG", "name": "Kilogram" },
      "isPerishable": true,
      "isActive": true,
      "stock": { "qtyOnHand": "8.400", "reorderLevel": "5.000",
                 "isNegative": false, "isLow": false }
    },
    {
      "id": "77c0d1aa-2b34-4d21-bd90-9a41f0c2e7d5",
      "sku": "ITM-CHICKEN-BONELESS",
      "name": "Chicken Boneless",
      "category": { "id": "b2...", "name": "Meat" },
      "unit": { "id": "u1...", "code": "KG", "name": "Kilogram" },
      "isPerishable": true,
      "isActive": true,
      "stock": null
    }
  ],
  "meta": { "page": 1, "pageSize": 2, "total": 2 }
}
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad query params |
| 404 | `OUTLET_NOT_IN_SCOPE` | `outletId` outside caller scope |

`q` matches `name` or `sku` case-insensitively with a leading and trailing
wildcard. `stock` is `null` when the item has never had a transaction at that
outlet, which is different from a balance of zero and is rendered differently.

### POST /inventory/items

Permission `inventory.item.create`. Scope `NONE`. Status 201.

```ts
export const createItemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sku: z.string().regex(/^ITM-[A-Z0-9-]{2,48}$/).optional(),
  categoryId: uuid,
  unitId: uuid,
  isPerishable: z.boolean().default(false),
}).strict();
```

```json
{ "name": "Paneer", "categoryId": "b3...", "unitId": "u1...",
  "isPerishable": true }
```

```json
{ "id": "9d21...", "sku": "ITM-PANEER", "name": "Paneer",
  "categoryId": "b3...", "unitId": "u1...", "isPerishable": true,
  "isActive": true, "createdAt": "2026-08-26T05:12:44.301Z" }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | schema failure, including an unknown field |
| 404 | `CATEGORY_NOT_FOUND` | `categoryId` does not exist |
| 404 | `UNIT_NOT_FOUND` | `unitId` does not exist |
| 409 | `ITEM_SKU_TAKEN` | generated or supplied SKU already exists |

The SKU is derived from `name` when omitted. A collision is a 409 rather than an
auto-suffix, because `ITM-PANEER-2` in a picker is how two half-used item
records get created for the same physical ingredient.

### GET /inventory/items/:id

Permission `inventory.item.read`. Scope `NONE`. Returns the item plus its
`ItemStock` row for every outlet the caller can see.

```json
{
  "id": "3c9a...", "sku": "ITM-CHICKEN-MINCE", "name": "Chicken Mince",
  "category": { "id": "b2...", "name": "Meat" },
  "unit": { "id": "u1...", "code": "KG" },
  "isPerishable": true, "isActive": true,
  "stocks": [
    { "outletId": "8b1f...", "outletCode": "BM-SAHEED",
      "qtyOnHand": "8.400", "reorderLevel": "5.000",
      "lastAlertAt": "2026-08-24T14:02:11.000Z" },
    { "outletId": "c740...", "outletCode": "BM-PATIA",
      "qtyOnHand": "1.200", "reorderLevel": "4.000",
      "lastAlertAt": "2026-08-26T03:41:09.000Z" }
  ]
}
```

404 `ITEM_NOT_FOUND` when the id does not exist.

### PATCH /inventory/items/:id

Permission `inventory.item.update`. Scope `NONE`.

```ts
export const updateItemSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  categoryId: uuid.optional(),
  unitId: uuid.optional(),
  isPerishable: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((o) => Object.keys(o).length > 0,
  { message: "at least one field required" });
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | empty body or unknown field |
| 404 | `ITEM_NOT_FOUND` | unknown id |
| 404 | `CATEGORY_NOT_FOUND` | unknown `categoryId` |
| 409 | `ITEM_UNIT_LOCKED` | `unitId` change once ledger rows exist |

`sku` is not patchable. `unitId` is patchable only while the item has zero
`StockTransaction` rows. Changing kilograms to pieces on an item with six months
of history silently reinterprets every past quantity and every price
observation, and there is no correct migration for it.

### POST /inventory/items/:id/deactivate

Permission `inventory.item.deactivate`. Scope `NONE`. Empty body. Returns 200
with the updated item. Idempotent: deactivating an already inactive item returns
200, not an error. 404 `ITEM_NOT_FOUND` for an unknown id. The response includes
`openBalances`, the list of outlets where `qtyOnHand` is non-zero, so the UI can
warn that the item is being retired with stock still on the shelf.

### GET /inventory/categories and POST /inventory/categories

Permissions `inventory.category.read` and `inventory.category.create`. Scope
`NONE`. The list is unpaged, sorted by name, and cached in Redis for 300 seconds
under `inv:categories`.

```ts
export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
}).strict();
```

```json
{ "data": [ { "id": "b2...", "name": "Meat", "itemCount": 14 },
            { "id": "b3...", "name": "Vegetables", "itemCount": 31 } ] }
```

409 `CATEGORY_NAME_TAKEN` on a duplicate name, matched case-insensitively even
though the database constraint is case-sensitive, so that "Meat" and "meat" do
not both appear in the picker.

### GET /inventory/units and POST /inventory/units

Permissions `inventory.unit.read` and `inventory.unit.create`. Scope `NONE`.

```ts
export const createUnitSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,6}$/),
  name: z.string().trim().min(2).max(40),
}).strict();
```

409 `UNIT_CODE_TAKEN` on a duplicate code. Units have no update or delete
endpoint. There are six of them and they are seeded.

### GET /inventory/stock

Permission `inventory.stock.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`. This is
the current balance view and the screen a manager opens most often.

```ts
export const listStockQuery = pageQuery.extend({
  outletId: uuid.optional(),          // omitted = every outlet in scope
  categoryId: uuid.optional(),
  q: z.string().trim().min(1).max(64).optional(),
  lowStockOnly: z.coerce.boolean().default(false),
  includeZero: z.coerce.boolean().default(true),
  sort: z.enum(["name", "qty", "updatedAt"]).default("name"),
});
```

`GET /api/v1/inventory/stock?outletId=8b1f...&lowStockOnly=true`

```json
{
  "data": [
    { "itemId": "3c9a...", "sku": "ITM-CHICKEN-MINCE",
      "name": "Chicken Mince", "unitCode": "KG", "categoryName": "Meat",
      "outletId": "8b1f...", "qtyOnHand": "2.400", "reorderLevel": "5.000",
      "isLow": true, "isNegative": false,
      "lastMovementAt": "2026-08-26T05:44:02.881Z" }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 1 }
}
```

`lowStockOnly=true` filters to `reorderLevel IS NOT NULL AND qtyOnHand <
reorderLevel`, plus every row with `qtyOnHand < 0` regardless of threshold. A
negative balance is always worth showing on a screen titled "needs attention".

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad query params |
| 404 | `OUTLET_NOT_IN_SCOPE` | `outletId` outside caller scope |

### PATCH /inventory/stock/:itemId/reorder-level

Permission `inventory.stock.configure`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.

```ts
export const setReorderLevelSchema = z.object({
  outletId: uuid,
  reorderLevel: z.coerce.number().finite().nonnegative().nullable(),
}).strict();
```

```json
{ "outletId": "8b1f...", "reorderLevel": 5 }
```

```json
{ "itemId": "3c9a...", "outletId": "8b1f...", "qtyOnHand": "2.400",
  "reorderLevel": "5.000", "isLow": true }
```

| Status | Code | When |
|---|---|---|
| 404 | `ITEM_NOT_FOUND` | unknown item |
| 404 | `OUTLET_NOT_IN_SCOPE` | outlet outside caller scope |
| 422 | `ITEM_INACTIVE` | item is deactivated |

Setting the level creates the `ItemStock` row if it does not exist, with
`qtyOnHand` 0. Setting it to `null` disables alerts for that item at that outlet.
Changing the level does not reset `lastAlertAt` and does not fire an alert even
if the new level puts the current balance below threshold. The next stock
movement evaluates the transition, and the 09:00 digest catches it the same day.
This is a deliberate choice: an alert fired by a settings change would arrive
without an operational event behind it and the recipient could not act on it.

### POST /inventory/transactions

Permission `inventory.transaction.create`, and additionally
`inventory.adjustment.create` when `type` is `ADJUSTMENT`. Scope `OWN_OUTLET`
or `ALL_OUTLETS`. Accepts `Idempotency-Key`. Status 201.

```ts
export const recordTransactionSchema = z.object({
  itemId: uuid,
  outletId: uuid,
  type: z.enum(["OPENING", "RECEIVED", "ISSUED", "WASTAGE", "ADJUSTMENT"]),
  quantity: qty.optional(),          // required except for ADJUSTMENT
  signedQty: signedQty.optional(),   // ADJUSTMENT only, carries the sign
  businessDate: businessDate,
  reason: z.string().trim().min(3).max(280).optional(),
  note: z.string().trim().max(500).optional(),
}).strict()
  .refine((o) => o.type === "ADJUSTMENT" ? o.signedQty !== undefined
                                         : o.quantity !== undefined,
    { message: "ADJUSTMENT needs signedQty, all other types need quantity" })
  .refine((o) => !["WASTAGE", "ADJUSTMENT"].includes(o.type) || !!o.reason,
    { path: ["reason"], message: "reason is required for this type" });
```

`TRANSFER_OUT`, `TRANSFER_IN` and `CLOSING` are not accepted here. They have
their own endpoints because they are never single-row operations.

```json
{ "itemId": "3c9a...", "outletId": "8b1f...", "type": "ISSUED",
  "quantity": 6, "businessDate": "2026-08-26",
  "note": "Morning momo prep" }
```

```json
{
  "id": "e51c8a90-3d77-4f2e-a0b1-6d2c9e77b402",
  "itemId": "3c9a...", "outletId": "8b1f...", "type": "ISSUED",
  "quantity": "6.000", "signedQty": "-6.000", "balanceAfter": "2.400",
  "businessDate": "2026-08-26", "reason": null, "note": "Morning momo prep",
  "sourceType": "MANUAL", "sourceId": null, "transferPairId": null,
  "createdById": "aa10...", "createdAt": "2026-08-26T05:44:02.881Z",
  "lowStockRaised": true
}
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | schema failure |
| 400 | `REASON_REQUIRED` | reason missing on `WASTAGE` or `ADJUSTMENT` |
| 403 | `FORBIDDEN` | `ADJUSTMENT` without `inventory.adjustment.create` |
| 404 | `ITEM_NOT_FOUND` | unknown item |
| 404 | `OUTLET_NOT_IN_SCOPE` | outlet outside caller scope |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | key reused with a different body |
| 409 | `OPENING_ALREADY_RECORDED` | second `OPENING` on the same date |
| 422 | `ITEM_INACTIVE` | item has `isActive: false` |
| 422 | `NEGATIVE_STOCK_BLOCKED` | `ISSUED` would leave the balance below zero |
| 422 | `FUTURE_BUSINESS_DATE` | `businessDate` after today in Asia/Kolkata |
| 422 | `BACKDATE_LIMIT_EXCEEDED` | more than 7 days back, or any backdate on `OPENING` |

Business rules, in the order the service applies them: idempotency replay,
schema parse, outlet scope, item exists and is active, business date window,
adjust permission, then the locked transaction from the algorithm section.
`lowStockRaised` on the response tells the UI whether an alert was queued, so it
can show "manager notified" instead of leaving the user guessing.

### GET /inventory/transactions

Permission `inventory.transaction.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.
The paged ledger.

```ts
export const listTransactionsQuery = pageQuery.extend({
  outletId: uuid.optional(),
  itemId: uuid.optional(),
  categoryId: uuid.optional(),
  type: z.enum(["OPENING","RECEIVED","ISSUED","WASTAGE","ADJUSTMENT",
                "TRANSFER_OUT","TRANSFER_IN","CLOSING"]).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  createdById: uuid.optional(),
}).refine((o) => !o.from || !o.to || o.from <= o.to,
  { path: ["to"], message: "to must not be before from" });
```

```json
{
  "data": [
    { "id": "e51c...", "businessDate": "2026-08-26", "type": "ISSUED",
      "item": { "id": "3c9a...", "name": "Chicken Mince", "unitCode": "KG" },
      "outletCode": "BM-SAHEED", "quantity": "6.000",
      "signedQty": "-6.000", "balanceAfter": "2.400",
      "reason": null, "note": "Morning momo prep",
      "createdBy": { "id": "aa10...", "name": "Sunil Behera" },
      "createdAt": "2026-08-26T05:44:02.881Z" }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 418 }
}
```

400 `DATE_RANGE_INVALID` when `to` precedes `from`. 400 `DATE_RANGE_TOO_WIDE`
above 92 days, which keeps the query on the `(outletId, businessDate)` index and
keeps the response under a megabyte. Default sort is `businessDate` descending
then `createdAt` descending.

### GET /inventory/items/:id/history

Permission `inventory.transaction.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.
The same rows as above, narrowed to one item and one outlet, with the derived
opening balance for the range so the client can render a running statement.

```ts
export const itemHistoryQuery = pageQuery.extend({
  outletId: uuid,
  from: businessDate,
  to: businessDate,
});
```

```json
{
  "item": { "id": "3c9a...", "name": "Chicken Mince", "unitCode": "KG" },
  "outletId": "8b1f...",
  "openingBalance": "8.400",
  "closingBalance": "2.400",
  "totals": { "received": "15.000", "issued": "6.000",
              "wastage": "0.000", "adjustment": "0.000",
              "transferIn": "0.000", "transferOut": "0.000" },
  "data": [ /* transactions, oldest first */ ],
  "meta": { "page": 1, "pageSize": 25, "total": 3 }
}
```

`openingBalance` is the `balanceAfter` of the last row before `from`, or
`"0.000"` when none exists. 404 `ITEM_NOT_FOUND`, 404 `OUTLET_NOT_IN_SCOPE`.

### GET /inventory/consumption

Permission `inventory.report.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.

```ts
export const consumptionQuery = z.object({
  outletId: uuid.optional(),
  categoryId: uuid.optional(),
  from: businessDate,
  to: businessDate,
  groupBy: z.enum(["item", "category", "day"]).default("item"),
});
```

```json
{
  "range": { "from": "2026-08-01", "to": "2026-08-26" },
  "definition": "ISSUED + WASTAGE",
  "data": [
    { "itemId": "3c9a...", "sku": "ITM-CHICKEN-MINCE",
      "name": "Chicken Mince", "unitCode": "KG", "categoryName": "Meat",
      "outletCode": "BM-SAHEED",
      "issued": "142.500", "wastage": "6.200", "consumed": "148.700",
      "avgPerDay": "5.719" }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 63 }
}
```

### GET /inventory/wastage

Permission `inventory.report.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.

```ts
export const wastageQuery = z.object({
  outletId: uuid.optional(),
  categoryId: uuid.optional(),
  perishableOnly: z.coerce.boolean().default(false),
  from: businessDate,
  to: businessDate,
  groupBy: z.enum(["item", "category", "reason"]).default("item"),
});
```

```json
{
  "range": { "from": "2026-08-01", "to": "2026-08-26" },
  "valuation": "latest ItemPriceHistory unit price on or before the wastage date",
  "totalValue": "4182.50",
  "data": [
    { "itemId": "9d21...", "name": "Paneer", "unitCode": "KG",
      "categoryName": "Dairy", "isPerishable": true,
      "quantity": "11.500", "unitPrice": "310.00", "value": "3565.00",
      "reasons": [ { "reason": "Left out overnight", "quantity": "8.000" },
                   { "reason": "Spoiled in transit", "quantity": "3.500" } ] }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 19 }
}
```

### POST /inventory/transfers

Permission `inventory.transfer.create`. Scope: caller must hold both outlets.
Accepts `Idempotency-Key`. Status 201.

```ts
export const createTransferSchema = z.object({
  itemId: uuid,
  fromOutletId: uuid,
  toOutletId: uuid,
  quantity: qty,
  businessDate: businessDate,
  note: z.string().trim().max(500).optional(),
}).strict()
  .refine((o) => o.fromOutletId !== o.toOutletId,
    { path: ["toOutletId"], message: "outlets must differ" });
```

```json
{ "transferPairId": "6f0b2c11-4e88-4e33-9a20-5d3b1c9e2a77",
  "out": { "id": "aa1...", "outletId": "8b1f...", "type": "TRANSFER_OUT",
           "signedQty": "-4.000", "balanceAfter": "4.400" },
  "in":  { "id": "bb2...", "outletId": "c740...", "type": "TRANSFER_IN",
           "signedQty": "4.000", "balanceAfter": "5.200" } }
```

| Status | Code | When |
|---|---|---|
| 404 | `ITEM_NOT_FOUND` | unknown item |
| 404 | `OUTLET_NOT_IN_SCOPE` | either outlet outside caller scope |
| 422 | `TRANSFER_SAME_OUTLET` | source equals destination |
| 422 | `ITEM_INACTIVE` | item is deactivated |
| 422 | `NEGATIVE_STOCK_BLOCKED` | source outlet does not have the quantity |
| 422 | `FUTURE_BUSINESS_DATE` | date after today |

### POST /inventory/closing

Permission `inventory.transaction.create`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.
Status 201.

```ts
export const recordClosingSchema = z.object({
  outletId: uuid,
  businessDate: businessDate,
  lines: z.array(z.object({
    itemId: uuid,
    countedQty: z.coerce.number().finite().nonnegative(),
  })).min(1).max(400),
}).strict()
  .refine((o) => new Set(o.lines.map((l) => l.itemId)).size === o.lines.length,
    { path: ["lines"], message: "duplicate itemId in lines" });
```

```json
{
  "outletId": "8b1f...", "businessDate": "2026-08-26",
  "itemsCounted": 63, "variancesRecorded": 4,
  "variances": [
    { "itemId": "3c9a...", "name": "Chicken Mince",
      "computed": "2.400", "counted": "2.000", "variance": "-0.400" }
  ]
}
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | duplicate item, empty lines, over 400 lines |
| 404 | `OUTLET_NOT_IN_SCOPE` | outlet outside caller scope |
| 409 | `CLOSING_ALREADY_RECORDED` | a `CLOSING` row exists for that item and date |
| 422 | `FUTURE_BUSINESS_DATE` | date after today |
| 422 | `BACKDATE_LIMIT_EXCEEDED` | closing is today only |

The whole request is one transaction. A conflict on any line rolls back every
line, so an outlet is never left half closed.

## Reports this module owns

The consumption report answers "how much chicken did Patia use last week".
Consumption is defined as the sum of `ISSUED` plus `WASTAGE` quantities.
`ADJUSTMENT` is excluded on purpose: an adjustment is a correction to the record,
not a statement that the ingredient was used, and folding count variances into
consumption would make the number drift every time someone recounts a shelf.
`TRANSFER_OUT` is also excluded, because stock sent to the other outlet was not
consumed, it moved. The definition string is returned in the response body so a
reader of the JSON never has to guess.

The wastage report groups by item, by category or by reason, filters to
perishable items on request, and prices each line to produce a value column. The
unit price is the most recent `ItemPriceHistory.unitPrice` for that item with
`observedOn` on or before the wastage date, across any vendor.

That valuation is an approximation and the response says so in the `valuation`
field. It is not FIFO costing and it is not weighted average costing. If paneer
was bought at Rs 280 last week and Rs 310 yesterday, the 11.5 kg written off
today is valued entirely at Rs 310 even though some of it came from the cheaper
lot. Doing this properly needs batch tracking, which needs a `StockBatch` model,
a batch selection rule on every issue, and a UI that asks a kitchen manager
which lot they are pulling from. That is not a Phase 1 conversation. The number
is good enough to tell the owner that paneer wastage cost roughly Rs 3,500 last
month and that it is the biggest line, which is the decision the report exists
to support.

## UI notes for the stock entry screen

The person using this screen is standing in front of an open fridge, holding a
tray in one hand and an Android phone in the other, in a kitchen that is 34
degrees. They are not sitting down and they are not going to zoom in.

Touch targets are at least 48 by 48 CSS pixels with 8 pixels of separation. The
quantity field opens a numeric keypad (`inputMode="decimal"`), never the full
keyboard. The transaction type is a row of large buttons, not a dropdown,
because a dropdown on Android costs two taps and a scroll.

Item search tolerates misspelling. The client filters an in-memory list of the
active item master (200 rows, roughly 12 KB of JSON, fetched once per session
and cached by TanStack Query) using a trigram similarity match, so "chiken",
"chikken" and "mince" all surface Chicken Mince. Server round trips per
keystroke on a 3G connection in a basement kitchen do not work.

Above the search box sits a recent-items strip: the last eight distinct items
this user transacted at this outlet, largest tap targets on the screen. In
practice a kitchen manager touches the same twelve items every day, and the
strip removes typing from the common path entirely.

The unit code renders inside the quantity field as a suffix, in the same type
size as the number. `6.000 KG` visible while typing prevents the single most
expensive data entry error in this system, which is entering grams into a
kilogram field and issuing 6,000 kg of chicken.

The submit path is offline-hostile by design. There is no optimistic success.
The button enters a disabled spinner state, the mutation carries an
`Idempotency-Key` generated with `crypto.randomUUID()` when the form is first
opened, and the success state renders only after the 201 arrives carrying
`balanceAfter`. The new balance is shown large, because it is the confirmation
the user actually wants: not "saved", but "there are now 2.4 kg left". On a
timeout the UI shows the failure and offers retry, which reuses the same
idempotency key, so a retry after a response that was lost in transit returns
the original transaction instead of double-issuing.

The wastage form is the only one with a required free-text field, and it offers
five preset reasons as chips (spoiled, dropped, over-prepped, expired, damaged
in transit) plus a text field. Chips make the reason data groupable in the
wastage report instead of 400 unique spellings of "spoilt".

## Failure modes

| Code path | Realistic production failure | Test covers it | Error handling exists | User experience |
|---|---|---|---|---|
| `applyTransaction` lock | Two staff issue the same item within 200ms | yes, concurrent integration test | yes, `FOR UPDATE` serialises | Second request waits then succeeds or gets 422 |
| `applyTransaction` lock | Lock wait exceeds the 10s statement timeout under a long report query | no | partial, Prisma error surfaces as 500 | Generic "something went wrong", retry works |
| Negative stock guard | Kitchen manager types 60 instead of 6 | yes, unit and e2e | yes | 422 with on-hand quantity in the message |
| Negative stock guard | Wastage drives balance negative, allowed by design | yes, unit | n/a, intentional | Row saved, stock list shows red negative |
| Low stock outbox insert | Outbox row written, dispatcher down for 40 minutes | no | yes, rows stay `PENDING` | Alert arrives late, nothing lost |
| Low stock cooldown | Clock skew makes `lastAlertAt` future-dated | no | no | Alerts suppressed silently until the timestamp passes |
| Idempotency replay | Redis is unavailable when the key is checked | no | no, throws | 500 on a submit that would have succeeded |
| Idempotency replay | Same key, different body | yes, e2e | yes | 409 `IDEMPOTENCY_KEY_CONFLICT` |
| Transfer pairing | Second outlet's lock times out, first row already inserted | yes, integration | yes, single `$transaction` rolls both back | 500, no partial transfer |
| Closing | Two managers submit closing for the same outlet at 23:00 | yes, e2e | yes, partial unique index | Second gets 409 `CLOSING_ALREADY_RECORDED` |
| Closing | 400 line request exceeds the 30s Railway request timeout | no | no | Request hangs then fails, nothing committed |
| Backdate window | Manager tries to enter last month's register | yes, unit | yes | 422 `BACKDATE_LIMIT_EXCEEDED` with the limit in the message |
| Item deactivation | Item retired with 3.2 kg on hand | yes, unit | yes, warning payload | Confirm dialog lists outlets with a balance |
| Wastage valuation | Item has never been purchased, no price history | yes, unit | yes, value returns `null` | Value column shows a dash, not zero |

The two rows with no handling and no test are the honest gaps: a Redis outage
during idempotency check-in turns a working write into a 500, and a 400 line
closing request has no batching. Both are tracked, neither blocks Phase 1 at two
outlets and 63 counted items.

## Test plan

Unit tests in `inventory.service.spec.ts`, against a mocked transaction client.

| Test | Assertion |
|---|---|
| `signs ISSUED negative` | `signedQty` is `-6.000` for a quantity of 6 |
| `signs RECEIVED positive` | `signedQty` is `15.000` |
| `CLOSING carries zero signedQty` | `signedQty` is 0, `balanceAfter` equals counted |
| `ADJUSTMENT takes the caller sign` | `signedQty` of `-0.4` is stored as `-0.400` |
| `rejects WASTAGE without reason` | throws `REASON_REQUIRED`, status 400 |
| `rejects ADJUSTMENT without reason` | throws `REASON_REQUIRED` |
| `blocks ISSUED below zero` | throws `NEGATIVE_STOCK_BLOCKED`, status 422 |
| `blocks TRANSFER_OUT below zero` | throws `NEGATIVE_STOCK_BLOCKED` |
| `allows ADJUSTMENT below zero` | commits, `balanceAfter` is `-1.500` |
| `allows WASTAGE below zero` | commits with reason present |
| `computes balanceAfter from locked read` | `balanceAfter` equals `before + signedQty` |
| `rejects future businessDate` | throws `FUTURE_BUSINESS_DATE` |
| `rejects backdate over 7 days` | throws `BACKDATE_LIMIT_EXCEEDED` |
| `rejects any backdate on OPENING` | throws `BACKDATE_LIMIT_EXCEEDED` |
| `raises LOW_STOCK on downward crossing` | one `OutboxEvent` with `eventKey: "LOW_STOCK"` |
| `does not raise while already below` | zero outbox rows on the second issue |
| `does not raise when reorderLevel null` | zero outbox rows |
| `does not raise inside cooldown` | `lastAlertAt` 3h ago, zero outbox rows |
| `raises again after cooldown` | `lastAlertAt` 13h ago plus a crossing, one row |
| `sets lastAlertAt when raising` | `lastAlertAt` updated to now |
| `no float arithmetic` | `0.1 + 0.2` inputs produce `0.300`, not `0.30000000000000004` |
| `consumption excludes ADJUSTMENT` | consumed equals issued plus wastage only |
| `wastage value null without price history` | `value` is `null`, not `0` |

Integration tests in `inventory.integration-spec.ts`, against a real Postgres
schema in a throwaway database.

| Test | Assertion |
|---|---|
| `concurrent issues serialise` | 10 parallel issues of 1 kg from 10 kg leave `qtyOnHand` at exactly `0.000` |
| `concurrent issue past zero blocks one` | 3 parallel issues of 4 kg from 10 kg produce 2 successes and 1 `NEGATIVE_STOCK_BLOCKED` |
| `ledger replays to the balance` | sum of `signedQty` for an item equals `ItemStock.qtyOnHand` after 200 random transactions |
| `balanceAfter is monotonic per item` | each row's `balanceAfter` equals the previous row's plus its `signedQty` |
| `transfer writes both rows or neither` | forced failure on the second insert leaves zero rows |
| `transfer pair shares transferPairId` | both rows return the same `transferPairId`, one `TRANSFER_OUT` and one `TRANSFER_IN` |
| `transfer lock ordering` | 50 opposing transfers between two outlets complete with zero deadlock errors |
| `duplicate CLOSING violates the index` | second insert raises a Postgres unique violation mapped to 409 |
| `duplicate OPENING violates the index` | same, mapped to `OPENING_ALREADY_RECORDED` |
| `closing variance writes ADJUSTMENT then CLOSING` | two rows, in that order, `CLOSING.balanceAfter` equals counted |
| `outbox row lands in the same transaction` | rollback of the stock write leaves zero `LOW_STOCK` rows |

End-to-end tests in `inventory.e2e-spec.ts`, supertest against the booted app
with seeded users for each role.

| Test | Assertion |
|---|---|
| `full day walkthrough` | opening 8, received 15, issued 6, wastage 0.4 leaves `qtyOnHand` at `16.600` and 4 ledger rows |
| `kitchen manager cannot adjust` | `ADJUSTMENT` as `KITCHEN_MANAGER` returns 403 |
| `kitchen manager can issue` | `ISSUED` as `KITCHEN_MANAGER` returns 201 |
| `counter cashier cannot transact` | 403 on `POST /inventory/transactions` |
| `cross outlet read is a 404` | Saheed-scoped user reading Patia stock gets 404, not 403 |
| `transfer needs both outlets` | single-outlet manager gets 404 `OUTLET_NOT_IN_SCOPE` |
| `same outlet transfer rejected` | 422 `TRANSFER_SAME_OUTLET` |
| `idempotent replay returns the first response` | same key twice returns identical `id` and creates one row |
| `idempotency conflict on changed body` | same key, quantity changed, returns 409 |
| `low stock notification reaches the manager` | after crossing, dispatcher run produces a `Notification` row for the outlet's Inventory Manager with `eventKey: "LOW_STOCK"` |
| `inactive item rejected` | 422 `ITEM_INACTIVE` on a transaction against a retired item |
| `lowStockOnly filter` | returns only rows below threshold plus every negative row |
| `history opening balance` | range starting after 3 transactions reports the correct `openingBalance` |
| `date range over 92 days rejected` | 400 `DATE_RANGE_TOO_WIDE` |
| `closing twice rejected` | second submit returns 409 and leaves the first intact |
