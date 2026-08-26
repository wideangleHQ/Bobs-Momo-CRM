# Data model

One PostgreSQL 15 database on Supabase. 43 Prisma models, no views, no stored
procedures, no triggers. Every business rule lives either in a database
constraint or in a service method inside a transaction. This chapter tells you
which is which.

The canonical schema is the schema in chapter 10, which is also
`apps/api/prisma/schema.prisma`. This chapter does not restate every column
type. It gives you the shape of the graph, the reason each index and constraint
exists, and the queries you will write in your first week.

Two reading conventions. The field tables below omit `id` (UUID v4, database
default), `createdAt` (UTC timestamp, written once) and `updatedAt` (UTC
timestamp, maintained by Prisma `@updatedAt`), because they mean the same thing
everywhere. Models with three fields or fewer get a paragraph instead of a
table.

## Cluster map

Nine clusters. An arrow means "holds a foreign key into".

```text
                        ┌──────────────────────┐
                        │   identity and org   │
                        │  Outlet   Department │
                        │  User     Employee   │
                        └──┬────┬─────┬────┬───┘
        outletId           │    │     │    │   employeeId, outletId
       ┌───────────────────┘    │     │    └───────────────────┐
       ▼                        ▼     ▼                        ▼
 ┌───────────┐   itemId   ┌──────────────┐            ┌──────────────┐
 │ inventory │◀───────────│   purchase   │            │  workforce   │
 └─────┬─────┘            └──────┬───────┘            └──────┬───────┘
       │                         │                           │
       │      ┌───────────┐      │      ┌─────────────┐      │
       │      │   sales   │      │      │ task engine │◀─────┘
       │      └─────┬─────┘      │      └──────┬──────┘
       │            │            │             │
       └────────────┴─── OutboxEvent ──────────┘
                          │
                          ▼
            ┌────────────────────────────┐     ┌──────────────┐
            │ notification and messaging │     │ CRM and game │
            └────────────────────────────┘     └──────┬───────┘
                                                      │ redeemedOutletId
                    ┌───────────────────┐             │
                    │ audit  (AuditLog) │◀── every cluster writes here
                    └───────────────────┘     by entityType + entityId
```

`AuditLog` and `OutboxEvent` are deliberately not related by foreign key to the
rows they describe. They store `entityType` plus `entityId` and
`aggregateType` plus `aggregateId` as loose strings so that pruning a business
row can never be blocked by a log row, and so that a log row survives its
subject.

## Entity relationships by cluster

Read `A 1──* B` as "one A row, many B rows". `0..1` marks an optional side.

Identity and org:

```text
  Outlet ─┬─ 1──* Department ─ 1──* Employee
          ├─ 1──* Employee
          └─ 1──* UserOutlet *──1 User

  User ─┬─ 1──0..1 Employee        (a user may have no employee profile)
        ├─ 1──*    RefreshToken
        ├─ 1──*    Notification
        └─ 1──*    AuditLog
```

Inventory:

```text
  ┌──────────────┐ 1    * ┌───────────────┐ *    1 ┌──────┐
  │ ItemCategory │────────│ InventoryItem │────────│ Unit │
  └──────────────┘        └───┬───────┬───┘        └──────┘
                            1 │       │ 1
                    ┌─────────┘       └──────────┐
                  * ▼                          * ▼
           ┌─────────────┐            ┌──────────────────┐
           │  ItemStock  │            │ StockTransaction │
           └─────────────┘            └──────────────────┘
                  ▲ *                          ▲ *
                  └────── 1 Outlet 1 ──────────┘
```

Purchase and vendor:

```text
  Vendor ─┬─ 1──* VendorItem *──1 InventoryItem
          ├─ 1──* Purchase
          └─ 1──* ItemPriceHistory

  Outlet ─┬─ 1──* PurchaseRequest ─ 1──* PurchaseRequestLine *──1 Item
          └─ 1──* Purchase ─ 1──* PurchaseItem *──1 InventoryItem

  PurchaseRequest 1──0..1 Purchase        (soft link via requestId)
  Purchase        1──*    ItemPriceHistory (one row per line, on record)
```

Workforce:

```text
  Employee ─┬─ 1──* Shift *──1 Outlet
            ├─ 1──* AttendanceDay ─┬─ 1──* AttendancePunch
            │                      └─ 1──* BreakLog
            ├─ 1──* LeaveRequest
            └─ 1──* SalaryRecord
```

Task engine:

```text
  ChecklistTemplate ─┬─ 1──* ChecklistTemplateItem
                     ├─ 1──* TaskRecurrence
                     └─ 1──* Task

  TaskRecurrence 1──* Task

  Task ─┬─ 1──* TaskChecklistResult *──1 ChecklistTemplateItem (by id only)
        ├─ 1──* TaskComment
        ├─ 1──* TaskAttachment
        └─ 1──* Task            (parentTaskId, follow-up from a FAIL)

  Task *──1 Outlet      Task *──0..1 Employee (assignee)
                        Task *──1    Employee (creator)
```

Sales:

```text
  Outlet 1──* DailySalesEntry        (at most one row per business date)
```

