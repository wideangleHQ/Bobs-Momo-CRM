# Background jobs and scheduling

ADR-003 chose `@nestjs/schedule` cron plus a Postgres outbox table over BullMQ
on Upstash Redis. The reasoning is volume. This system produces something like
2,000 write operations a day across every module, and the heaviest recurring
work is a sweep over a few hundred open tasks. BullMQ buys durable queues,
priorities, delayed jobs, concurrency control and a dashboard, all of which are
worth having at ten thousand jobs an hour and none of which are needed at
ninety. What it costs is a second durability model that can disagree with the
database, a Redis dependency on the critical path of every notification, and a
worker process to deploy and watch. Postgres already gives durable rows,
`SKIP LOCKED` already gives safe concurrent claiming, and the outbox row is
already inside the business transaction. Cron plus a table is the smaller
system that does the job, and the migration to BullMQ, if volume ever justifies
it, replaces the dispatcher without touching a single producer.

Everything scheduled in this system lives in `apps/api/src/jobs/`. There is no
second process. The API container runs the HTTP server and the cron jobs
together.

## The job registry

Ten scheduled jobs. This table is the contract: if a job is not here, it does
not exist, and if it is here, the subsection below explains it.

| Job | Cron | TZ | What it does | Avg runtime | If skipped for a day | Idempotent |
|---|---|---|---|---|---|---|
| `outbox-dispatch` | `*/15 * * * * *` | UTC | Claims PENDING outbox rows, resolves recipients, renders, delivers | 40 to 300ms | Every notification in the system stops. Nothing is lost, everything is late | Yes |
| `notification-retry-sweep` | `0 */5 * * * *` | UTC | Returns rows stuck in PROCESSING for over 5 minutes to PENDING | under 20ms | A handful of notifications killed mid-send stay stuck | Yes |
| `overdue-tasks` | `0 */10 * * * *` | UTC | Flags open tasks past `dueAt` as OVERDUE, emits `TASK_OVERDUE` once | 30 to 150ms | Managers are not told about late work for a day | Yes, guarded by `overdueNotifiedAt` |
| `recurring-tasks` | `0 */15 * * * *` | Asia/Kolkata | Generates the next Task instance from each due `TaskRecurrence` | 20 to 100ms | Opening and closing checklists never appear. Staff have nothing to tick | Yes, guarded by `lastRunAt` |
| `stock-reconciliation` | `0 30 2 * * *` | Asia/Kolkata | Recomputes `ItemStock.qtyOnHand` from the ledger, logs drift | 200 to 800ms | Ledger drift goes undetected for a day | Yes, read-mostly |
| `attendance-rollup` | `0 45 3 * * *` | Asia/Kolkata | Closes yesterday's `AttendanceDay` rows, computes worked and late minutes | 100 to 400ms | Yesterday's attendance stays open with zeroed minutes. Reports are wrong until it runs | Yes, recomputes from punches |
| `refresh-token-cleanup` | `0 15 4 * * *` | Asia/Kolkata | Deletes expired and revoked `RefreshToken` rows | under 50ms | Table grows by a few hundred rows. Nothing breaks | Yes |
| `audit-log-archive` | `0 30 4 * * 0` | Asia/Kolkata | Archives `AuditLog` and DONE `OutboxEvent` rows older than 90 days | 1 to 4s | Nothing for weeks. Tables grow | Yes |
| `low-stock-digest` | `0 0 9 * * *` | Asia/Kolkata | One rollup message per outlet listing every item still below threshold | 50 to 200ms | Managers lose the morning summary. Real-time alerts still fire | Yes, one digest per outlet per day |
| `sales-entry-reminder` | `0 30 23 * * *` | Asia/Kolkata | Emits `SALES_ENTRY_MISSING` for outlets with no `DailySalesEntry` today | under 50ms | A missing sales figure is not chased. It surfaces in the morning report instead | Yes, one per outlet per business date |

Six-field cron expressions. `@nestjs/schedule` uses the `cron` package, which
puts seconds in the first field. `0 30 2 * * *` is 02:30:00, not every second of
minute 30. Getting this wrong is the single most common bug in this file, and
it presents as a job that runs 60 times instead of once.

## outbox-dispatch

Every 15 seconds. The full behaviour is in
[Notification engine](21-notification-engine.md). The ordered steps:

1. Acquire the advisory lock for `outbox-dispatch`. Return immediately if
   another instance holds it.
