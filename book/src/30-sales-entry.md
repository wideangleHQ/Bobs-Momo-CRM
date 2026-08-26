# Daily sales entry

The SRS asks for two things it never explains how to feed. The Management and
Analytics section lists a Daily Sales Summary and a P&L Overview. The
traceability matrix maps the client requirement "Sales data via WhatsApp" onto
them. Section 13, which holds every functional requirement in the document, has
FR blocks for authentication, inventory, purchase, workforce, tasks and
notifications. It has none for sales. There is no FR-SALES-001. Nothing in the
document says who types a sales figure, what fields it has, or when it becomes
final.

Open question 8 asks whether a POS system or API exists for sales ingestion at
all. Phase 1 assumes none. Sales are entered by hand, once per outlet per
business date, by a person standing at the counter after the last order.

That is not a decision this chapter is making. It is decision Q8 in
[chapter 04](04-decisions-register.md), confirmed by the owner, with the
consequence written down there: one totals row per outlet per day means no
per-item sales data, no dish-level margin, and no sales-versus-consumption
variance. This chapter builds the capture path that decision implies, and
supplies the requirement block the SRS is missing.

## What one row means

`DailySalesEntry` holds one row per outlet per business date. The row is the
entire sales record for that trading day. There are no line items, no bills, no
customer records attached to it. Six numbers and an order count.

The person entering it is reading from something. Whatever the counter uses to
total the day, a billing tablet that prints a day-end summary, a calculator
tape, or a hand-written cash book, the source document is rounded to the rupee.
That single fact drives the tolerance rule later in this chapter, so it is worth
holding on to.

## The model, field by field

```prisma
model DailySalesEntry {
  id            String   @id @default(uuid()) @db.Uuid
  outletId      String   @db.Uuid
  businessDate  DateTime @db.Date
  grossSales    Decimal  @db.Decimal(14, 2)
  discounts     Decimal  @db.Decimal(14, 2) @default(0)
  netSales      Decimal  @db.Decimal(14, 2)
  orderCount    Int?
  cashAmount    Decimal  @db.Decimal(14, 2) @default(0)
  upiAmount     Decimal  @db.Decimal(14, 2) @default(0)
  cardAmount    Decimal  @db.Decimal(14, 2) @default(0)
  otherAmount   Decimal  @db.Decimal(14, 2) @default(0)
  note          String?
  enteredById   String   @db.Uuid
  lockedAt      DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  outlet Outlet @relation(fields: [outletId], references: [id])

  @@unique([outletId, businessDate])
  @@index([businessDate])
}
```

| Field | Type | What it holds and who sets it |
|---|---|---|
| `outletId` | uuid | The outlet that traded. Set from the path or body, validated against the caller's outlet scope. |
| `businessDate` | date | The trading day in Asia/Kolkata, using the 04:00 IST boundary from [chapter 12](12-data-scoping-and-integrity.md). Not the calendar date of the keystroke. |
| `grossSales` | Decimal(14,2) | Total billed before discounts. Typed by the operator. |
| `discounts` | Decimal(14,2) | Total discount given across the day. Typed by the operator. Defaults to 0. |
| `netSales` | Decimal(14,2) | `grossSales - discounts`. Computed by the server. Never accepted from a client. |
| `orderCount` | int, nullable | Number of bills. Nullable because some closes genuinely do not have it, and a fake zero would poison average order value. |
| `cashAmount` | Decimal(14,2) | Cash collected. |
| `upiAmount` | Decimal(14,2) | UPI collected. In Bhubaneswar this is usually the largest of the four. |
| `cardAmount` | Decimal(14,2) | Card collected. |
| `otherAmount` | Decimal(14,2) | Aggregator settlements, credit, vouchers, and the rounding residual described below. |
| `note` | text, nullable | Free text. Where the operator explains a strange day. |
| `enteredById` | uuid | The `User.id` that submitted. Not the employee id. Set from the JWT, never from the body. |
| `lockedAt` | timestamp, nullable | Null means editable. Non-null means the row is final. Stamped by a job, cleared only by the Owner. |

Every money field is `Decimal(14, 2)`. Nothing here is a float. The Prisma
client returns `Decimal` objects and the service does its arithmetic on them.
An engineer who casts to `Number` to make a comparison read nicely has
introduced a rounding bug that will show up three weeks later as a payment split
that fails validation on a day where the numbers are obviously correct.