Notification and messaging:

```text
  OutboxEvent            (no FK, polled by the dispatcher)
        │ produces
        ▼
  User ─┬─ 1──* Notification
        └─ 1──* NotificationPreference   (userId + eventKey + channel)

  Message ─ 1──* MessageRead *──1 User
  Message *──0..1 Outlet / Department / User, depending on scope
```

CRM and game:

```text
  GameConfig ─┬─ 1──* GamePlay *──0..1 Customer
              └─ 1──* RewardDefinition ─ 1──* RewardIssue *──1 Customer
```

Audit:

```text
  User 0..1──* AuditLog     (actorId nullable, actorLabel denormalised)
```

## Model reference

### Outlet

The physical shop. Two rows in production, and almost every operational query
filters by one of them.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| code | String | no | Stable business key, `BM-SAHEED` or `BM-PATIA`. Used in URLs, CSV imports and seeds. |
| name | String | no | Display name shown in the outlet switcher. |
| address | String | yes | Free text, printed on nothing in Phase 1. |
| timezone | String | no | Always `Asia/Kolkata`. Present so a third outlet in another state does not need a migration. |
| isActive | Boolean | no | Soft delete. An inactive outlet disappears from pickers but its history stays queryable. |

`code` is unique, which stops an import creating a second `BM-PATIA` and
splitting one shop's stock across two outlet ids. Rows are created by seed and
by `admin.outlet.create`. Nothing deletes them.

### Department

Kitchen, Counter, Store, Admin, scoped to one outlet. Fields are `outletId`,
`name` and `isActive`. The unique constraint on `(outletId, name)` prevents the
classic mess of "Kitchen" and "kitchen " existing side by side after two
managers add the same department. Created by seed, edited rarely, never
deleted.

### User

A login account. Separate from `Employee` on purpose: the owner has a user and
no shift, and a kitchen helper may have an employee record months before anyone
issues them credentials.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| email | String | yes | Optional, unique when present. Most floor staff have no work email. |
| username | String | no | Unique. The real login handle, lowercase, `firstname.lastname`. |
| passwordHash | String | no | argon2id. Never selected into any DTO. |
| status | UserStatus | no | `ACTIVE`, `SUSPENDED` (temporary, by a manager), `DISABLED` (left the company). |
| roleKey | RoleKey | no | Exactly one role per user. The permission matrix in chapter 14 expands it. |
| mustReset | Boolean | no | True on creation. The API rejects everything except password change until it is false. |
| failedLogins | Int | no | Counter, reset on success. |
| lockedUntil | DateTime | yes | Set after five failures. Login returns 401 with a generic message while set. |
| lastLoginAt | DateTime | yes | Read by the "dormant accounts" review, not by any business rule. |

`@@index([roleKey, status])` serves the admin user list filtered by role and the
notification fan-out that asks "every ACTIVE user with roleKey
INVENTORY_MANAGER". Users are created by `admin.user.create`, updated by admins
and by the user's own password change, and never deleted. Disabling sets
`status = DISABLED` and revokes refresh tokens.

### UserOutlet

A two column join table, `userId` and `outletId`, forming the composite primary
key. It is the entire outlet scoping model for `OWN_OUTLET` roles. `OWNER` and
`OPERATIONS_MANAGER` get every active outlet computed at login instead of rows
here, so nobody has to remember to add a row when outlet three opens. Deleting
a user cascades these rows away.

### RefreshToken

One row per issued refresh token. `tokenHash` is the sha256 of the opaque token
and is unique, so a stolen token cannot be re-registered. `familyId` groups a
rotation chain: presenting an already rotated token from a family revokes the
whole family, which is how the API detects token theft. `@@index([userId,
expiresAt])` serves logout-everywhere and the nightly cleanup. This is the one
model that is hard deleted, on a schedule, because expired rows have no
forensic value beyond what `AuditLog` already holds.

### Employee

The person. Attendance, shifts, leave, salary and tasks all hang off this, not
off `User`.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| userId | String | yes | Unique when set. One employee maps to at most one login. |
| employeeCode | String | no | Unique, `BM-EMP-0007`. Printed on the duty roster, used in CSV import. |
| fullName | String | no | As written on the ID proof. |
| phone | String | no | The WhatsApp destination. Ten digits, no country code stored. |
| outletId | String | no | Home outlet. Drives which manager approves their leave. |
| departmentId | String | yes | Nullable because a floater works across departments. |
| designation | String | yes | Free text, "Momo Chef", "Counter Cashier". Display only. |
| joinedOn | Date | no | Business date, not a timestamp. |
| exitedOn | Date | yes | Set together with `status = EXITED`. |
| status | EmploymentStatus | no | `ACTIVE`, `ON_NOTICE`, `EXITED`. |

`@@index([outletId, status])` is the roster query: every active employee at this
outlet, run on the attendance board, the shift planner and the task assignee
picker. Employees are created by HR, updated by HR and the store manager, and
never deleted, because attendance and task history point at them.

### Unit and ItemCategory