2. Claim up to 50 rows with the `FOR UPDATE SKIP LOCKED` query, moving them
   PENDING to PROCESSING and incrementing `attempts`.
3. For each row: resolve recipients, filter by preference, render the template,
   insert `Notification` rows, deliver per channel.
4. Mark DONE with `processedAt`, or reschedule with backoff, or mark DEAD.
5. Release the lock.

Idempotency argument: a row claimed twice is impossible within one tick because
of the row lock, and across ticks the `(userId, eventKey, aggregateId)`
suppression window stops a duplicate `Notification`. A row processed twice
after a crash sends at most one extra WhatsApp message, which is the accepted
cost of at-least-once delivery.

Failure behaviour: a throw inside the per-row work is caught per row, so one
bad payload does not stop the other 49. A throw outside the loop, such as the
database being unreachable, aborts the tick and the next tick retries in 15
seconds. Rows left in PROCESSING are rescued by the retry sweep.

## notification-retry-sweep

Every 5 minutes. Exists because `attempts` increments at claim time, so a
process killed between claim and completion leaves a row in PROCESSING with
nothing scheduled to touch it again.

```sql
UPDATE "OutboxEvent"
SET    status = 'PENDING',
       "availableAt" = now(),
       "lastError" = 'recovered from stuck PROCESSING'
WHERE  status = 'PROCESSING'
  AND  "createdAt" < now() - interval '5 minutes';
```

Idempotent because the predicate excludes rows already moved. Five minutes is
comfortably longer than any legitimate dispatch, which finishes in under a
second.

Failure behaviour: harmless to skip. The rows stay stuck until the next run.

## overdue-tasks

Every 10 minutes. Two writes, in one transaction per batch.

1. Select open work past its due time that has not been flagged:

```sql
SELECT id, "outletId", "createdById", "assigneeId", title, "dueAt"
FROM   "Task"
WHERE  status IN ('OPEN', 'IN_PROGRESS')
  AND  "dueAt" < now()
  AND  "overdueNotifiedAt" IS NULL
ORDER  BY "dueAt"
LIMIT  200;
```

2. For each: set `status = 'OVERDUE'` and `overdueNotifiedAt = now()`, and emit
   a `TASK_OVERDUE` outbox event, both in the same transaction.

The `@@index([status, dueAt])` on `Task` exists for this query and only this
query. Chapter 10 lists it as such.

Idempotency argument: `overdueNotifiedAt IS NULL` is the guard. Once set, the
task can never be selected again, so one late task produces exactly one
notification no matter how many times the job runs. A task that is completed
and then reopened past its due date keeps the old stamp and does not re-notify,
which is the correct trade: silence beats a second alert about something the
manager already knows.

Failure behaviour: skipping a run delays the alert by ten minutes. Skipping a
day means managers chase late work manually, which is what they do today.

## recurring-tasks

Every 15 minutes, in Asia/Kolkata, because the cron expressions stored in
`TaskRecurrence.cronExpr` are written by a manager thinking in local time. A
recurrence of `0 7 * * *` means the opening checklist appears at 07:00 in
Bhubaneswar.

1. Load active recurrences.
2. For each, compute the previous fire time of `cronExpr` in Asia/Kolkata.
3. Skip if `lastRunAt` is at or after that fire time.
4. Insert a `Task` with `kind = RECURRING_INSTANCE`, `templateId` copied from
   the recurrence, `dueAt = fireTime + dueAfterMins`, and `businessDate` set by
   the 04:00 IST business day rule from chapter 12.
5. Set `lastRunAt = fireTime`, not `now()`, in the same transaction.
6. If the recurrence has an `assigneeId`, the task insert emits `TASK_ASSIGNED`
   through the outbox.

Idempotency argument: step 3 compared against step 5. Storing the computed fire
time rather than the wall clock means a job that runs at 07:14 for an 07:00
recurrence records 07:00, so a second run in the same window does nothing. If
the container was down from 06:50 to 07:20, the run at 07:20 still sees the
07:00 fire time is unclaimed and creates the task, fourteen minutes late rather
than never.

The job never backfills more than one instance. If the service was down for
three days, the checklist for today appears and the two missed days do not.
Creating three days of stale opening checklists at once would be noise, and the
gap is visible in the audit view.