## The unique constraint

`@@unique([outletId, businessDate])` is the most valuable line in the model.

The mistake it prevents is not theoretical. At 23:20 the Store Manager at
BM-PATIA finishes the close and enters the day's sales on her phone. She goes
home. At 23:45 the Counter Cashier, who was not told she had already done it,
sees the reminder notification on his own phone and enters the same day from the
same printout. Without the constraint the database now holds two rows for
Tuesday at Patia. The dashboard sums them. The owner opens the app on Wednesday
morning and sees the best day the outlet has ever had.

Nobody catches this quickly. The numbers are individually plausible, the total
is wrong, and the error is invisible until someone reconciles against cash.

With the constraint, the second POST fails at the database level and the service
turns it into `409 SALES_ENTRY_EXISTS`. The web app catches that code and
navigates to the existing entry instead of showing a raw error, so the cashier
lands on the row the manager already typed and can compare it against his
printout. A near-miss becomes a second pair of eyes.

The same constraint covers the other duplicate source: a double tap on submit
over a weak 4G connection. Note that `POST /sales` does not take an
`Idempotency-Key` header. It does not need one. [Chapter 15](15-api-conventions.md) reserves that mechanism for `POST /purchases`, `POST /inventory/transactions` and
`POST /attendance/punch`, which have no natural key to collide on. Sales entry
has one.

## The entry workflow

At close, the outlet's Store Manager or Counter Cashier opens the sales entry
screen. It prefills `businessDate` with the current business date and calls
`GET /sales/:outletId/:date` to find out whether a row already exists. If one
does, the screen switches from create to edit and shows who entered it and when.

The operator types four things and optionally a fifth: gross sales, discounts,
the payment split across cash, UPI, card and other, and the order count.

`netSales` is not on the form. The screen shows it as a computed read-only
figure so the operator can sanity check it, and the server recomputes it from
`grossSales` and `discounts` on both create and update. The zod schema does not
declare a `netSales` key and the validation pipe runs schemas in strict mode, so
a client that sends one gets `400 VALIDATION_FAILED` naming the unknown field
rather than a silent overwrite.

There are two reasons to hold that line. The weak one is that a browser and a
server can disagree about rounding. The strong one is that the number the owner
reads on the dashboard must be derivable from the two numbers a human actually
typed. If `netSales` were client supplied, a stale tab, a half-fixed form or a
tampered request could store a net figure that contradicts its own inputs, and
no amount of staring at the row afterwards would reveal which of the three
numbers was the lie.

## The payment split and the one rupee tolerance

The four payment amounts must sum to `netSales`:

```text
  cashAmount + upiAmount + cardAmount + otherAmount  ==  netSales
```

Exact equality is the wrong rule. The printout the operator is reading rounds
each payment line to the nearest rupee, so four lines can drift away from the
printed net total by a rupee or two before anyone has made a mistake. Rejecting
those entries would train the operator to fudge a number until the form stops
complaining, which is worse than accepting the drift.

So the rule is a tolerance:

```ts
const split = cashAmount.plus(upiAmount).plus(cardAmount).plus(otherAmount);
const drift = split.minus(netSales).abs();
if (drift.greaterThan(TOLERANCE)) throw new PaymentSplitMismatch(drift);
```

`TOLERANCE` comes from `SALES_SPLIT_TOLERANCE_PAISE`, default `100`, which is
one rupee. It is an environment variable rather than a constant because nobody
has yet watched thirty real closes at these two outlets. If UAT in week 3 shows
the real printouts drifting further, the number moves without a deploy of new
logic. If it never drifts, the number can tighten.

One rupee is the starting value because in practice two of the four lines are
zero. Card and other are usually empty at a QSR counter; cash and UPI carry the
day. Two rounded lines drift by at most a rupee. A wider tolerance starts
swallowing real errors, and the error it swallows first is a transposition, for
example 4,850 typed as 4,580, which is exactly the mistake worth catching.

When a real drift exceeds the tolerance, the operator puts the residual in
`otherAmount` and writes what it was in `note`. That keeps the split honest and
leaves a trail. It does not paper over the difference, because the residual is
visible as a value in a field named "other" rather than hidden inside cash.