`Unit` holds `code` (unique, `KG`, `G`, `L`, `ML`, `PCS`, `PKT`) and `name`.
`ItemCategory` holds a unique `name`. Both are seeded reference data, both are
edited through the admin screens roughly never, and neither is deletable while
an item points at it. Uniqueness on the code and the name is what keeps the
importer from creating "Kg" next to "KG" and splitting a stock report in two.

### InventoryItem

The master item. It carries no quantity. Quantity lives per outlet in
`ItemStock`.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| sku | String | no | Unique, `ITM-CHICKEN-MINCE`. The natural key for imports and seeds. |
| name | String | no | What staff see. Can change without breaking anything. |
| categoryId | String | no | Restricts delete on `ItemCategory`. |
| unitId | String | no | The unit every quantity for this item is expressed in. Changing it after transactions exist is forbidden, because the ledger would mix KG and G. |
| isPerishable | Boolean | no | Drives the wastage report grouping and nothing else in Phase 1. |
| isActive | Boolean | no | Soft delete. Inactive items are hidden from pickers, kept in history. |

`@@index([categoryId, isActive])` serves the item list screen, which is always
filtered to active items and usually grouped by category. Items are created by
the week 1 CSV import and by `inventory.item.create` afterwards. Never deleted.

### ItemStock

The denormalised running balance, one row per item per outlet, plus the reorder
threshold.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| itemId | String | no | Part of the unique pair. |
| outletId | String | no | Part of the unique pair. |
| qtyOnHand | Decimal(14,3) | no | Current balance. Equal to the sum of `signedQty` over the ledger, always. |
| reorderLevel | Decimal(14,3) | yes | Null means no low stock alert for this item at this outlet. |
| lastAlertAt | DateTime | yes | Cooldown marker so a `LOW_STOCK` alert does not fire on every issue. |

`@@unique([itemId, outletId])` is the important one. Without it a race between
two concurrent first-time transactions creates two balance rows for the same
item and outlet, and from then on every stock number is wrong in a way nobody
notices for a month. `@@index([outletId])` serves the current stock screen.
Rows are created lazily on the first stock transaction for a pair, updated
inside that same transaction, and never deleted.

### StockTransaction

The append-only ledger. Never issue an `UPDATE` against this table. Corrections
are new `ADJUSTMENT` rows.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| itemId | String | no | What moved. |
| outletId | String | no | Where it moved. |
| type | StockTxnType | no | See the sign rules table below. |
| quantity | Decimal(14,3) | no | Always positive. What the user typed. |
| signedQty | Decimal(14,3) | no | `quantity` with the sign applied by type. The only column the invariant reads. |
| balanceAfter | Decimal(14,3) | no | `qtyOnHand` after this row committed. Lets the history screen render a running balance without a window function. |
| businessDate | Date | no | The trading day this belongs to, per chapter 12. Not the calendar date of `createdAt`. |
| reason | String | yes | Required for `WASTAGE`, `ADJUSTMENT` and a non-zero `CLOSING`. Enforced in the service, not the database. |
| note | String | yes | Free text. |
| sourceType | String | yes | `PURCHASE`, `TRANSFER`, `MANUAL`. |
| sourceId | String | yes | The purchase id when `sourceType` is `PURCHASE`. Deliberately not a foreign key. |
| transferPairId | String | yes | Shared UUID linking a `TRANSFER_OUT` row to its `TRANSFER_IN` row. |
| createdById | String | no | The user who recorded it. |

`@@index([outletId, businessDate])` serves the daily consumption and wastage
reports, which always scope to one outlet and a date range.
`@@index([itemId, outletId, createdAt])` serves the per item movement history
and the reconciliation job. There is no uniqueness constraint here, because two
identical wastage entries five minutes apart are legitimate. Double submission
is handled by the `Idempotency-Key` header instead, described in chapter 12.
Rows are inserted by the inventory service and by the purchase service. Nothing
updates or deletes them.

### Vendor and VendorItem

`Vendor` holds `name` (unique), `phone`, `email`, `address`, `gstin` and
`isActive`. Unique `name` is a blunt instrument, and it is deliberate: the
purchase manager types vendor names from memory, and two rows called "Saheed
Nagar Poultry" would split the price history for chicken in half and make the
price trend chart useless. `VendorItem` is a `(vendorId, itemId)` join table
that answers "who can supply this" on the purchase request screen. Deleting a
vendor cascades its `VendorItem` rows, but vendors are soft deleted in
practice, because purchases point at them.

### PurchaseRequest and PurchaseRequestLine

A request is what an outlet asks for. A purchase is what actually arrived.
They are separate because the two happen on different days, are recorded by
different people, and often disagree.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| requestNo | String | no | Unique, `PR-2026-0042`. Generated by the service, human quotable on the phone. |
| outletId | String | no | Who is asking. |
| status | PurchaseRequestStatus | no | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `FULFILLED`. |
| neededBy | Date | yes | Advisory. Not enforced anywhere. |
| requestedById | String | no | User id of the requester. |
| decidedById | String | yes | Set with `decidedAt` and `decisionNote` on the single approval step. |