Failure behaviour: skipping a day means no checklists that day. This is the
highest-impact job in the registry after the dispatcher, because the client's
kitchen open and close process depends on it.

## stock-reconciliation

02:30 IST daily, before the trading day starts and after the previous one has
closed.

`ItemStock.qtyOnHand` is a running balance maintained by the inventory service
inside each stock transaction. `StockTransaction.signedQty` is the append-only
truth. They should be equal. This job checks.

```sql
SELECT s.id, s."itemId", s."outletId", s."qtyOnHand",
       coalesce(sum(t."signedQty"), 0) AS ledger_qty
FROM   "ItemStock" s
LEFT   JOIN "StockTransaction" t
       ON t."itemId" = s."itemId" AND t."outletId" = s."outletId"
GROUP  BY s.id
HAVING s."qtyOnHand" <> coalesce(sum(t."signedQty"), 0);
```

Any row returned is a bug. The job does not silently correct it: it logs each
drift at error level with the item, outlet, stored balance and ledger balance,
and emits an `OPERATIONAL_ALERT` to the OWNER. Auto-correcting would hide the
defect that caused it, and an unexplained overnight change to a stock balance
is worse than a known discrepancy.

Idempotency argument: it writes nothing except the alert, and the alert is
suppressed by the notification engine's window if the same drift is reported on
consecutive days.

Failure behaviour: a skipped run means a drift is discovered a day later. At
two outlets and a few hundred item-outlet pairs this query runs in under a
second, so it is cheap insurance against the class of bug that is hardest to
notice.

## attendance-rollup

03:45 IST daily. Runs after the 04:00 business day boundary has passed for the
previous day and before anyone starts a shift.

1. Select `AttendanceDay` rows for yesterday's business date.
2. For each, load its punches ordered by `punchedAt` and its break logs.
3. Pair IN with OUT punches. An unmatched trailing IN means somebody forgot to
   punch out: cap `lastOutAt` at the scheduled shift end from `Shift` if one
   exists, otherwise leave `lastOutAt` null and add a note.
4. Compute `workedMins` as paired time minus `breakMins`.
5. Compute `lateMins` as `firstInAt` minus the scheduled `startsAt`, floored at
   zero.
6. Set `status`: PRESENT if `workedMins` is at or above half the scheduled
   shift, HALF_DAY if between, ABSENT if there are no punches, and leave
   ON_LEAVE or WEEKLY_OFF untouched if already set by the leave module.
7. Write all six fields in one update per row.

Idempotency argument: every value is recomputed from `AttendancePunch` and
`BreakLog`, which the job does not modify. Running it five times gives the same
answer. That property is what makes the manual trigger safe, and it is worth
the small cost of recomputing rather than incrementing.

Failure behaviour: yesterday's attendance stays at `workedMins = 0` and
`status = ABSENT`, which makes the workforce report wrong until somebody
notices. Rerun it manually for the affected date, which is safe by the argument
above.

## refresh-token-cleanup

04:15 IST daily.

```sql
DELETE FROM "RefreshToken"
WHERE  "expiresAt" < now() - interval '7 days'
   OR ("revokedAt" IS NOT NULL AND "revokedAt" < now() - interval '30 days');
```

Expired tokens are kept seven days past expiry so that a reuse-detection
investigation has something to look at. Revoked tokens are kept thirty days
because a revoked token being presented is a security signal worth being able
to trace.

This is one of two places in the system that hard deletes rows, and the schema rules in chapter 10 name it
explicitly.

Idempotency: a delete with a time predicate is naturally idempotent.

Failure behaviour: skipping is harmless. Thirty users at a handful of sessions
each produce a few hundred rows a month.

## audit-log-archive

04:30 IST on Sunday. Weekly, not daily, because it is the only job that moves
meaningful volume and there is no reason to do it more often.

1. Copy `AuditLog` rows older than 90 days into `AuditLogArchive`, a table with
   the same shape and no indexes beyond the primary key.
2. Delete the copied rows from `AuditLog`.
3. Delete `OutboxEvent` rows with `status = 'DONE'` and `processedAt` older
   than 90 days. These are not archived: the business fact they described is
   already in the audit log and in the `Notification` table.

Both steps run in one transaction, in batches of 5,000, so a large first run
does not hold a long transaction.

> **Spec note:** `AuditLogArchive` mirrors `AuditLog` field for field
> with only a primary key index. Its purpose is to keep the hot `AuditLog`
> table small enough that the `(entityType, entityId, createdAt)` index stays
> in cache, while satisfying the SRS auditability requirement that key business
> actions remain recorded.