Failing this check returns `422 PAYMENT_SPLIT_MISMATCH` with the computed drift
in `details`, so the form can say "your payment lines are 340 rupees short"
instead of "invalid input".

## The lock

An entry is editable for 48 hours after the end of its business date, by the
Store Manager of that outlet or anyone with wider scope. The business date ends
at 04:00 IST the following calendar day, so a Monday entry stops being editable
at 04:00 IST on Thursday.

`sales-lock.job.ts` runs at 04:15 IST every day and stamps `lockedAt` on every
row where `lockedAt IS NULL` and `businessDate <= today - 3`. After that stamp,
`PATCH /sales/:id` returns `409 SALES_ENTRY_LOCKED`.

Only the Owner can undo it. `POST /sales/:id/unlock` requires
`sales.entry.unlock`, sets `lockedAt` to null, and writes an `AuditLog` row with
action `sales.entry.unlock`, the entry id, the outlet id, and the before and
after state. The entry re-locks at the next 04:15 IST sweep, so an unlock buys
the rest of the day to fix the number and then closes again by itself. There is
no permanent unlock and no way to unlock without leaving a name in the audit
log.

The lock exists in a system with no accounting integration, no ledger and no
statutory filing, which makes it fair to ask what it is protecting. It is
protecting trust in the numbers.

A figure that can change forever is a figure nobody can quote. If last month's
sales can be edited today, then the P&L the owner looked at on the 3rd is not
the P&L he will see on the 30th, the WhatsApp daily digest that went out on
Tuesday no longer matches the dashboard, and any conversation that starts with
"we did 62,000 on Saturday" ends with someone reopening the app to check. The
lock converts a mutable record into a statement. It also removes the quiet
option: without it, a manager having a bad week can improve a past day and
nobody would ever know.

Forty-eight hours is the window because a genuine correction is almost always
found the next morning, when someone reconciles the cash. Anything discovered
later than that is not a typo, it is a dispute, and a dispute should go to the
Owner and leave a record.

## The missing entry reminder

A daily sales system where the daily entry is optional produces gaps, and gaps
break every comparison in [chapter 31](31-analytics-and-reporting.md).

`sales-missing.job.ts` runs at 23:30 IST. For every `Outlet` where `isActive` is
true and no `DailySalesEntry` exists for the current business date, it inserts
an `OutboxEvent` with `eventKey` of `SALES_ENTRY_MISSING`, `aggregateType` of
`Outlet` and `aggregateId` of the outlet id. The dispatcher fans that out to the
Store Manager of that outlet over IN_APP and WHATSAPP, per the event key table
in this handbook. [Chapter 24](24-background-jobs.md) owns the job registry, the cron
registration and the alerting when a job fails to run.

23:30 IST is chosen because the outlets close around 23:00 and the reminder has
to land while somebody is still on site with the printout in their hand. A
morning reminder is a reminder to reconstruct from memory.

The job is safe to run twice. Before inserting, it checks for an existing
`SALES_ENTRY_MISSING` outbox row for the same outlet with `createdAt` at or
after the start of the current business day, and skips if one is there. A
redeploy at 23:29 that restarts the scheduler does not send two WhatsApp
messages to the same manager.

## The daily close sequence

Three things happen at close and their order matters.

```text
  22:45   Last order out
            │
            ▼
  23:00   ┌──────────────────────────────┐
          │ 1. Closing stock capture     │  POST /inventory/transactions
          │    count the fridge and the  │  type CLOSING, one row per
          │    dry store, item by item   │  counted item
          └──────────────┬───────────────┘
                         │  variance goes in first
                         │  as an ADJUSTMENT row
                         ▼
  23:10   ┌──────────────────────────────┐
          │ 2. Closing checklist run     │  PATCH /tasks/:id/checklist
          │    gas off, fryer drained,   │  CHECKLIST_RUN task from the
          │    fridge locked, floor done │  CLOSING template
          └──────────────┬───────────────┘
                         │  a FAIL item can spawn
                         │  a follow-up task
                         ▼
  23:20   ┌──────────────────────────────┐
          │ 3. Daily sales entry         │  POST /sales
          │    gross, discounts, split,  │  netSales computed server side
          │    order count               │  split checked to +/- 1 rupee
          └──────────────┬───────────────┘
                         ▼
  23:30   sales-missing.job  ──▶  SALES_ENTRY_MISSING
          fires only if step 3 did not happen
```

