# Notification engine

FR-NOTIF-001 says the system dispatches in-app and WhatsApp notifications
automatically when a business event happens. The SRS adds two constraints that
shape every line of code in this chapter. Notifications are event driven: no
polling, no manual status checks, nobody opens a screen to find out whether
something happened. And the ERP database is always the system of record.
WhatsApp is a delivery channel, never a store.

That second sentence is the one people forget. If a WhatsApp message fails to
send, the notification still exists, the manager still sees it in the bell
menu, and the business record is unaffected. If Meta suspends the account on a
Tuesday, the product still works on Wednesday. The engine is built so that
WhatsApp is an optional output of a pipeline that is complete without it.

This is also the module with the widest blast radius. Inventory writes to it.
Tasks write to it. Leave, purchase, sales, checklists and the CRM all write to
it. If the dispatcher stops, nine workflows go quiet at once and nobody gets
an error message. Reliability here is worth more than features.

## The transactional outbox, from scratch

Every notification starts as a side effect of a database write. An employee
submits a leave request, so the manager should be told. The obvious code is:

```ts
await prisma.leaveRequest.create({ data });
await whatsapp.send(manager.phone, "leave_requested", vars);
```

That code is wrong in two different directions, and both of them happen in
production.

```text
  Without an outbox
  -----------------
  t0  BEGIN
  t1  INSERT LeaveRequest (PENDING)      <- business row written
  t2  COMMIT                             <- durable, request exists
  t3  POST graph.facebook.com/messages   <- container is redeployed
      .............................................................
      Result: the leave request exists and the manager was never
              told. Nothing anywhere records that a send was owed,
              so no retry is possible. The row looks fine.

  t0  POST graph.facebook.com/messages   <- WhatsApp goes out first
  t1  BEGIN
  t2  INSERT LeaveRequest                <- unique constraint fires
  t3  ROLLBACK
      .............................................................
      Result: the manager has been told about a leave request that
              does not exist. They open the app and find nothing.
```

Neither ordering is safe, because a database transaction and an HTTP call to
Meta cannot commit together. There is no distributed transaction available and
you would not want one at this size.

The transactional outbox removes the second system from the critical path. The
intent to notify is written as a row in the same database, inside the same
transaction as the business change. Delivery becomes a separate concern that a
background worker picks up afterwards.

```text
  With an outbox
  --------------
  t0  BEGIN
  t1  INSERT LeaveRequest (PENDING)
  t2  INSERT OutboxEvent  (LEAVE_REQUESTED, PENDING)
  t3  COMMIT               <- both rows land, or neither does
      ---------------------------------------------------------
  t4  crash, redeploy, Railway restart, Meta outage, whatever
      ---------------------------------------------------------
  t5  dispatcher wakes, finds the PENDING row, resolves, sends
  t6  UPDATE OutboxEvent SET status = 'DONE', processedAt = now()
```

The guarantee this buys is at-least-once delivery. The outbox row survives any
crash because it is ordinary committed data. It cannot exist for a business
change that rolled back, because it was written by the same transaction. It
can be delivered twice if the process dies between sending and marking DONE,
which is why the suppression rules later in this chapter exist.

The cost is latency. A notification is not sent at the instant of the commit,
it is sent on the next dispatcher tick. At a 15 second tick the worst case is
15 seconds plus send time. For a leave request or a low stock alert that is
invisible. If a workflow ever needs sub-second delivery, the outbox is the
wrong tool, and nothing in Phase 1 needs it.

## The pipeline end to end

```text
  POST /api/v1/leave/requests
        │
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │ LeaveService.request()      ONE Prisma $transaction     │
  │   1. INSERT LeaveRequest (status = PENDING)             │
  │   2. INSERT OutboxEvent  (LEAVE_REQUESTED, PENDING)     │
  └───────────────────────────┬─────────────────────────────┘
                              │ COMMIT
                              ▼
                     HTTP 201 returns here.
                     The caller never waits for delivery.
                              │
   every 15 seconds ──────────┼─────────────────────────────
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │ OutboxDispatcher.tick()                                 │
  │                                                         │
  │  1. claim  up to 50 rows, FOR UPDATE SKIP LOCKED        │
  │            PENDING -> PROCESSING, attempts += 1         │
  │  2. resolve recipients   resolvers[eventKey](payload)   │
  │  3. preferences          NotificationPreference lookup  │
  │  4. render               templates[eventKey](payload)   │
  │  5. insert               Notification, one per          │
  │                          (user x surviving channel)     │
  │  6. deliver              IN_APP: the row is delivery    │
  │                          WHATSAPP: WhatsAppService.send │
  │  7. finish               status -> DONE, processedAt    │
  └─────────────────────────────────────────────────────────┘
        │ any throw in steps 2 to 6
        ▼
  attempts < 5  ->  status PENDING, availableAt = backoff(n)
  attempts = 5  ->  status DEAD,    lastError recorded
```