Idempotency: the age predicate means a repeat run finds nothing new to move.

Failure behaviour: skip it for a month and the tables are larger. At two
outlets the audit log grows by maybe 60,000 rows a year, so this job is
insurance for year three, not a necessity in month one.

## low-stock-digest

09:00 IST daily. Distinct from the real-time `LOW_STOCK` alert, and the
difference matters.

The real-time alert fires the moment a stock transaction pushes an item below
its reorder level, and it is suppressed for 12 hours afterwards by
`ItemStock.lastAlertAt`. That tells a manager about a change. The digest tells
them about a state: here is everything that is still below threshold this
morning, including items that went below threshold three days ago and have been
quiet since, because their alert already fired and their cooldown already
lapsed without a restock.

```sql
SELECT s."outletId", i.name, s."qtyOnHand", s."reorderLevel", u.code AS unit
FROM   "ItemStock" s
JOIN   "InventoryItem" i ON i.id = s."itemId"
JOIN   "Unit" u ON u.id = i."unitId"
WHERE  s."reorderLevel" IS NOT NULL
  AND  s."qtyOnHand" < s."reorderLevel"
  AND  i."isActive" = true
ORDER  BY s."outletId", i.name;
```

One `OPERATIONAL_ALERT` outbox event per outlet with a non-empty list, payload
carrying the item lines, addressed to that outlet's Inventory Manager and Store
Manager. Outlets with nothing below threshold get no message, because a daily
"all clear" trains people to ignore the sender.

Idempotency: one digest per outlet per day, keyed on the business date in the
payload, and the notification suppression window catches a repeat run.

Failure behaviour: managers lose the morning list. Real-time alerts continue,
so nothing is undetected, it is just less convenient.

## sales-entry-reminder

23:30 IST daily. `DailySalesEntry` is manual, one row per outlet per day
(decision 8 in chapter 04), and the entire analytics module depends on
it existing.

```sql
SELECT o.id, o.name
FROM   "Outlet" o
WHERE  o."isActive" = true
  AND  NOT EXISTS (
        SELECT 1 FROM "DailySalesEntry" d
        WHERE  d."outletId" = o.id AND d."businessDate" = $businessDate
  );
```

`$businessDate` is today's business date in Asia/Kolkata. One
`SALES_ENTRY_MISSING` event per outlet returned.

23:30 is chosen because both outlets close by 23:00 and the cashier is still on
site cashing up. A reminder at 23:30 gets acted on. A reminder at 06:00 the next
morning gets a guessed figure.

Idempotency: the `NOT EXISTS` check plus the notification suppression window.
If the entry lands at 23:29 nothing is sent.

Failure behaviour: a missing sales day is discovered by the analytics dashboard
showing a gap. Recoverable, because entries can be backdated until the 48 hour
lock.

## The single-instance problem

Railway can run more than one replica of a service. Somebody scales the API to
2 to handle a deploy without downtime, and every cron job in the registry now
runs twice, at the same second, on two containers.

For `outbox-dispatch` that is survivable because `SKIP LOCKED` makes the claim
safe. For `recurring-tasks` it means two identical opening checklists. For
`sales-entry-reminder` it means two WhatsApp messages. For `audit-log-archive`
it means two transactions fighting over the same 5,000 rows.

The fix is a Postgres advisory lock taken at the start of every job.

```text
  t=0.000  replica A          t=0.000  replica B
     │                            │
     ├─ pg_try_advisory_lock ──▶  ├─ pg_try_advisory_lock
     │     returns true           │     returns FALSE (A holds it)
     ▼                            ▼
   runs the job               returns immediately, logs "skipped"
     │
     ├─ ... work ...
     ▼
   pg_advisory_unlock
```

`pg_try_advisory_lock(key)` takes a bigint key from a single global namespace
shared by the whole database. It never blocks: it returns true if the lock was
acquired and false if another session holds it. The lock is held by the session
until `pg_advisory_unlock(key)` is called or the session ends, and it is
invisible to anything that does not ask for the same key. There are no rows and
no tables involved, which is why it is cheap enough to take four times a minute.