Stock is counted first because it is the step that gets skipped. It is physical,
it is cold, it takes fifteen minutes, and it is the last thing a tired closing
shift wants to do. Putting it before the till count means it happens while there
is still a reason to stay. Reversing the order produces outlets that reliably
enter sales and never enter closing stock, which quietly destroys the
consumption report.

The checklist sits in the middle because it is the shutdown procedure. Once the
gas is off and the fridge is locked, nobody is going back into the kitchen to
recount anything.

Sales entry is last because it needs the day-end total, which is printed after
the final bill, and because it is the one step that can be done sitting down.
The 23:30 sweep is deliberately close behind it.

## Endpoint reference

All six live in `apps/api/src/modules/sales/sales.controller.ts` under the base
path `/api/v1`. Every one of them runs `JwtAuthGuard`, `PermissionsGuard` and
`OutletGuard`. Outlet scope rules follow this handbook: a resource in
another outlet returns 404, never 403.

> **Spec note:** this chapter introduces the permission keys
> `sales.entry.create`, `sales.entry.read`, `sales.entry.update` and
> `sales.entry.unlock`. [Chapter 14](14-rbac-and-permissions.md) owns the role mapping. The intended mapping
> is create and update for `STORE_MANAGER` and `COUNTER_CASHIER` on their own
> outlet, read for those two plus `OPERATIONS_MANAGER`, `HR_ACCOUNTS` and
> `OWNER`, and unlock for `OWNER` alone.

> **Spec note:** the error codes `SALES_ENTRY_EXISTS`,
> `SALES_ENTRY_LOCKED`, `SALES_ENTRY_NOT_LOCKED`, `SALES_ENTRY_FUTURE_DATE`,
> `SALES_ENTRY_WINDOW_CLOSED`, `DISCOUNT_EXCEEDS_GROSS` and
> `PAYMENT_SPLIT_MISMATCH` are registered here. [Chapter 15](15-api-conventions.md) owns the registry.

### GET /sales

Permission `sales.entry.read`. Returns a paginated list of entries the caller is
allowed to see.

```ts
export const listSalesSchema = z.object({
  outletId: z.string().uuid().optional(),
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
```

Success, `200 OK`:

```json
{
  "data": [
    {
      "id": "9c1f4b62-2f0a-4a1e-8d33-51b7e2a0c944",
      "outletId": "c1a44e83-0d2b-4e7a-9f61-77c0a2b91e05",
      "outletCode": "BM-SAHEED",
      "businessDate": "2026-08-25",
      "grossSales": "62480.00",
      "discounts": "1230.00",
      "netSales": "61250.00",
      "orderCount": 412,
      "cashAmount": "18400.00",
      "upiAmount": "39850.00",
      "cardAmount": "3000.00",
      "otherAmount": "0.00",
      "note": null,
      "enteredBy": { "id": "b3f1...", "fullName": "Sunita Kar" },
      "lockedAt": null,
      "createdAt": "2026-08-25T17:52:11.402Z",
      "updatedAt": "2026-08-25T17:52:11.402Z"
    }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 61 }
}
```

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Query fails the schema, including unknown keys. |
| `OUTLET_NOT_IN_SCOPE` | 404 | `outletId` is supplied and the caller does not hold it. |
| `DATE_RANGE_TOO_LARGE` | 422 | `to - from` exceeds 366 days. |

Business rules:

1. With no `outletId`, results cover every outlet in the caller's scope.
2. With no `from` and `to`, the default window is the last 30 business dates.
3. Sort is `businessDate` descending, then `outletCode` ascending, so a
   two-outlet day reads as a pair.

### GET /sales/:outletId/:date

Permission `sales.entry.read`. The natural key lookup. The entry screen calls
this before rendering to decide whether it is creating or editing.

Success, `200 OK`, returns the single object shown above with no wrapper. A
missing entry is `404 NOT_FOUND`, which the web app treats as "no entry yet"
rather than an error. `date` is an ISO `YYYY-MM-DD` business date.