Steps 2 through 5 are pure functions of the payload plus the current user and
preference tables. Step 6 is the only part that touches the outside world. That
split is deliberate: everything before step 6 is unit testable with no network
and no mocks beyond Prisma.

The producer side is a one line call. `OutboxService.emit` takes the Prisma
transaction client so it cannot accidentally be called outside the transaction.

```ts
// common/outbox/outbox.service.ts
@Injectable()
export class OutboxService {
  emit(
    tx: Prisma.TransactionClient,
    event: {
      eventKey: EventKey;
      aggregateType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    },
  ) {
    return tx.outboxEvent.create({ data: event });
  }
}
```

The rule for every service in the codebase: if a business write should notify
someone, the `emit` call sits inside the same `$transaction` block as the
write. Never after it, never in a `.then`, never in an event emitter.

## Recipient resolution

An outbox row knows what happened. It does not know who cares. A resolver is a
function registered per `eventKey` that turns an aggregate id and payload into
a list of user ids.

```ts
type Resolver = (
  payload: Record<string, unknown>,
  tx: PrismaClient,
) => Promise<string[]>;   // user ids, already de-duplicated

const resolvers: Record<EventKey, Resolver> = { /* ... */ };
```

Two helpers cover most cases. `usersWithRoleAtOutlet(roleKey, outletId)`
returns active users holding that role who are scoped to the outlet through
`UserOutlet`, plus OWNER and OPERATIONS_MANAGER are never included by these
helpers because they have `ALL_OUTLETS` scope and would otherwise receive every
alert in the business. `userForEmployee(employeeId)` returns the `Employee.userId`
if the employee has a login, and an empty list if they do not.

```sql
-- usersWithRoleAtOutlet('STORE_MANAGER', $outletId)
SELECT u.id
FROM   "User" u
JOIN   "UserOutlet" uo ON uo."userId" = u.id
WHERE  u."roleKey" = $1
  AND  u.status    = 'ACTIVE'
  AND  uo."outletId" = $2;
```

The full registry:

| eventKey | Resolver query |
|---|---|
| `LOW_STOCK` | `usersWithRoleAtOutlet('INVENTORY_MANAGER', outletId)` union `usersWithRoleAtOutlet('STORE_MANAGER', outletId)`, where `outletId` comes from the `ItemStock` row that crossed the threshold |
| `TASK_ASSIGNED` | `userForEmployee(task.assigneeId)`. Empty list if the task has no assignee or the assignee has no `User` |
| `TASK_OVERDUE` | `userForEmployee(task.createdById)` union `usersWithRoleAtOutlet('STORE_MANAGER', task.outletId)`, de-duplicated |
| `CHECKLIST_MISSED` | `usersWithRoleAtOutlet('STORE_MANAGER', task.outletId)` |
| `AUDIT_ITEM_FAILED` | `usersWithRoleAtOutlet('STORE_MANAGER', task.outletId)` union all active `OPERATIONS_MANAGER` users |
| `LEAVE_REQUESTED` | `usersWithRoleAtOutlet('STORE_MANAGER', employee.outletId)` and, if that returns nothing, all active `HR_ACCOUNTS` users |
| `LEAVE_DECIDED` | `userForEmployee(leave.employeeId)` |
| `PURCHASE_REQUESTED` | all active `PURCHASE_MANAGER` users, no outlet filter, because purchasing is centralised across both outlets |
| `PURCHASE_DECIDED` | `[purchaseRequest.requestedById]`, which is already a `User.id` |
| `PURCHASE_RECORDED` | `usersWithRoleAtOutlet('INVENTORY_MANAGER', purchase.outletId)` |
| `SALES_ENTRY_MISSING` | `usersWithRoleAtOutlet('STORE_MANAGER', outletId)` |
| `BROADCAST` | every active user in the message scope, see below |
| `REWARD_ISSUED` | none, the recipient is a `Customer` not a `User`, see the note below |
| `OPERATIONAL_ALERT` | `payload.userIds`, the explicit list the manager picked in the UI, filtered to active users |