```ts
// jobs/job-lock.service.ts
const KEYS: Record<string, bigint> = {
  'outbox-dispatch':          1001n,
  'notification-retry-sweep': 1002n,
  'overdue-tasks':            1003n,
  'recurring-tasks':          1004n,
  'stock-reconciliation':     1005n,
  'attendance-rollup':        1006n,
  'refresh-token-cleanup':    1007n,
  'audit-log-archive':        1008n,
  'low-stock-digest':         1009n,
  'sales-entry-reminder':     1010n,
};

@Injectable()
export class JobLockService {
  private readonly log = new Logger(JobLockService.name);

  // Bound to DIRECT_URL, not the Supavisor pooler. See the note below.
  constructor(private readonly direct: DirectPrismaService) {}

  async withLock(name: string, fn: () => Promise<JobOutcome>) {
    const key = KEYS[name];
    if (key === undefined) throw new Error(`unregistered job: ${name}`);

    const [{ locked }] = await this.direct.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${key}) AS locked`;

    if (!locked) {
      this.log.debug(`${name}: lock held elsewhere, skipping this tick`);
      return;
    }

    const started = Date.now();
    try {
      const outcome = await fn();
      this.log.log(
        `job=${name} outcome=ok ms=${Date.now() - started} ` +
          `rows=${outcome.rows}`,
      );
    } catch (err) {
      this.log.error(
        `job=${name} outcome=error ms=${Date.now() - started}`,
        err as Error,
      );
    } finally {
      await this.direct.$queryRaw`SELECT pg_advisory_unlock(${key})`;
    }
  }
}
```

The rule: every method decorated with `@Cron` does nothing but call
`withLock('job-name', () => this.run())`. No exceptions. A job that forgets the
wrapper is a job that duplicates the day somebody scales a replica, and that
day will not be the day you are looking at this file.

One detail that will bite you. Advisory locks taken with
`pg_try_advisory_lock` are session-scoped, and application traffic goes through
Supavisor in transaction pooling mode, where a connection is handed back to the
pool after every statement. Acquire and release would land on different backend
sessions, so the release would fail and the lock would be held by an abandoned
session until it timed out. `JobLockService` therefore uses a small Prisma
client bound to `DIRECT_URL` on port 5432, the same connection string
migrations use, where a session is a session. One extra connection, and the
semantics are the ones the code assumes.

The alternative, `pg_advisory_xact_lock` inside a transaction, is safe under
transaction pooling but requires the whole job body to run in one transaction,
which is wrong for a job that makes HTTP calls or runs for seconds.

## Timezones

Seven of the ten jobs are business-time jobs. They must fire at a wall clock
time in Bhubaneswar.

`@nestjs/schedule` accepts a timezone per job:

```ts
@Cron('0 30 23 * * *', {
  name: 'sales-entry-reminder',
  timeZone: 'Asia/Kolkata',
})
async salesEntryReminder() {
  await this.locks.withLock('sales-entry-reminder', () => this.run());
}
```

Never rely on the container clock. Railway containers run UTC, and even if one
did not, "the server happens to be in the right timezone" is a fact that
survives exactly until a platform migration. India Standard Time is UTC+05:30,
so a job written as `0 30 23 * * *` with no timezone fires at 05:00 IST the
next morning, which for the sales reminder means messaging staff who left six
hours ago.

The offset is half an hour off the hour, which makes the mistake harder to spot
than usual: a job that should run at 09:00 IST and instead runs at 09:00 UTC
appears at 14:30 IST, a time that looks plausible on a log line.

The three jobs marked UTC in the registry are interval jobs. "Every 15 seconds"
and "every 10 minutes" mean the same thing in every timezone, and giving them a
timezone would be noise. Their `timeZone` option is omitted deliberately.

Business date computation inside a job is separate from cron scheduling. A job
that fires at 03:45 IST is working on yesterday's business date, and it uses
the chapter 12 helper rather than doing date arithmetic inline. The 04:00 IST
business day boundary means a job running at 03:45 and a job running at 04:15
disagree about what "today" is, which is correct and is why the boundary
exists.

## Observability

Every job emits one structured log line per execution, on success and on
failure, from the `withLock` wrapper so no job can forget:

```text
job=attendance-rollup outcome=ok ms=213 rows=28 startedAt=2026-08-26T22:15:00Z
job=outbox-dispatch  outcome=ok ms=64  rows=3  startedAt=2026-08-26T22:15:15Z
job=recurring-tasks  outcome=error ms=1902 startedAt=2026-08-26T01:30:00Z
```

Four fields, always: name, outcome, duration, rows affected. Duration is what
tells you a job is degrading before it starts failing. Rows affected is what
tells you a job ran but did nothing, which looks identical to a healthy run in
any other logging scheme.

Alerting is a log-based rule per job: no `job=<name> outcome=ok` line within
twice its interval. For `outbox-dispatch` that is 30 seconds, for
`overdue-tasks` 20 minutes, for the daily jobs 48 hours. Twice the interval
tolerates one missed run without paging anybody, and catches a job that has
genuinely stopped.

When somebody says "notifications stopped", the order of investigation:

1. Is there a recent `job=outbox-dispatch outcome=ok` line. If not, the
   dispatcher is not running: check the container is up and check whether an
   abandoned session holds advisory lock 1001.
2. If it is running, count PENDING rows in `OutboxEvent` and look at the oldest
   `createdAt`. A growing backlog with a running dispatcher means each tick is
   failing per row.
3. Count DEAD rows and read `lastError`. This is where an expired WhatsApp
   token shows up.
4. If the outbox is empty and DONE, the problem is upstream: the business
   service never emitted an event. Check the audit log for the business write
   and the outbox for a row with that `aggregateId`.
5. If notifications exist but nobody received them, check `Notification.status`
   and `failReason`, then the WhatsApp webhook.

That sequence walks the pipeline from the end nearest the symptom backwards,
and each step is a single query.

## Manual operation

One admin endpoint, because at 2am the alternative is running SQL by hand.

```text
POST /api/v1/admin/jobs/:name/run
Permission: admin.job.run   (OWNER only)
```

The `:name` must be a key in the job registry, otherwise 404 with
`JOB_NOT_FOUND`. The endpoint calls the same `withLock` wrapper the cron uses,
so a manual run during a scheduled run is skipped rather than doubled, and
returns the outcome:

```json
{ "job": "attendance-rollup", "outcome": "ok", "ms": 213, "rows": 28 }
```

Which jobs are safe to trigger by hand:

| Job | Safe manually | Note |
|---|---|---|
| `outbox-dispatch` | Yes | Sends anything pending immediately |
| `notification-retry-sweep` | Yes | Read and requeue only |
| `overdue-tasks` | Yes | Guarded by `overdueNotifiedAt` |
| `stock-reconciliation` | Yes | Reports, does not correct |
| `attendance-rollup` | Yes | Recomputes from punches, accepts a date parameter |
| `refresh-token-cleanup` | Yes | Time-predicated delete |
| `audit-log-archive` | Yes, but slow | Holds a transaction, avoid during business hours |
| `low-stock-digest` | Careful | Sends WhatsApp to two managers. Fine once, annoying five times |
| `sales-entry-reminder` | Careful | Same, and it messages people about a task they may have done |
| `recurring-tasks` | Careful | Cannot create a duplicate for the same fire time, but it will create the next instance early if the clock has passed the fire time |

The rule to state on the page next to the button: jobs that only read or that
carry a database-level guard are safe to run repeatedly. Jobs that send a
message to a human are safe once. Nothing in the registry is destructive.

## The trading day

```text
  IST   00        04        08        12        16        20        24
        |....|....|....|....|....|....|....|....|....|....|....|....|
                  ^                                              ^
                  |                                              |
          business day starts                              outlets close
             04:00 IST                                       ~23:00

  02:30  stock-reconciliation   ledger vs balance, quiet hours
  03:45  attendance-rollup      yesterday is final at 04:00
  04:15  refresh-token-cleanup  no users online
  04:30  audit-log-archive      Sundays only, longest job of the week
  07:00  (recurring) opening checklist task appears
  09:00  low-stock-digest       managers are on shift, shops open
  ...    lunch and dinner trade, no scheduled work
  22:00  (recurring) closing checklist task appears
  23:30  sales-entry-reminder   cashier is still cashing up
  ----------------------------------------------------------------
  every 15s   outbox-dispatch
  every  5m   notification-retry-sweep
  every 10m   overdue-tasks
  every 15m   recurring-tasks