### POST /sales

Permission `sales.entry.create`. Creates the entry for one outlet and one
business date.

```ts
export const createSalesEntrySchema = z.object({
  outletId:     z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grossSales:   z.coerce.number().nonnegative().multipleOf(0.01),
  discounts:    z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  orderCount:   z.coerce.number().int().nonnegative().nullish(),
  cashAmount:   z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  upiAmount:    z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  cardAmount:   z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  otherAmount:  z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  note:         z.string().trim().max(500).optional(),
}).strict();
export type CreateSalesEntryDto = z.infer<typeof createSalesEntrySchema>;
```

Request:

```json
{
  "outletId": "c1a44e83-0d2b-4e7a-9f61-77c0a2b91e05",
  "businessDate": "2026-08-25",
  "grossSales": 62480.00,
  "discounts": 1230.00,
  "orderCount": 412,
  "cashAmount": 18400.00,
  "upiAmount": 39850.00,
  "cardAmount": 3000.00,
  "otherAmount": 0.00
}
```

Response `201 Created` returns the stored object including the server computed
`netSales` of `61250.00`.

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Schema failure, negative amount, more than two decimals, or an unknown key such as `netSales`. |
| `OUTLET_NOT_IN_SCOPE` | 404 | Caller does not hold `outletId`. |
| `SALES_ENTRY_EXISTS` | 409 | A row already exists for that outlet and business date. `details` carries the existing entry id. |
| `SALES_ENTRY_FUTURE_DATE` | 422 | `businessDate` is after the current business date. |
| `SALES_ENTRY_WINDOW_CLOSED` | 422 | `businessDate` is older than the current business date minus 2 and the caller does not hold `sales.entry.unlock`. |
| `DISCOUNT_EXCEEDS_GROSS` | 422 | `discounts > grossSales`. |
| `PAYMENT_SPLIT_MISMATCH` | 422 | Split drifts from `netSales` by more than the tolerance. |

Business rules:

1. Resolve the current business date with the 04:00 IST rule before any
   comparison. Do not use the server's calendar date.
2. Compute `netSales = grossSales - discounts` on `Decimal`, never on `Number`.
3. Validate the split against the computed `netSales`, not against `grossSales`.
4. Set `enteredById` from the JWT subject. Ignore any client supplied value.
5. Insert the row and an `AuditLog` row with action `sales.entry.create` inside
   one `$transaction`.
6. Catch the Prisma unique violation on `(outletId, businessDate)` and map it to
   `SALES_ENTRY_EXISTS`. Do not pre-check with a select and then insert. Two
   concurrent submits would both pass the pre-check.
7. Backfill older than two business dates is the Owner's job. Reusing
   `sales.entry.unlock` as the grant keeps the number of permission keys down
   and puts both "change history" powers in one place.

### PATCH /sales/:id

Permission `sales.entry.update`. Partial update of an unlocked entry.

```ts
export const updateSalesEntrySchema = createSalesEntrySchema
  .omit({ outletId: true, businessDate: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
```

`outletId` and `businessDate` are not patchable. Moving an entry to a different
day is not an edit, it is a delete and a create, and the unique constraint makes
the naive version fail in confusing ways.

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Schema failure or an empty patch body. |
| `NOT_FOUND` | 404 | No such entry, or it belongs to an outlet outside scope. |
| `SALES_ENTRY_LOCKED` | 409 | `lockedAt` is set. `details` carries `lockedAt`. |
| `DISCOUNT_EXCEEDS_GROSS` | 422 | Merged values fail the rule. |
| `PAYMENT_SPLIT_MISMATCH` | 422 | Merged values fail the tolerance. |

Business rules:

1. Merge the patch onto the stored row first, then validate the merged result.
   Patching `discounts` alone must be checked against the stored `grossSales`.
2. Recompute `netSales` on every patch that touches `grossSales` or `discounts`.
3. Recheck the payment split on every patch that touches any money field,
   including a patch that only changes `grossSales`, because the split is
   compared to `netSales`.
4. Write an `AuditLog` row with action `sales.entry.update` carrying the full
   before and after money fields. This is the record that answers "who changed
   Tuesday".

### POST /sales/:id/unlock