Four of these need more than a table row.

`LOW_STOCK` scopes to the outlet of the `ItemStock` row, not the outlet of the
person who made the stock transaction. Those are the same today because staff
are single-outlet, but a transfer between outlets touches two `ItemStock` rows
and only one of them may cross its threshold. The payload carries `itemStockId`
and `outletId` so the resolver never has to guess.

`TASK_OVERDUE` unions the creator with the outlet Store Manager, and those are
frequently the same person: the Store Manager creates most tasks at their own
outlet. Without de-duplication that person gets two identical WhatsApp messages
for one late task, which is exactly the noise the SRS is trying to remove. The
resolver returns a `Set`, and the de-duplication test is in the test plan
below because this bug reappears every time somebody adds a recipient.

`BROADCAST` reads `Message.scope` from the payload and expands it:

```sql
-- scope = OUTLET
SELECT u.id FROM "User" u
JOIN "UserOutlet" uo ON uo."userId" = u.id
WHERE uo."outletId" = $outletId AND u.status = 'ACTIVE';

-- scope = DEPARTMENT
SELECT u.id FROM "User" u
JOIN "Employee" e ON e."userId" = u.id
WHERE e."departmentId" = $departmentId
  AND e.status = 'ACTIVE' AND u.status = 'ACTIVE';

-- scope = ALL
SELECT id FROM "User" WHERE status = 'ACTIVE';
```

In every case the sender is removed from the result. Nobody needs a
notification about their own broadcast.

> **Spec note:** `REWARD_ISSUED` has no resolver because
> `Notification.userId` is a foreign key to `User` and the recipient is a
> `Customer`. The dispatcher special-cases this key: it renders the template,
> calls `WhatsAppService.send` against `Customer.phone` directly, and records
> the provider reference on `OutboxEvent.payload.providerRef` before marking
> the row DONE. No `Notification` row is created. The alternative, making
> `Notification.userId` nullable and adding `customerId`, costs a migration and
> a nullable foreign key on the hottest read path in the module for one event.

## Preferences

`NotificationPreference` has one row per `(userId, eventKey, channel)` with an
`enabled` boolean and a unique constraint on the triple. Rows are sparse: a
user with no rows at all gets the defaults from the event table in chapter 21.

Resolution order for a given user, event and channel:

1. The channel must be a default channel for that `eventKey`. A user cannot opt
   in to WhatsApp for `PURCHASE_DECIDED` because no template exists for it.
2. If a `NotificationPreference` row exists for the triple, its `enabled` value
   decides.
3. Otherwise the channel is enabled.
4. `IN_APP` cannot be disabled for any event addressed to that user. The API
   rejects a write that tries with `CHANNEL_NOT_DISABLEABLE`, and the dispatcher
   ignores such a row if one ever appears through a migration.

Rule 4 exists because the in-app notification is the record, not just an alert.
Turning it off would mean a leave decision never appears anywhere the employee
can see it. WhatsApp is the channel a user is allowed to mute, and in practice
the ones they mute first are `TASK_ASSIGNED` and `BROADCAST`.

The dispatcher loads preferences for the whole recipient list in one query
rather than per user:

```sql
SELECT "userId", channel, enabled
FROM   "NotificationPreference"
WHERE  "eventKey" = $1 AND "userId" = ANY($2::uuid[]);
```

A user with `status` other than `ACTIVE` is dropped before this query runs. A
suspended account does not accumulate notifications.

## Delivery, retry and the dead letter

`OutboxStatus` is a four state machine.

```text
            claim (SKIP LOCKED)
   PENDING ────────────────────▶ PROCESSING
      ▲                              │
      │                              ├── success ──▶ DONE
      │  attempts < 5,               │
      └── availableAt = backoff ─────┤
                                     └── attempts = 5 ──▶ DEAD
```