`@@index([outletId, status])` drives the "open requests at my outlet" list, the
default screen for a purchase manager. Lines carry `requestId`, `itemId`,
`quantity` and `note`, and cascade delete with the request. A request is
created by a store or kitchen manager, decided once by a purchase manager, and
moved to `FULFILLED` by the purchase that references it. Never deleted after a
decision; cancelling sets the status.

### Purchase and PurchaseItem

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| purchaseNo | String | no | Unique, `PO-2026-0117`. |
| outletId | String | no | Receiving outlet. Stock lands here. |
| vendorId | String | no | Who supplied it. |
| requestId | String | yes | The request this fulfils, if any. |
| status | PurchaseStatus | no | `DRAFT` while being typed, `RECORDED` once stock has moved, `VOIDED` after a reversal. |
| invoiceNo | String | yes | Vendor's bill number. Not unique, vendors reuse them. |
| purchaseDate | Date | no | The date on the invoice, which may be yesterday. |
| subtotal, taxAmount, totalAmount | Decimal(14,2) | no | Money. Recomputed server side from the lines, never trusted from the client. |
| recordedById | String | no | User id. |
| voidedAt, voidReason | | yes | Set together. Voiding writes reversing `ADJUSTMENT` ledger rows, it does not delete anything. |

`@@index([outletId, purchaseDate])` serves the outlet purchase register.
`@@index([vendorId, purchaseDate])` serves the vendor statement and the price
trend. `PurchaseItem` holds `quantity`, `unitPrice` and `lineTotal`, cascades
with its purchase, and carries `@@index([itemId])` for "everything we ever
bought of this item". Only a `DRAFT` purchase can be edited or hard deleted; a
`RECORDED` one is immutable and can only be voided.

### ItemPriceHistory

One row per item per vendor per recorded purchase, written inside the purchase
transaction. It exists as a separate table rather than a query over
`PurchaseItem` because the price chart is the feature the owner asked for by
name, and it needs an index shaped for time series rather than for invoices.
Fields are `itemId`, `vendorId`, `unitPrice`, `observedOn` and the optional
`purchaseId`. `@@index([itemId, observedOn])` is exactly the chart query.
Append only.

### Shift

A planned duty. `employeeId`, `outletId`, `shiftDate` (business date),
`startsAt` and `endsAt` (UTC timestamps), `status`, `note`, `createdById`.
`@@unique([employeeId, shiftDate, startsAt])` stops the same person being
rostered twice into the same slot when two managers edit the roster at once.
`@@index([outletId, shiftDate])` is the roster screen. A cancelled shift keeps
its row with `status = CANCELLED` so the change is visible.

### AttendanceDay, AttendancePunch and BreakLog

`AttendanceDay` is one row per employee per business date, and it is the
rollup, not the raw record.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| employeeId, outletId | String | no | Who and where. |
| businessDate | Date | no | The 04:00 rule applies. A punch at 00:20 belongs to the previous day. |
| status | AttendanceStatus | no | Defaults to `ABSENT`. The rollup job or the first punch changes it. |
| firstInAt, lastOutAt | DateTime | yes | Derived from the punches, kept here so the board does not aggregate on every render. |
| workedMins, breakMins, lateMins | Int | no | Derived. Recomputed on every punch and by the nightly rollup. |

`@@unique([employeeId, businessDate])` is what makes the day a rollup rather
than a pile of rows, and it is the constraint that catches business-day bugs
first: get the date wrong and the second punch of the night collides.
`@@index([outletId, businessDate])` is the attendance board.

`AttendancePunch` is the append-only raw event: `direction` (`IN` or `OUT`),
`punchedAt`, `source` (`WEB` or `MANAGER_EDIT`), plus `editedById` and
`editReason` when a manager corrects a missed punch. `BreakLog` holds
`startedAt`, `endedAt`, `durationMins` and `reason`. Both cascade with their
`AttendanceDay` and both are indexed by it.

### LeaveRequest

`employeeId`, `type`, `fromDate`, `toDate`, `dayCount` as `Decimal(4,1)` so
half days are representable, `reason`, `status`, and the decision triple
`decidedById`, `decidedAt`, `decisionNote`. `@@index([employeeId, status])`
serves "my pending leave". `@@index([status, fromDate])` serves the manager
queue and the roster conflict check. There is no unique constraint on
overlapping dates, because Postgres exclusion constraints on ranges are more
machinery than two outlets need; the service checks for overlap inside the
transaction.

### SalaryRecord

Storage only, no payroll computation in Phase 1. `employeeId`,
`effectiveFrom`, optional `effectiveTo`, `monthlyCtc`, optional `basic` and
`allowances`, `note`, `createdById`. `@@index([employeeId, effectiveFrom])`
returns the history newest first. A revision inserts a new row and closes the
previous one with `effectiveTo`, so this is effectively append only. Read
access is restricted to `HR_ACCOUNTS` and `OWNER`.

### ChecklistTemplate and ChecklistTemplateItem