```

The daily jobs cluster between 02:30 and 04:30 because that is the only window
with no staff and no customers, and because everything in it depends on the
previous business day being closed. The two that fire during trading hours,
09:00 and 23:30, are there because both send a message to a human who needs to
act on it, and a message that arrives when nobody is on shift is a message
nobody reads.

Nothing heavy runs between 11:00 and 22:00. That is deliberate: the database is
shared with the interactive application, and a Sunday archive job competing
with the lunch rush is a self-inflicted latency spike.

## Failure modes

| Failure | How you notice | Effect | Response |
|---|---|---|---|
| Two replicas, no advisory lock | Duplicate tasks, duplicate WhatsApp messages | Data and noise | `withLock` on every job, enforced by test |
| Advisory lock held by a dead session | Job silently skips every tick, logs "lock held elsewhere" | Job never runs and never errors | Query `pg_locks` for the key, terminate the orphan backend |
| Lock taken on the pooled connection | Unlock fails, lock leaks after one run | Same as above, but self-inflicted | `JobLockService` uses `DIRECT_URL` only |
| Six-field cron mistaken for five | Job runs 60 times a minute | Notification storm, database load | A test asserts each expression parses to the expected next fire time |
| Missing `timeZone` on a business job | Job fires 5.5 hours off | Reminder at the wrong time of day | A test asserts every business job declares `Asia/Kolkata` |
| Job throws every run | Error lines in the log, nothing else | Silent, because a failing job produces no user-visible error | Log-based alert on absence of `outcome=ok` |
| Job runs long and overlaps itself | Duration climbing toward the interval | Ticks skip because the lock is held, backlog builds | Duration is in every log line, alert at half the interval |
| Container down overnight | No job lines at all for hours | Checklists missing, attendance unrolled | Rerun the affected jobs manually, all are idempotent |
| Clock skew on the container | Jobs fire at odd times | Subtle, hard to see | Railway manages NTP, and every log line carries `startedAt` for comparison |

## Test plan

The trick with cron is to never test the schedule and the work together. Every
job splits into a decorated method that does nothing but acquire the lock and
call a plain service method, and the plain method holds all the logic. The
tests call the plain method directly, with no timers, no fake clock library and
no waiting.

```ts
@Injectable()
export class AttendanceRollupJob {
  @Cron('0 45 3 * * *', {
    name: 'attendance-rollup',
    timeZone: 'Asia/Kolkata',
  })
  handle() {
    return this.locks.withLock('attendance-rollup', () =>
      this.run(yesterdayBusinessDate()),
    );
  }