Permission `sales.entry.unlock`. Owner only in the intended role mapping. No
request body.

Success, `200 OK`, returns the entry with `lockedAt` set to null.

| Code | HTTP | Fires when |
|---|---|---|
| `NOT_FOUND` | 404 | No such entry. |
| `SALES_ENTRY_NOT_LOCKED` | 409 | `lockedAt` is already null. Returned rather than a silent success so a double click does not log two unlocks. |

Business rules:

1. Clear `lockedAt` and insert the `AuditLog` row in one transaction.
2. The audit `action` is `sales.entry.unlock` and `before` carries the previous
   `lockedAt`. Without that value the audit trail cannot show how long the entry
   had been final.
3. The next 04:15 IST sweep re-locks it. Unlocking does not need a matching
   re-lock endpoint.

### GET /sales/summary

Permission `sales.entry.read`. The roll up behind the sales module's own list
header. It is deliberately small: totals and a per-outlet split for a window,
with no comparisons and no series.

Query parameters are `from`, `to` and optional `outletId`. Maximum span is 92
days, and `DATE_RANGE_TOO_LARGE` fires above that.

```json
{
  "from": "2026-08-01",
  "to": "2026-08-25",
  "totals": {
    "netSales": "1482310.00",
    "grossSales": "1519880.00",
    "discounts": "37570.00",
    "orderCount": 9884,
    "entryCount": 50,
    "expectedEntryCount": 50,
    "paymentMix": {
      "cash": "441200.00", "upi": "952110.00",
      "card": "89000.00",  "other": "0.00"
    }
  },
  "byOutlet": [
    { "outletId": "c1a4...", "outletCode": "BM-SAHEED",
      "netSales": "812940.00", "orderCount": 5301, "entryCount": 25 }
  ]
}
```

`entryCount` against `expectedEntryCount` is the honesty field. It tells the
reader how many of the days in the window actually have a row, so a total that
looks low can be read as "a low week" or "three missing entries" without opening
another screen. Everything richer than this, comparisons, series and charts,
belongs to the analytics endpoints in
[chapter 31](31-analytics-and-reporting.md).

## If a POS arrives later

This is future scope, not Phase 1 work. It is written down so the shape of the
Phase 1 model can be defended.

`DailySalesEntry` survives a POS integration unchanged. Every report, the
dashboard, the P&L approximation and the missing-entry job read this table. A
POS gives the business per-bill and per-item detail, which is new data in new
tables, not a replacement for the daily aggregate. The owner still wants to open
one screen and see what the day did.

The integration is an adapter, not a rewrite:

```text
  POS vendor                 apps/api/src/modules/sales/adapters/
  ──────────                 ──────────────────────────────────────
  push or poll  ──────────▶  POST /integrations/pos/sales
                             HMAC-SHA256 signed, replay window
                                      │
                                      ▼
                             PosSaleLine  (new table, per bill line)
                                      │
                             nightly rollup at 04:20 IST
                                      │
                                      ▼
                             upsert DailySalesEntry
                             enteredById = system user
                             note = "ingested: <adapter> <runId>"
```

Three rules make the swap non-destructive. An ingested entry is written by a
dedicated system `User` so `enteredById` still answers "who". The rollup upserts
rather than inserts, so a day already entered by hand gets corrected rather than
duplicated, and the `AuditLog` row shows the manual value it replaced. The lock
sweep is unchanged, so ingested history becomes final on the same schedule as
typed history.

The expensive part of a POS arriving is not the code. It is the expectation gap
described in Q8 of [chapter 04](04-decisions-register.md): every report built
against daily totals will be asked to show item-level margin the day the item
data exists.

## Failure modes