`attempts` increments at claim time, not at failure time. If the process is
killed mid-send the row is left in PROCESSING with its attempt already counted,
and the retry sweep in [Background jobs](24-background-jobs.md) returns rows
stuck in PROCESSING for more than five minutes to PENDING. That ordering means
a crash loop cannot retry forever.

Backoff by attempt number: 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours.
After the fifth failure the row goes DEAD and stays there. Total window before
a permanent failure is roughly seven and a half hours, which covers a Meta
outage or an expired access token discovered overnight.

```ts
const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];

function nextAvailableAt(attempts: number): Date | null {
  if (attempts >= BACKOFF_SECONDS.length) return null;   // DEAD
  return new Date(Date.now() + BACKOFF_SECONDS[attempts] * 1000);
}
```

The claim query is the only piece of raw SQL in the module:

```sql
WITH claimed AS (
  SELECT id
  FROM   "OutboxEvent"
  WHERE  status = 'PENDING'
    AND  "availableAt" <= now()
  ORDER  BY "availableAt"
  FOR UPDATE SKIP LOCKED
  LIMIT  50
)
UPDATE "OutboxEvent" o
SET    status = 'PROCESSING',
       attempts = o.attempts + 1
FROM   claimed
WHERE  o.id = claimed.id
RETURNING o.*;
```

`FOR UPDATE` takes a row lock on each selected row for the length of the
statement's transaction. `SKIP LOCKED` tells Postgres to step over rows another
transaction already holds instead of waiting for them. With one dispatcher
running it does nothing at all. With two, which happens the first time somebody
sets Railway replicas to 2 or runs a manual trigger while the cron fires, the
two instances get disjoint batches instead of one blocking on the other and
then processing the same fifty rows. It is two words that make the design safe
under a deployment change nobody told you about.

The `@@index([status, availableAt])` on `OutboxEvent` is what keeps this query
an index scan. Without it the dispatcher does a sequential scan of every event
ever emitted, four times a minute, forever.

Rows that reach DEAD are visible to an administrator:

```text
GET /api/v1/notifications/dead-letter?page=1&pageSize=25
Permission: admin.outbox.read
```

The response is the outbox rows with `status = 'DEAD'`, newest first, including
`lastError` and the full payload. There is a companion
`POST /api/v1/notifications/dead-letter/:id/replay` guarded by
`admin.outbox.replay` that sets `status = 'PENDING'`, `attempts = 0` and
`availableAt = now()`. Replay is the correct response to a fixed access token.
It is the wrong response to a malformed payload, which needs a code change
first.

> **Spec note:** permission keys `admin.outbox.read` and
> `admin.outbox.replay` are introduced here for the dead-letter view. Both are
> OWNER only.

## Idempotency and duplicate suppression

At-least-once delivery means the same outbox row can be processed twice. The
system also has a second source of duplicates: the same business condition
being true on many consecutive writes. Stock at 1.8 KG against a reorder level
of 2.0 KG is below threshold on every issue transaction that day.

Three mechanisms handle this, and they live in different places on purpose.

The first is a uniqueness rule on the read model. A `Notification` row is
unique per `(userId, eventKey, aggregateId)` inside a suppression window
specific to the event key. The dispatcher checks before inserting:

```sql
SELECT 1 FROM "Notification"
WHERE  "userId" = $1 AND "eventKey" = $2
  AND  payload->>'aggregateId' = $3
  AND  "createdAt" > now() - $4::interval
LIMIT  1;
```

If a row comes back the dispatcher writes nothing and marks the outbox row
DONE. Default window is 5 minutes, which catches redelivery of the same outbox
row without suppressing a genuine second event hours later.

The second is a domain cooldown. `ItemStock.lastAlertAt` exists exactly for
this. The inventory service only emits a `LOW_STOCK` outbox row when the
balance crosses below `reorderLevel` **and** `lastAlertAt` is null or older
than 12 hours, and it stamps `lastAlertAt` in the same transaction:

```ts
if (
  stock.reorderLevel !== null &&
  newBalance.lt(stock.reorderLevel) &&
  (!stock.lastAlertAt || hoursSince(stock.lastAlertAt) >= 12)
) {
  await tx.itemStock.update({
    where: { id: stock.id },
    data:  { lastAlertAt: new Date() },
  });
  await outbox.emit(tx, {
    eventKey: 'LOW_STOCK',
    aggregateType: 'ItemStock',
    aggregateId: stock.id,
    payload: { /* ... */ },
  });
}
```