The template is the definition of a checklist: `code` (unique, `KITCHEN_OPEN`),
`name`, `description`, `isAudit`, an optional `outletId` where null means all
outlets, and `isActive`. Items carry `sortOrder`, `label`, `requiresPhoto`,
`requiresNote` and `failCreatesTask`. `@@unique([templateId, sortOrder])`
guarantees a stable, gap-free order, which matters because staff work down the
list on a phone and a reordering bug makes them skip a step. Items cascade with
their template. Editing a template does not rewrite completed runs, because
`TaskChecklistResult` stores the item id it answered.

### TaskRecurrence

The schedule that manufactures tasks. `cronExpr` is evaluated in
`Asia/Kolkata`, `templateId` links a checklist run, `dueAfterMins` sets the due
date relative to generation, and `lastRunAt` is the idempotency marker that
stops a redeploy generating today's opening checklist twice. Created by an
admin, updated by the generator job, deactivated rather than deleted.

### Task

The single work item type. One-off tasks, recurring instances, checklist runs
and audits are all rows here, distinguished by `kind`.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| kind | TaskKind | no | `ONE_OFF`, `RECURRING_INSTANCE`, `CHECKLIST_RUN`, `AUDIT_RUN`. |
| title, description | String | no / yes | Description is null for generated instances. |
| outletId | String | no | Scoping key. Every task belongs to exactly one outlet. |
| departmentId, assigneeId | String | yes | A task can be addressed to a department with no named person. |
| createdById | String | no | Employee id, not user id. The creator is a person on the roster. |
| templateId, recurrenceId | String | yes | Set for checklist runs and generated instances. |
| parentTaskId | String | yes | The follow-up task spawned by a failed checklist item. |
| status | TaskStatus | no | `OPEN`, `IN_PROGRESS`, `COMPLETED`, `VERIFIED`, `CANCELLED`, `OVERDUE`. |
| dueAt | DateTime | yes | UTC. Null means no deadline and no overdue sweep. |
| requiresVerification | Boolean | no | When true, `COMPLETED` is not terminal. Audits set this. |
| overdueNotifiedAt | DateTime | yes | Stops the sweep notifying the same task every five minutes. |
| businessDate | Date | no | Which trading day this task belongs to. |

Three indexes, three different questions. `@@index([outletId, status, dueAt])`
is the manager board. `@@index([assigneeId, status])` is the staff member's own
list, the most frequently hit query in the system. `@@index([status, dueAt])`
is the overdue sweep, which scans across all outlets every five minutes and
must not table scan. Tasks are created by managers, by the recurrence job and
by failed checklist items. They are never deleted; cancelling sets the status.

### TaskChecklistResult, TaskComment, TaskAttachment

`TaskChecklistResult` records one answer: `taskId`, `templateItemId`, `result`
(`PASS`, `FAIL`, `NA`), `note`, optional `attachmentId`, `recordedAt`. The
unique constraint on `(taskId, templateItemId)` makes the submit endpoint
naturally idempotent: a double tap upserts the same answer instead of writing
two. `TaskComment` is `authorId` plus `body`, indexed by `(taskId, createdAt)`
for the thread view. `TaskAttachment` stores the Supabase Storage
`storageKey`, `mimeType` and `sizeBytes`, never the bytes. All three cascade
with their task, which is the only cascade path that can actually run, since
tasks are not deleted.

### DailySalesEntry

Manual sales entry. One row per outlet per business date, no POS integration.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| outletId, businessDate | | no | The unique pair. |
| grossSales, discounts, netSales | Decimal(14,2) | no | `netSales` is recomputed server side as gross minus discounts and compared with the submitted value. |
| orderCount | Int | yes | Optional, some days the cashier does not have it. |
| cashAmount, upiAmount, cardAmount, otherAmount | Decimal(14,2) | no | The tender split. The service warns when the four do not sum to `netSales`, and stores it anyway with a note. |
| enteredById | String | no | User id of the cashier or manager. |
| lockedAt | DateTime | yes | Set 48 hours after the business date by a job. After that only `OWNER` can amend. |

`@@unique([outletId, businessDate])` is the whole point of the model: it makes
"one number per shop per day" a database fact, not a convention. It is also the
constraint that a business-day bug trips first, which is useful.
`@@index([businessDate])` serves the cross-outlet daily comparison.

### OutboxEvent

The transactional outbox. Written inside the same transaction as the business
change, polled by the dispatcher.

| Field | Type | Null | Meaning and rule |
|---|---|---|---|
| eventKey | String | no | One of the strings in chapter 21. |
| aggregateType, aggregateId | | no | What changed, as loose strings. No foreign key. |
| payload | Json | no | Everything the dispatcher needs, so it never has to re-read a row that may have changed since. |
| status | OutboxStatus | no | `PENDING`, `PROCESSING`, `DONE`, `DEAD`. |
| attempts, lastError | | no / yes | Retry bookkeeping. |
| availableAt | DateTime | no | Backoff marker. The dispatcher only picks up rows whose time has come. |

`@@index([status, availableAt])` is the dispatcher's only query and it runs
every ten seconds, so it has to be an index-only lookup. Append only in
practice: the dispatcher updates status and attempts, nothing else touches it,
and `DONE` rows are pruned on the schedule in chapter 12.

### Notification, NotificationPreference