| What goes wrong | How it shows up | What to do |
|---|---|---|
| Two people enter the same day | Second submit returns `SALES_ENTRY_EXISTS` | Working as designed. The web app routes the second person to the existing entry. |
| Operator types gross into the net field | Split fails by exactly the discount amount | The `PAYMENT_SPLIT_MISMATCH` detail names the drift. Form highlights both fields. |
| Split is short by a large round number | `PAYMENT_SPLIT_MISMATCH` with a drift matching one payment line | Usually a forgotten UPI figure. Operator re-reads the printout. |
| `sales-lock.job.ts` stops running | Entries older than 48 hours stay editable | [Chapter 24](24-background-jobs.md) alerts on a job that missed its window. The exposure is looser editing, not data loss. Re-run the job by hand; it is idempotent. |
| `sales-missing.job.ts` stops running | No reminder, gaps accumulate silently | Same job alert. `expectedEntryCount` on `GET /sales/summary` also exposes the gap. |
| Entry made against the wrong outlet | Numbers land on the other outlet's dashboard | Owner unlocks both entries, `PATCH` cannot move outlets, so the fix is a manual correct-and-recreate with two audit rows. |
| Business date computed from server calendar date | Entries made after midnight land on the wrong day | Caught by the test that submits at 00:30 IST. The 04:00 rule lives in one helper; nothing else may compute a business date. |
| Client sends `netSales` | `400 VALIDATION_FAILED` naming `netSales` | Strict zod schema. Fix the client. |
| Decimal cast to Number in the split check | Sporadic failures on large days | Lint rule bans `Number(` on Prisma `Decimal`. Covered by test 12 below. |

## Test plan

`apps/api/test/sales.e2e-spec.ts` and `sales.service.spec.ts`.

| # | Case | Expected |
|---|---|---|
| 1 | Create with gross 62480, discounts 1230, split summing to 61250 | 201, `netSales` is `61250.00` |
| 2 | Create with `netSales` in the body | 400 `VALIDATION_FAILED`, `details` names `netSales` |
| 3 | Create twice for the same outlet and date | Second call 409 `SALES_ENTRY_EXISTS` with the first entry's id in `details` |
| 4 | Two concurrent creates for the same outlet and date | Exactly one 201 and one 409. No pre-check race. |
| 5 | Split short by 0.75 rupees | 201. Inside tolerance. |
| 6 | Split short by 1.50 rupees | 422 `PAYMENT_SPLIT_MISMATCH`, `details.drift` is `1.50` |
| 7 | `discounts` greater than `grossSales` | 422 `DISCOUNT_EXCEEDS_GROSS` |
| 8 | Create for tomorrow's business date | 422 `SALES_ENTRY_FUTURE_DATE` |
| 9 | Create for 5 days ago as `STORE_MANAGER` | 422 `SALES_ENTRY_WINDOW_CLOSED` |
| 10 | Same call as `OWNER` | 201 |
| 11 | Submit at 00:30 IST with no `businessDate` override | Row lands on the previous calendar date |
| 12 | Create with gross 99999999.99 and a matching split | 201, stored value exact to the paisa, no float drift |
| 13 | Patch `discounts` only | `netSales` recomputed, split rechecked against the new net |
| 14 | Patch with an empty body | 400 `VALIDATION_FAILED` |
| 15 | Patch an entry with `lockedAt` set | 409 `SALES_ENTRY_LOCKED` |
| 16 | Run the lock sweep with an entry 3 business days old | `lockedAt` stamped |
| 17 | Run the lock sweep twice | Second run stamps nothing |
| 18 | Owner unlocks, patches, sweep runs next morning | Patch succeeds, `lockedAt` set again, two `AuditLog` rows exist |
| 19 | Unlock an already unlocked entry | 409 `SALES_ENTRY_NOT_LOCKED`, no second audit row |
| 20 | Unlock as `STORE_MANAGER` | 403 `FORBIDDEN` |
| 21 | Read an entry belonging to the other outlet as a scoped manager | 404 `NOT_FOUND`, response body names no outlet |
| 22 | Missing-entry job at 23:30 with one outlet unentered | Exactly one `SALES_ENTRY_MISSING` outbox row, for that outlet |
| 23 | Missing-entry job run twice in the same business day | Still one outbox row |
| 24 | Missing-entry job with an inactive outlet unentered | No outbox row |
| 25 | `GET /sales/summary` over a 400 day span | 422 `DATE_RANGE_TOO_LARGE` |
| 26 | `GET /sales/summary` over 10 days with 3 entries missing | `entryCount` 17, `expectedEntryCount` 20 |

Case 4 needs `Promise.all` on two real HTTP calls against the same test
database, not two service calls in one process. The point of the test is the
database constraint, and a mocked repository will pass it while production
fails.