The third is a once-only guard. `Task.overdueNotifiedAt` is null until the
overdue sweep flags the task, and the sweep only emits `TASK_OVERDUE` for tasks
where it is still null. One late task produces one notification, ever, no
matter how many times the sweep runs before somebody closes it.

Why split this between the domain and the dispatcher. The domain knows the
business meaning of a duplicate: twelve hours of quiet on a low stock item is a
rule the client can change, and it belongs next to the stock rules where it can
be read and tested. The dispatcher knows nothing about momo. Its suppression is
purely technical, defending against its own at-least-once behaviour, and it
must work for event keys that do not exist yet. If you put the 12 hour rule in
the dispatcher you end up with a switch statement of business rules in
infrastructure code, and if you put redelivery suppression in the domain every
new event key has to reinvent it.

## Templates

A template is a pure function from payload to a title, a body, a deep link and
a WhatsApp variable list. They live in one registry file so the whole set of
user-facing notification copy can be read in one sitting.

```ts
// modules/notifications/templates/registry.ts
export interface RenderedNotification {
  title: string;
  body: string;
  deepLink: string;
  whatsapp?: { templateName: string; variables: string[] };
}

export type Template<P> = (payload: P) => RenderedNotification;
```

Three of the fourteen, in full:

```ts
export const lowStock: Template<LowStockPayload> = (p) => ({
  title: `Low stock: ${p.itemName}`,
  body:
    `${p.itemName} at ${p.outletName} is down to ${p.qtyOnHand} ${p.unitCode}. ` +
    `Reorder level is ${p.reorderLevel} ${p.unitCode}.`,
  deepLink: `/inventory/stock?outletId=${enc(p.outletId)}&itemId=${enc(p.itemId)}`,
  whatsapp: {
    templateName: 'low_stock_alert',
    // {{1}} item  {{2}} outlet  {{3}} on hand  {{4}} reorder level
    variables: [
      p.itemName,
      p.outletName,
      `${p.qtyOnHand} ${p.unitCode}`,
      `${p.reorderLevel} ${p.unitCode}`,
    ],
  },
});

export const taskAssigned: Template<TaskAssignedPayload> = (p) => ({
  title: 'New task assigned',
  body: `${p.title}. Due ${fmtIst(p.dueAt)}. Priority ${p.priority}.`,
  deepLink: `/tasks/${enc(p.taskId)}`,
  whatsapp: {
    templateName: 'task_assigned',
    // {{1}} task title  {{2}} outlet  {{3}} due time
    variables: [p.title, p.outletName, fmtIst(p.dueAt)],
  },
});

export const leaveDecided: Template<LeaveDecidedPayload> = (p) => ({
  title: `Leave ${p.status === 'APPROVED' ? 'approved' : 'rejected'}`,
  body:
    `Your ${p.leaveType} leave from ${fmtDate(p.fromDate)} to ` +
    `${fmtDate(p.toDate)} was ${p.status.toLowerCase()} by ${p.decidedByName}.` +
    (p.decisionNote ? ` Note: ${p.decisionNote}` : ''),
  deepLink: `/workforce/leave/${enc(p.leaveId)}`,
  whatsapp: {
    templateName: 'leave_decision',
    // {{1}} decision  {{2}} from  {{3}} to  {{4}} decided by
    variables: [
      p.status === 'APPROVED' ? 'approved' : 'rejected',
      fmtDate(p.fromDate),
      fmtDate(p.toDate),
      p.decidedByName,
    ],
  },
});
```

`enc` is `encodeURIComponent`. The rule is absolute: a template never
interpolates user-supplied text into a deep link unescaped. Item names, task
titles, decision notes and broadcast bodies are all typed by staff. A task
title containing `?outletId=other` would otherwise rewrite the query string of
the link, and a title containing a quote character would break the href in the
email-style rendering the frontend uses for the notification list. Ids go into
deep links, and every id goes through `enc`. Free text goes into `title` and
`body`, which the frontend renders as text nodes, never as HTML.