`Notification` is the delivered artifact: `userId`, `eventKey`, `channel`,
`status`, `title`, `body`, `deepLink`, `payload`, `providerRef` (the WhatsApp
message id, needed to match delivery webhooks), `failReason`, `readAt`,
`sentAt`. `@@index([userId, readAt, createdAt])` serves the bell icon count and
the notification list in one shape. `@@index([status, channel])` serves the
retry sweep and the delivery dashboard. `NotificationPreference` is a per user,
per event, per channel on switch with a unique constraint on all three, which
stops the settings screen writing duplicate rows when a user taps twice.

### Message and MessageRead

Internal chat and broadcast. `scope` decides which of `recipientId`,
`outletId` and `departmentId` is populated, and the service validates that
exactly the right one is set, because the database cannot express that rule
without a check constraint per scope. `@@index([scope, outletId, createdAt])`
serves an outlet channel. `@@index([recipientId, createdAt])` serves a direct
thread. `MessageRead` is a `(messageId, userId)` composite key with a
timestamp, which is how unread counts are computed without a per user copy of
every message.

### Customer, GameConfig, GamePlay, RewardDefinition, RewardIssue

The CRM and game layer, reconstructed in chapter 32 from an SRS section that
does not exist. `Customer` is keyed by a unique `phone`, holds `coinBalance`
and a `consentAt` timestamp that gates every WhatsApp send. `GameConfig` holds
`rulesJson`, `isPublished` and an integer `version` so a published game can be
cached hard by slug and busted on version change. `GamePlay` records `score`,
`coinsEarned`, an anonymous `sessionKey` and a hashed IP, with indexes on
`(gameId, playedAt)` for the trend chart and `(customerId, playedAt)` for the
customer timeline. `RewardDefinition` has a unique `code` and a `coinCost`.
`RewardIssue` has a unique `couponCode`, which is the constraint that stops the
same coupon being handed to two customers, plus `status`, `expiresAt` and the
redemption triple. Guests play and earn nothing; coins require a verified
phone.

### AuditLog

Who did what, to what, from where. `actorId` is nullable and `actorLabel` is
denormalised text, so the log still reads correctly if the actor row is ever
removed. `action` is the permission-key-shaped string, `inventory.stock.adjust`.
`before` and `after` are JSON snapshots. Three indexes cover the three ways
anyone reads it: by entity (`entityType, entityId, createdAt`), by outlet
(`outletId, createdAt`) and by person (`actorId, createdAt`). Written by the
`AuditInterceptor` on every state-changing request. Append only.

## Design rules and why

### Money is Decimal(14,2), quantity is Decimal(14,3), Float is banned

`Float` is IEEE 754 binary. Rupees and paise are decimal. The conversion is
lossy in both directions, and the loss accumulates.

Take one vendor bill: seven packets of momo boxes at Rs 46.90 each. In double
precision, `7 * 46.90` is `328.29999999999995`. Display rounds it to 328.30 and
you see nothing wrong. Now sum a month of about 900 purchase lines with the
same arithmetic and the total drifts by a few paise. The purchase register
disagrees with the sum of the invoices, the owner spots it, and you spend an
afternoon proving the software is only wrong by four paise. With
`Decimal(14,2)` the multiplication is exact, the sum is exact, and there is
nothing to explain.

`14,2` gives 12 digits before the point, which is Rs 999 billion. `14,3` on
quantity gives three decimal places, which is grams when the unit is KG and
millilitres when the unit is L. Prisma returns these as `Prisma.Decimal`
objects, not numbers. Never call `Number()` on one before arithmetic. Use
`.add()`, `.sub()`, `.mul()` and compare with `.equals()` or `.cmp()`.

### UUID primary keys

Every id is a UUID v4 generated by the Postgres default. The costs are real: 16
bytes instead of 8, random insert order that fragments the B-tree and dirties
more pages than a monotonically increasing bigint, and larger indexes on every
foreign key.

The benefits win here. Ids are not guessable, so `/api/v1/purchases/117` cannot
be walked by a curious cashier. Seed and demo data can be written with fixed
ids and imported into any environment without collision. The CSV importer can
generate ids client side and retry a failed batch without gaps. At the volumes
in question, roughly 300 stock transactions and 200 tasks per day across two
outlets, or about five million rows over five years, the index bloat is not
measurable. If the ledger ever gets hot enough to care, UUID v7 keeps the
column type and restores insert ordering.

### Append-only ledgers

`StockTransaction`, `ItemPriceHistory`, `AttendancePunch`, `AuditLog` and
`OutboxEvent` are never updated in place. This is what makes a disagreement
resolvable: when the owner says the chicken count is wrong, you can replay
every row that touched it in order and point at the one that is wrong. Fixing
history by editing it destroys exactly the evidence you need. Corrections are
new rows with a reason.

### Soft delete via isActive

`Outlet`, `Department`, `InventoryItem`, `Vendor`, `ChecklistTemplate`,
`TaskRecurrence`, `RewardDefinition` and `User` (via `status`) are soft
deleted. Nothing that a ledger row points at is ever hard deleted, because a
deleted item turns six months of stock history into rows with a dangling name.
Every list endpoint filters `isActive: true` by default and accepts
`?includeInactive=true` for admin screens.