  // Everything below is a plain method. This is what the tests call.
  async run(businessDate: Date): Promise<JobOutcome> { /* ... */ }
}
```

Schedule tests, no database:

1. Every expression in the registry parses, and its next fire time from a fixed
   instant matches the expected wall clock in the declared timezone. This is
   the test that catches a five-field expression: `0 30 2 * * *` parsed as five
   fields fires at a different time than parsed as six.
2. Every job with a business-time schedule declares
   `timeZone: 'Asia/Kolkata'`. Reflection over the `@Cron` metadata, so a new
   job that forgets it fails CI.
3. Every registered job name has an entry in the `JobLockService` key map, and
   every key is unique.
4. Every `@Cron` method body calls `withLock`. Asserted by reading the metadata
   registry and checking each handler against a list, so a job cannot be added
   without a lock.

Logic tests, plain method against a test database:

5. `attendance-rollup` over a seeded day with two IN and two OUT punches and
   one 30 minute break produces the expected `workedMins`, `breakMins` and
   `lateMins`. Run it a second time and assert every field is unchanged. That
   second assertion is the idempotency test and it applies to every job in the
   registry.
6. `recurring-tasks` with `lastRunAt` set to the current fire time creates
   nothing. With `lastRunAt` null it creates exactly one task. Called twice in
   a row it creates one task total.
7. `overdue-tasks` over a task already carrying `overdueNotifiedAt` emits no
   outbox row.
8. `sales-entry-reminder` emits one event for the outlet with no entry and none
   for the outlet with one.
9. `stock-reconciliation` over a deliberately corrupted `ItemStock.qtyOnHand`
   returns one drift row and does not modify the balance.
10. `audit-log-archive` moves rows older than 90 days and leaves an 89 day old
    row in place. Boundary tests on date predicates catch off-by-one errors that
    silently delete a day of history.

Lock tests:

11. Two concurrent `withLock` calls on the same name, from two separate
    connections, run the body once. The second returns without calling it.
12. A body that throws still releases the lock. Assert a third call succeeds.
13. `withLock` with an unregistered name throws rather than running unguarded.