`fmtIst` formats a UTC timestamp in Asia/Kolkata, because a notification saying
"due 14:30" must mean 14:30 in Bhubaneswar. Chapter 12 owns the date helpers.

## The in-app read model

Six endpoints. All require a valid access token. All are scoped to the calling
user: there is no way to read another user's notifications, and no permission
grants it, not even OWNER.

### GET /api/v1/notifications

Permission: `notification.inbox.read`

Query: `?page=1&pageSize=25&unreadOnly=true&eventKey=TASK_ASSIGNED`

Returns the caller's `IN_APP` notifications, newest first. WhatsApp rows are
excluded because they are delivery records, not inbox items.

```json
{
  "data": [
    {
      "id": "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
      "eventKey": "LOW_STOCK",
      "title": "Low stock: Chicken Mince",
      "body": "Chicken Mince at BM-SAHEED is down to 1.800 KG. Reorder level is 2.000 KG.",
      "deepLink": "/inventory/stock?outletId=...&itemId=...",
      "readAt": null,
      "createdAt": "2026-08-26T09:14:02.117Z"
    }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 42 }
}
```

Served by `@@index([userId, readAt, createdAt])`. `pageSize` is capped at 100.

### GET /api/v1/notifications/unread-count

Permission: `notification.inbox.read`

```json
{ "count": 7 }
```

Cached in Redis for 15 seconds per user, invalidated on any write to that
user's notifications. See [Caching and performance](25-caching-and-performance.md).

### POST /api/v1/notifications/:id/read

Permission: `notification.inbox.update`

No body. Sets `readAt = now()` if it is null, otherwise does nothing. Returns
204. Returns 404 with `NOTIFICATION_NOT_FOUND` if the id does not exist or
belongs to another user. The two cases are indistinguishable from outside on
purpose.

### POST /api/v1/notifications/read-all

Permission: `notification.inbox.update`

Optional body `{ "eventKey": "TASK_ASSIGNED" }` to mark one category read.
Returns `{ "updated": 7 }`.

### GET /api/v1/notifications/preferences

Permission: `notification.preference.read`

Returns the full matrix for the caller, with defaults filled in for triples
that have no stored row, so the UI can render checkboxes without knowing the
default table.

```json
{
  "data": [
    { "eventKey": "LOW_STOCK", "channel": "IN_APP",   "enabled": true,  "locked": true },
    { "eventKey": "LOW_STOCK", "channel": "WHATSAPP", "enabled": true,  "locked": false },
    { "eventKey": "TASK_ASSIGNED", "channel": "WHATSAPP", "enabled": false, "locked": false }
  ]
}
```

`locked: true` means the UI renders the checkbox disabled. It is true for every
`IN_APP` row.

### PUT /api/v1/notifications/preferences

Permission: `notification.preference.update`

```json
{
  "preferences": [
    { "eventKey": "TASK_ASSIGNED", "channel": "WHATSAPP", "enabled": false }
  ]
}
```

Upserts each triple. Returns the same shape as the GET.

| Error | Status | When |
|---|---|---|
| `NOTIFICATION_NOT_FOUND` | 404 | id unknown or owned by another user |
| `INVALID_EVENT_KEY` | 400 | `eventKey` not in the event table in chapter 21 |
| `CHANNEL_NOT_DISABLEABLE` | 422 | attempt to set `IN_APP` to `enabled: false` |
| `CHANNEL_NOT_AVAILABLE` | 422 | channel is not a default channel for that event |
| `VALIDATION_FAILED` | 400 | zod rejection on the body |

> **Spec note:** permission keys `notification.inbox.read`,
> `notification.inbox.update`, `notification.preference.read` and
> `notification.preference.update` are held by every authenticated role, since
> every user has an inbox. Error codes `NOTIFICATION_NOT_FOUND`,
> `INVALID_EVENT_KEY`, `CHANNEL_NOT_DISABLEABLE` and `CHANNEL_NOT_AVAILABLE`
> are added to the chapter 15 registry.

### The bell badge

The web app polls `GET /notifications/unread-count` every 60 seconds through a
TanStack Query `refetchInterval`, plus once on window focus. Thirty users at
one request per minute is 30 requests per minute, served from a Redis key with
a 15 second TTL. That is 43,200 requests a day costing effectively nothing.