### The denormalised balance

`ItemStock.qtyOnHand` duplicates information already present in the ledger.
That is a deliberate trade. The current stock screen and the low stock check
run constantly and cannot afford to aggregate the ledger each time. The balance
is kept correct by three rules: it is only ever written inside the same
transaction as the ledger row that changes it, the row is locked with `SELECT
FOR UPDATE` before it is read (chapter 12), and a nightly job verifies it
against the ledger.

## The stock balance invariant

Formally, for every item `i` and outlet `o`:

```text
  ItemStock.qtyOnHand(i, o) = SUM( StockTransaction.signedQty )
                              over all rows where itemId = i
                                             and outletId = o
```

There is no exception, no rounding tolerance and no "except for closing
entries". If it does not hold, there is a bug, and the number on the screen is
wrong.

The verification query:

```sql
SELECT s."itemId",
       s."outletId",
       s."qtyOnHand",
       COALESCE(SUM(t."signedQty"), 0)                     AS ledger_qty,
       s."qtyOnHand" - COALESCE(SUM(t."signedQty"), 0)     AS drift
FROM   "ItemStock" s
LEFT   JOIN "StockTransaction" t
       ON   t."itemId"   = s."itemId"
       AND  t."outletId" = s."outletId"
GROUP  BY s."itemId", s."outletId", s."qtyOnHand"
HAVING s."qtyOnHand" <> COALESCE(SUM(t."signedQty"), 0)
ORDER  BY abs(s."qtyOnHand" - COALESCE(SUM(t."signedQty"), 0)) DESC;
```

An empty result set is the pass condition.

> **Spec note:** `apps/api/src/jobs/stock-reconcile.job.ts` runs this
> query nightly at 02:30 IST, which is inside the business day that started at
> 04:00 the previous morning but safely after the last closing entry. It is not
> in the job registry in chapter 24, and it should be.

The job runs the query, and for each drifting row writes an `AuditLog` entry
with `action = "inventory.stock.drift_detected"` and the before and after
numbers, then emits one `OPERATIONAL_ALERT` outbox event addressed to the
inventory manager and the operations manager summarising the count of drifting
items. It does not self-heal. Silently rewriting `qtyOnHand` to match the
ledger would hide the bug that caused the drift, and the drift itself is the
only signal that something is writing outside a transaction. A human decides
whether the fix is a code change, an `ADJUSTMENT` row, or both. In a correct
build this job finds nothing for months, which is exactly what you want from
it.

## Sign rules

`quantity` is what the user typed and is always positive. `signedQty` is what
the ledger sums. The service derives one from the other; the client never sends
`signedQty`.

| StockTxnType | signedQty | Reason required | Permission key |
|---|---|---|---|
| OPENING | positive | no | `inventory.transaction.create` |
| RECEIVED | positive | no | `inventory.transaction.create` |
| ISSUED | negative | no | `inventory.transaction.create` |
| WASTAGE | negative | yes | `inventory.transaction.create` |
| ADJUSTMENT | either | yes | `inventory.transaction.adjust` |
| TRANSFER_OUT | negative | no | `inventory.transfer.create` |
| TRANSFER_IN | positive | no | written by the system, paired |
| CLOSING | either | yes when non-zero | `inventory.stock.count` |

> **Spec note:** chapter 14 names
> `inventory.transaction.create` and `inventory.transaction.read`. The three
> additional keys above (`inventory.transaction.adjust`,
> `inventory.transfer.create`, `inventory.stock.count`) separate the dangerous
> operations from routine entry, so a kitchen manager can issue stock without
> being able to silently correct a balance.

Four rules that are not obvious from the table.

`OPENING` is not a daily entry. The ledger is perpetual, so yesterday's closing
balance is today's opening balance without a row. `OPENING` is used once per
item and outlet, during the week 1 migration from the paper register, and the
service rejects it if any prior row exists for that pair.

`TRANSFER_OUT` and `TRANSFER_IN` are written as a pair in one transaction, both
carrying the same freshly generated `transferPairId`. Neither exists without
the other. A transfer therefore never changes total stock across the business,
only its distribution.

`ADJUSTMENT` is the only way to correct history, and it always needs a reason
string. This is the row that appears when a count disagrees with the system and
someone decides the count is right.

`CLOSING` records a physical count. The API takes the counted quantity, and the
service writes `signedQty = counted - qtyOnHand` and `quantity =
abs(signedQty)`, so a perfect count writes a zero row and an imperfect one
writes the correction that makes the invariant hold. A non-zero closing entry
needs a reason, because it means something was consumed or lost without being
recorded.

## Queries you will write constantly

Current stock for an outlet, the inventory landing screen:

```ts
const stock = await prisma.itemStock.findMany({
  where: { outletId, item: { isActive: true } },
  select: {
    qtyOnHand: true,
    reorderLevel: true,
    item: { select: { id: true, sku: true, name: true,
                      unit: { select: { code: true } } } },
  },
  orderBy: { item: { name: 'asc' } },
});
```