Websockets are not in Phase 1. A socket on Railway Hobby dies on every deploy
and every idle timeout, so the client needs reconnection logic, the server
needs to track connections, and the notification path grows a second delivery
mechanism that has to be tested. The value bought is reducing a 60 second worst
case to instant, on notifications that already took up to 15 seconds to leave
the outbox. Server-sent events are the upgrade if the client ever asks, and
they reuse the same read model.

## Failure modes

| Failure | How you notice | Effect | Response |
|---|---|---|---|
| Dispatcher cron not running | `OutboxEvent` PENDING count climbs, oldest `createdAt` ages past a minute | No notifications on any channel, business writes unaffected | Check job heartbeat, check advisory lock held by a dead session, restart the API service |
| Resolver returns an empty list | Outbox row goes DONE with zero `Notification` rows | Nobody told, silently | Dispatcher logs `recipients=0` at warn level with the event key and aggregate id |
| Employee has no `User` row | `TASK_ASSIGNED` resolves to nothing | Assignee never notified | Warn log, and the task board still shows the task |
| Meta token expired | Every WhatsApp send fails with 401 | WhatsApp dead, in-app fine | Rows retry for 7.5 hours then go DEAD, rotate the token and replay from the dead letter |
| Template throws on a missing payload field | Outbox row retries then goes DEAD | That one event key stops delivering | Payload shapes are zod-validated at emit time in dev and test, so this fails in CI not in production |
| Duplicate `LOW_STOCK` storm | Manager complains about repeated messages | Notification fatigue, staff mute the channel | `lastAlertAt` cooldown, verified by test |
| Row stuck in PROCESSING | Ages without moving to DONE | One notification lost | Retry sweep returns PROCESSING rows older than 5 minutes to PENDING |
| Outbox table growth | Table size in Supabase dashboard | Slower claim scans eventually | DONE rows older than 90 days are deleted by the archive job |

## Test plan

The suite that matters most is the transactional one.

Unit, no database:

1. Every `eventKey` in the event table in chapter 21 has a registered resolver and a
   registered template. A table-driven test iterates the enum, so adding a key
   without a resolver fails CI.
2. `TASK_OVERDUE` de-duplicates when the task creator is also the outlet Store
   Manager. Assert the resolver returns exactly one id.
3. `nextAvailableAt` returns the five expected offsets and null on the sixth.
4. Templates escape ids in deep links. Feed a payload with an item id of
   `a&b=c` and assert the deep link contains `a%26b%3Dc`.
5. Preference resolution: no row means default, a row wins, `IN_APP` cannot be
   disabled even if a row says so.

Integration, against a test database:

6. **A rolled back business transaction produces no notification.** Call
   `LeaveService.request` with a payload that violates a constraint on the
   second write, assert the call throws, then assert `OutboxEvent` count is
   zero and `Notification` count is zero. This is the test that proves the
   outbox is inside the transaction. It fails the moment somebody moves the
   `emit` call after the `$transaction` block.
7. A committed leave request writes exactly one `OutboxEvent` with
   `status = 'PENDING'`.
8. Running the dispatcher once turns that row DONE and inserts one
   `Notification` per resolved user per enabled channel.
9. Running the dispatcher twice over the same row inserts no second
   `Notification`, proving the suppression window.
10. A `WhatsAppService` stub that throws leaves the row PENDING with
    `attempts = 1` and `availableAt` about 30 seconds in the future.
11. Five consecutive failures leave the row DEAD and it does not appear in a
    sixth claim.
12. Two dispatcher instances started concurrently against 100 PENDING rows
    process 100 rows total, not 200. This is the `SKIP LOCKED` test and it uses
    two Prisma clients on separate connections.
13. Low stock emits once, then a second issue transaction within 12 hours emits
    nothing, then a third after `lastAlertAt` is backdated 13 hours emits again.

End to end, supertest:

14. `GET /notifications` returns only the caller's rows. Authenticate as user A,
    seed a notification for user B, assert it is absent.
15. `POST /notifications/:id/read` on another user's notification returns 404,
    not 403.
16. `PUT /notifications/preferences` disabling `IN_APP` returns 422 with
    `CHANNEL_NOT_DISABLEABLE`.