Uses `ItemStock @@index([outletId])`, then joins about 200 item rows. No
pagination, because 200 rows is one screen with a client-side filter.

Stock movement for one item over a date range:

```ts
const moves = await prisma.stockTransaction.findMany({
  where: { itemId, outletId, businessDate: { gte: from, lte: to } },
  orderBy: { createdAt: 'asc' },
  select: { type: true, quantity: true, signedQty: true,
            balanceAfter: true, reason: true, businessDate: true,
            createdAt: true, createdById: true },
});
```

Uses `@@index([itemId, outletId, createdAt])`. The planner walks the two-column
prefix and filters `businessDate` on the fetched rows, which is fine because a
single item at a single outlet produces a few hundred rows a year.

Today's attendance board for an outlet:

```ts
const board = await prisma.attendanceDay.findMany({
  where: { outletId, businessDate: toBusinessDateUtc(new Date()) },
  include: {
    employee: { select: { employeeCode: true, fullName: true,
                          designation: true } },
  },
  orderBy: { employee: { fullName: 'asc' } },
});
```

Uses `@@index([outletId, businessDate])`. Note the business date helper from
chapter 12, not `new Date()` truncated.

Open tasks for the logged-in employee, the single most requested query in the
system:

```ts
const myTasks = await prisma.task.findMany({
  where: { assigneeId: employeeId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
  take: 50,
});
```

Uses `@@index([assigneeId, status])`. The sort is not covered by the index, but
the index narrows to under 20 rows before sorting.

Overdue sweep candidates, run every five minutes across all outlets:

```ts
const candidates = await prisma.task.findMany({
  where: {
    status: { in: ['OPEN', 'IN_PROGRESS'] },
    dueAt: { lt: new Date() },
    overdueNotifiedAt: null,
  },
  select: { id: true, title: true, outletId: true,
            assigneeId: true, createdById: true },
  take: 200,
});
```

Uses `@@index([status, dueAt])`, the index that exists only for this job. The
`take: 200` cap keeps one bad day from producing a 4,000 message WhatsApp
burst; the remainder is picked up on the next tick.

Price trend for one item:

```ts
const trend = await prisma.itemPriceHistory.findMany({
  where: { itemId, observedOn: { gte: from } },
  orderBy: { observedOn: 'asc' },
  select: { observedOn: true, unitPrice: true, vendorId: true },
});
```

Uses `@@index([itemId, observedOn])`, which is an index-only scan for this
select list plus the vendor id lookup.

Daily sales for the last 30 days:

```ts
const sales = await prisma.dailySalesEntry.findMany({
  where: { outletId, businessDate: { gte: from, lte: to } },
  orderBy: { businessDate: 'asc' },
  select: { businessDate: true, netSales: true, orderCount: true,
            cashAmount: true, upiAmount: true },
});
```

Uses the `@@unique([outletId, businessDate])` index. A unique constraint is a
B-tree index and the planner uses it like any other.

Unread notification count for the bell icon:

```ts
const unread = await prisma.notification.count({
  where: { userId, readAt: null, channel: 'IN_APP' },
});
```

Uses `@@index([userId, readAt, createdAt])`. The `(userId, readAt)` prefix
narrows to a handful of rows before `channel` is checked. This runs on every
page load, so it is also cached in Redis for 30 seconds with the key
`notif:unread:{userId}` and invalidated on write.

Low stock items needing an alert, for the digest job:

```ts
type LowStockRow = { itemId: string; sku: string; name: string;
                     qtyOnHand: Prisma.Decimal;
                     reorderLevel: Prisma.Decimal };

const low = await prisma.$queryRaw<LowStockRow[]>`
  SELECT s."itemId", i."sku", i."name", s."qtyOnHand", s."reorderLevel"
  FROM   "ItemStock" s
  JOIN   "InventoryItem" i ON i."id" = s."itemId"
  WHERE  s."outletId"     = ${outletId}::uuid
    AND  s."reorderLevel" IS NOT NULL
    AND  s."qtyOnHand"   <= s."reorderLevel"
    AND  i."isActive"     = true
    AND  (s."lastAlertAt" IS NULL
          OR s."lastAlertAt" < now() - interval '6 hours')
  ORDER  BY s."qtyOnHand" / NULLIF(s."reorderLevel", 0) ASC`;
```

Raw SQL because Prisma cannot compare two columns of the same row in a `where`
clause. Uses `@@index([outletId])` then filters. The six hour cooldown on
`lastAlertAt` is what stops a low item alerting on every single issue during a
lunch rush.

Purchase history for one vendor:

```ts
const purchases = await prisma.purchase.findMany({
  where: { vendorId, status: 'RECORDED', purchaseDate: { gte: from } },
  orderBy: { purchaseDate: 'desc' },
  include: { items: { include: { item: { select: { name: true } } } } },
  take: 25,
});
```

Uses `@@index([vendorId, purchaseDate])`. The nested include is two extra
queries under Prisma's relation loading, not a join, which is acceptable at
`take: 25` and would not be at `take: 1000`.
