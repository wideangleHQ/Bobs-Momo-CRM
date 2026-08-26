# Logging, monitoring and the audit trail

Three different things share this chapter because people confuse them constantly.

Logs are for engineers debugging a failure. They are noisy, they expire, and
nobody is accountable to them.

The audit trail is for the business. It answers "who reduced the chicken mince by
4 kg on Tuesday and why". It is append only, it is queryable from the admin
screen, and it is a requirement in the SRS non-functional table, not an
engineering nicety.

Monitoring is for knowing something is wrong before the client tells you.

## Structured logging

Every log line is a single JSON object on one line. Not a formatted string with
fields interpolated into it, because Railway's log search is a substring match and
grepping for a `requestId` inside prose is miserable.

These fields appear on every line:

| Field | Type | Example | Always present |
|---|---|---|---|
| `timestamp` | ISO 8601 UTC | `2026-09-14T09:52:11.418Z` | yes |
| `level` | string | `info` | yes |
| `requestId` | ULID | `01JK8Y3M2QW9V0X4` | yes, generated at the edge |
| `userId` | UUID or null | `4f2a...` | null on unauthenticated routes |
| `outletId` | UUID or null | `9c1b...` | null where not outlet scoped |
| `module` | string | `inventory` | yes |
| `action` | string | `transaction.create` | yes |
| `durationMs` | number | `47` | on request and job completion lines |
| `outcome` | string | `ok`, `client_error`, `error` | on completion lines |
| `msg` | string | `stock transaction recorded` | yes |

Anything else is extra context and goes under a `ctx` object, so the top level
shape never varies and log queries stay stable.

### Levels

| Level | Use for | Volume expected |
|---|---|---|
| `error` | Something failed that a human needs to look at. Unhandled exceptions, outbox events reaching DEAD, a job throwing, a database connection failure. | Zero per day is the target. |
| `warn` | Something recovered but is off. A retry succeeded, a rate limit fired, a WhatsApp send failed and will retry, a slow query over 1000 ms. | A handful per day. |
| `info` | Business events worth seeing in a log tail. Request completed, job started and finished, outbox event dispatched, user logged in. | A few thousand per day. |
| `debug` | Developer detail. SQL parameters, cache hit and miss, guard decisions. | Off in production. |

`LOG_LEVEL` is `info` in production and `debug` in local development. There is no
`trace`. Two people do not need five levels.

An `error` line always carries a stack trace under `ctx.stack` and the error code
under `ctx.code`. A `warn` never carries a stack trace, because a stack in a warn
line trains everyone to ignore stacks.

### Redaction

These fields must never reach a log line, an error message, or an exception that
gets serialised. The redaction helper strips them at the serialiser, so a
developer who logs a whole object by accident does not create a breach.

| Field | Why | Replacement |
|---|---|---|
| `passwordHash` | The argon2 hash is still a hash of a real password. | `[redacted]` |
| `password`, `newPassword`, `temporaryPassword` | Plaintext, obviously. | `[redacted]` |
| `accessToken`, `refreshToken`, `token` | A logged token is a usable session. | `[redacted]` |
| `tokenHash` | Enough to correlate sessions across users. | `[redacted]` |
| `authorization` header | Contains the bearer token. | `[redacted]` |
| `cookie` and `set-cookie` headers | Contains the refresh token. | `[redacted]` |
| `monthlyCtc`, `basic`, `allowances` | Salary. Nobody debugging a request needs it. | `[redacted]` |
| `phone` on `Customer` and `Employee` | Personal data, and a phone number is the customer identity in the CRM. | last 4 digits only, `******3421` |
| `WHATSAPP_ACCESS_TOKEN` and any value matching `EAA[A-Za-z0-9]{20,}` | A Meta token grants message sending on the client's business number. | `[redacted]` |
| `SUPABASE_SERVICE_KEY` and any `eyJ...` JWT-shaped string over 100 chars | Full storage access. | `[redacted]` |
| `couponCode` | It has cash value at the counter. | first 4 chars, `MOMO****` |
| `ip` in application logs | Kept in `AuditLog` only, where it has a purpose. | omitted |

```ts
// apps/api/src/common/logging/redact.ts
const REDACT_KEYS = new Set([
  'password', 'newpassword', 'temporarypassword', 'passwordhash',
  'accesstoken', 'refreshtoken', 'token', 'tokenhash',
  'authorization', 'cookie', 'set-cookie',
  'monthlyctc', 'basic', 'allowances',
  'whatsapp_access_token', 'supabase_service_key',
]);

const MASK_TAIL4 = new Set(['phone', 'recipientphone']);
const MASK_HEAD4 = new Set(['couponcode']);

const TOKEN_PATTERNS: RegExp[] = [
  /EAA[A-Za-z0-9]{20,}/g,             // Meta long-lived token
  /eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,  // JWT
  /postgres(?:ql)?:\/\/[^@\s]+@\S+/g, // connection string with credentials
  /rediss?:\/\/[^@\s]+@\S+/g,
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    let out = value;
    for (const p of TOKEN_PATTERNS) out = out.replace(p, '[redacted]');
    return out;
  }

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (REDACT_KEYS.has(key)) { out[k] = '[redacted]'; continue; }
      if (MASK_TAIL4.has(key) && typeof v === 'string') {
        out[k] = `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`;
        continue;
      }
      if (MASK_HEAD4.has(key) && typeof v === 'string') {
        out[k] = `${v.slice(0, 4)}****`;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }

  return value;
}
```

```ts
// apps/api/src/common/logging/logger.ts
import pino from 'pino';
import { redact } from './redact';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'bobs-momo-api', version: process.env.GIT_SHA ?? 'dev' },
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'msg',
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Second line of defence. The redact() helper handles nested shapes,
  // pino's own path redaction handles the common flat cases fast.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.passwordHash',
      '*.password',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
  hooks: {
    logMethod(args, method) {
      if (typeof args[0] === 'object') args[0] = redact(args[0]) as object;
      return method.apply(this, args as never);
    },
  },
});
```

There is a unit test that feeds a fully populated `User`, `SalaryRecord`,
`RewardIssue` and a raw WhatsApp request object through `redact()` and asserts
that none of the banned strings appear in the output. It is in the regression
critical list in [chapter 33](33-testing-strategy.md), because a redaction
regression is silent until it is a breach.

## Request logging and the requestId

A ULID is generated at the edge of every request, before anything else runs. It
goes into an `AsyncLocalStorage` context, onto the response as `X-Request-Id`, into
every log line, into the error envelope from
[chapter 15](15-api-conventions.md), and into the `OutboxEvent.payload`.

That last one is the useful part. When the client says "an employee got a leave
approval message but the leave still shows pending", you take the WhatsApp message
id, find the `Notification` row, read its `payload.requestId`, and grep the logs
for that ULID. You get the exact click that caused the message, the user who made
it, and every line the request produced.

```text
  Browser click "Approve leave"
        │  POST /api/v1/leave/9c1b.../decide
        ▼
  ┌─────────────────────────────────────────────────────┐
  │ RequestIdMiddleware                                  │
  │   requestId = ulid()          01JK8Y3M2QW9V0X4       │
  │   AsyncLocalStorage.run({ requestId, userId, ... })  │
  │   res.setHeader('X-Request-Id', requestId)           │
  └───────────────────────┬─────────────────────────────┘
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │ LoggingInterceptor  ──▶ log line, level=info,        │
  │                         module=leave action=decide   │
  └───────────────────────┬─────────────────────────────┘
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │ LeaveService.decide()   inside one $transaction:     │
  │   1. UPDATE LeaveRequest  status = APPROVED          │
  │   2. INSERT AttendanceDay x3   status = ON_LEAVE     │
  │   3. INSERT AuditLog      action = workforce.leave.  │
  │                                    decide            │
  │   4. INSERT OutboxEvent   eventKey = LEAVE_DECIDED   │
  │        payload.requestId = 01JK8Y3M2QW9V0X4  ◀───────┼── carried
  └───────────────────────┬─────────────────────────────┘
                          ▼  commit
  ┌─────────────────────────────────────────────────────┐
  │ OutboxDispatcher (cron, 10 s)                        │
  │   claims the row, logs with                          │
  │   requestId = payload.requestId  ◀───── same ULID    │
  │   INSERT Notification (IN_APP, WHATSAPP)             │
  └───────────────────────┬─────────────────────────────┘
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │ WhatsAppAdapter.send()                               │
  │   log line: requestId=01JK8Y3M2QW9V0X4               │
  │             providerRef=wamid.HBgM...                │
  └─────────────────────────────────────────────────────┘

  Trace back:  wamid  ──▶ Notification.providerRef
                      ──▶ Notification.payload.requestId
                      ──▶ grep logs for 01JK8Y3M2QW9V0X4
                      ──▶ the click, the user, the outlet, the timing
```

```ts
// apps/api/src/common/interceptors/logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const started = process.hrtime.bigint();
    const store = requestContext.getStore();

    const base = {
      requestId: store?.requestId,
      userId: store?.userId ?? null,
      outletId: store?.outletId ?? null,
      module: moduleOf(ctx),          // from the controller class name
      action: actionOf(ctx),          // from the handler name
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
          logger.info({ ...base, durationMs: Math.round(durationMs),
                        outcome: 'ok', method: req.method, path: req.route?.path },
                      'request completed');
        },
        error: (err) => {
          const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
          const status = err?.status ?? 500;
          const outcome = status < 500 ? 'client_error' : 'error';
          logger[outcome === 'error' ? 'error' : 'warn'](
            { ...base, durationMs: Math.round(durationMs), outcome,
              ctx: { code: err?.code, status,
                     stack: outcome === 'error' ? err?.stack : undefined } },
            'request failed',
          );
        },
      }),
    );
  }
}
```

Health check requests to `/healthz` are excluded. The uptime monitor hits it every
minute, which is 1,440 log lines a day saying nothing.

## The audit trail

`AuditLog` is written for every state-changing business action. It is append only.
There is no update path and no delete path anywhere in the application code, not
even for an OWNER.

The `actorLabel` field is denormalised on purpose. It stores "Priya Nayak
(HR_ACCOUNTS)" as a string at write time, so the audit row still names a person
after the user record is disabled and their name changes.

### Audited actions

| Action key | Entity | Typically performed by | `before` | `after` | Retention |
|---|---|---|---|---|---|
| `inventory.transaction.create` | StockTransaction | Inventory Manager, Kitchen Manager | null | type, quantity, signedQty, balanceAfter, reason | forever |
| `inventory.stock.adjust` | ItemStock | Inventory Manager | qtyOnHand before | qtyOnHand after, reason | forever |
| `inventory.wastage.record` | StockTransaction | Kitchen Manager | null | quantity, reason, item, outlet | forever |
| `inventory.closing.record` | StockTransaction | Store Manager | ledger balance | counted balance, variance | forever |
| `inventory.transfer.create` | StockTransaction | Inventory Manager | balances at both outlets | balances after, transferPairId | forever |
| `inventory.item.reorder_level.update` | ItemStock | Inventory Manager | reorderLevel before | reorderLevel after | forever |
| `inventory.item.create` | InventoryItem | Inventory Manager | null | sku, name, category, unit | forever |
| `inventory.item.deactivate` | InventoryItem | Inventory Manager | isActive true | isActive false | forever |
| `purchase.record.create` | Purchase | Purchase Manager | null | purchaseNo, vendor, lines, totalAmount | forever |
| `purchase.record.void` | Purchase | Purchase Manager, Owner | status, totalAmount | VOIDED, voidReason, compensating row ids | forever |
| `purchase.request.decide` | PurchaseRequest | Purchase Manager | status PENDING | APPROVED or REJECTED, decisionNote | 3 years |
| `vendor.create` / `vendor.update` | Vendor | Purchase Manager | previous fields | new fields | 3 years |
| `workforce.leave.decide` | LeaveRequest | Store Manager | status PENDING | APPROVED or REJECTED, decisionNote, attendance day ids written | forever |
| `workforce.attendance.punch_edit` | AttendancePunch | Store Manager | punchedAt before | punchedAt after, editReason | forever |
| `workforce.attendance.status_override` | AttendanceDay | Store Manager, HR | status and workedMins before | after, note | forever |
| `workforce.salary.read` | SalaryRecord | HR/Accounts, Owner | null | employeeId only, never amounts | 1 year |
| `workforce.salary.write` | SalaryRecord | HR/Accounts | previous record's monthlyCtc | new monthlyCtc, effectiveFrom | forever |
| `workforce.employee.create` | Employee | HR/Accounts | null | employeeCode, outlet, department | forever |
| `workforce.employee.exit` | Employee | HR/Accounts | status ACTIVE | EXITED, exitedOn | forever |
| `admin.user.create` | User | Owner, HR/Accounts | null | username, roleKey, outlets | forever |
| `admin.user.role_change` | User | Owner | roleKey before | roleKey after | forever |
| `admin.user.outlet_change` | UserOutlet | Owner, Operations Manager | outlet ids before | outlet ids after | forever |
| `admin.user.status_change` | User | Owner | status before | status after | forever |
| `admin.user.password_reset` | User | Owner, HR/Accounts | null | target userId, mustReset true. Never the password. | forever |
| `auth.password.change` | User | the user | null | userId, self-service flag | 1 year |
| `sales.entry.create` | DailySalesEntry | Counter/Cashier, Store Manager | null | grossSales, netSales, payment split | forever |
| `sales.entry.update` | DailySalesEntry | Store Manager | all amount fields before | after | forever |
| `sales.entry.unlock` | DailySalesEntry | Owner | lockedAt | null, unlock reason | forever |
| `task.checklist.verify` | Task | Store Manager, Operations Manager | status COMPLETED | VERIFIED, verifiedById | 3 years |
| `task.result.record` | TaskChecklistResult | Kitchen Staff | null | item label, result, note | 3 years |
| `crm.reward.issue` | RewardIssue | system, Store Manager | customer coinBalance before | coupon code prefix, coinCost, balance after | forever |
| `crm.reward.redeem` | RewardIssue | Counter/Cashier | status ISSUED | REDEEMED, outlet, redeemedById | forever |
| `crm.game.publish` | GameConfig | Owner, Operations Manager | previous rulesJson and version | new rulesJson and version | forever |
| `crm.customer.consent` | Customer | system | consentAt null | consentAt, source | forever |

"Forever" means for the life of the system. Nothing in this table is large. At
roughly 200 to 400 audited actions a day across two outlets, `AuditLog` grows by
about 120,000 rows a year, which is a few hundred megabytes with the JSON
snapshots. The 8 GB Supabase Pro database does not care. Rows with a stated
retention are pruned by an annual manual job, not automatically, because deleting
audit rows should always be a decision somebody made.

### The interceptor versus explicit writes

The rule: `AuditInterceptor` writes the row when the action needs only an `after`
snapshot. The service writes the row explicitly when it needs a `before` snapshot,
because only the service knows what the value was before it changed it, and it
must capture it inside the same transaction.

```text
  ┌──────────────────────────────────────────────────────────┐
  │ Does this action need a "before" snapshot?               │
  └───────────────────────┬──────────────────────────────────┘
              ┌───────────┴────────────┐
              │ NO                     │ YES
              ▼                        ▼
   ┌──────────────────────┐  ┌──────────────────────────────┐
   │ @Audited('key')      │  │ auditWriter.write(tx, {...}) │
   │ on the controller    │  │ inside the SAME $transaction │
   │ method.              │  │ as the business write.       │
   │ Interceptor writes   │  │ Service reads the row first, │
   │ after a 2xx.         │  │ passes before and after.     │
   └──────────────────────┘  └──────────────────────────────┘
   creates, reads,             updates, decisions, voids,
   issues, plays              role changes, reorder levels
```

Creates use the interceptor: `inventory.item.create`, `purchase.record.create`,
`sales.entry.create`, `workforce.employee.create`, `crm.reward.issue`. There is no
previous state to capture.

Updates and decisions use explicit writes: `inventory.stock.adjust`,
`purchase.record.void`, `workforce.leave.decide`,
`inventory.item.reorder_level.update`, `admin.user.role_change`,
`sales.entry.unlock`, `crm.game.publish`. The service already has the row loaded
inside the transaction, so capturing `before` is free, and doing it in the
interceptor would mean a second read outside the transaction that could see a
different value.

Reads use the interceptor with a null `after` payload: `workforce.salary.read` is
the only one. Salary is the only read in the system that is worth recording, and
the audit row names the employee whose record was viewed, never the amount.

There is an integration test per audited action asserting the row exists with the
right shape, and a test that a rolled-back business transaction leaves no audit
row, because an audit trail that records things that did not happen is worse than
none.

## The audit log viewer

Admin, Audit log. Permission key `admin.audit.read`, granted to OWNER and
OPERATIONS_MANAGER only. HR/Accounts does not get it, because the log contains
`workforce.salary.read` rows naming who looked at whose salary, and the person
whose behaviour that records should not control the record.

Filters: date range, actor, action key, entity type, entity id, outlet. Results
are newest first, 50 per page, and each row expands to show the `before` and
`after` JSON side by side with the changed keys highlighted.

The screen also supports one specific question the client asked in discovery:
"show me everything that happened to this item at this outlet last week". That is
the entity filter with `entityType = ItemStock` and the outlet and date range set,
and it produces the digital version of flipping back through the paper register.

There is no delete button, no export-and-purge, and no admin override. The
application has no code path that issues `DELETE FROM "AuditLog"` or
`UPDATE "AuditLog"`. That is enforced by a lint rule matching those strings in
`$executeRaw` calls and by the absence of any repository method. Somebody with the
database password can still do it, which is why the database password is held by
two people and the audit trail is not the only control.

## Monitoring at this budget

Honest position: the monitoring stack is what the existing services already give
us, plus one free uptime checker. There is no dedicated observability spend inside
Rs 5,000 a month, and inventing one would break the commercial commitment.

| Tool | Gives us | Limits |
|---|---|---|
| Railway metrics | CPU, memory, network per service, deployment history, restart count | Short retention, no alerting on custom conditions |
| Railway logs | Live tail and substring search on the JSON lines above | Retention measured in days, not weeks. Pull logs to a file during an incident. |
| Supabase dashboard | Database size, connection count, slow query report, index usage | Query performance view is sampled, not complete |
| Upstash console | Commands per second, bandwidth used, memory used, daily limits | Metrics only, no alerting on the Fixed plan |
| External uptime check | `/healthz` every minute from outside the network, email on two consecutive failures | Only knows up or down |

What is not bought: no APM (no Datadog, no New Relic), no distributed tracing, no
log aggregation service, no paid error tracking, no dashboards beyond what the
providers render.

The gap that matters most is error aggregation. Right now an unhandled exception
produces an `error` line in Railway logs that nobody sees unless they are looking.
The recommendation is to add Sentry's free tier: 5,000 errors a month, which is
far above what this system will produce, at zero cost.

What it would catch that the current setup does not:

1. A 500 that only one user hits, on one screen, once a day. It never reaches the
   threshold of "the client complained" and it never surfaces in a log tail, but
   Sentry groups it and emails once.
2. Frontend exceptions. Nothing currently captures a React error boundary firing
   on a manager's phone. The user sees a blank screen, closes the tab, and
   nobody ever knows.
3. Regression detection after a deploy, because Sentry tags errors with the
   release and shows a new issue as new rather than as one more line in a stream.
4. The stack trace with source maps, which for a minified Next.js bundle is the
   difference between a fixable report and a useless one.

Setup is roughly 30 minutes: the Nest SDK on the API, the Next.js SDK on the web
app, `beforeSend` wired to the same `redact()` helper above so no salary figure or
token reaches a third party, and the DSN as an environment variable. Propose it to
the client as a line item in the handover, not as a surprise dependency.

## Alert conditions

| Condition | Signal | Threshold | Notified | First response |
|---|---|---|---|---|
| Health check failing | External monitor on `GET /healthz` | 2 consecutive failures, 1 minute apart | Agency lead by email and WhatsApp | Railway dashboard, is the service running. Troubleshooting tree in [chapter 35](35-deployment-runbook.md). |
| Error rate elevated | Count of `level: error` lines | more than 10 in 5 minutes | Agency lead | Group the errors by `module` and `action`. One module means a code bug, everything means a dependency. |
| A job has not run | `TaskRecurrence.lastRunAt` and job heartbeat rows | no run in 2x the job interval (20 s for outbox, 2 h for overdue sweep, 48 h for the daily jobs) | Agency lead | Check the scheduler booted, check `APP_TIMEZONE`, trigger manually. |
| Outbox events in DEAD | `SELECT count(*) FROM "OutboxEvent" WHERE status='DEAD'` | greater than 0 | Agency lead | Read `lastError`. Almost always the WhatsApp token or an unapproved template. |
| Database connection errors | `error` lines containing `P1001` or `P2024` | more than 3 in 5 minutes | Agency lead | Supabase status page first, then connection count, then pooler URL check. |
| Stock reconciliation drift | Nightly job comparing `ItemStock.qtyOnHand` against the sum of `signedQty` per item and outlet | any mismatch, any item | Agency lead and Operations Manager | This should be impossible. Treat as a data integrity incident, capture evidence before touching anything. |
| Plan limits approaching | Supabase database size, Upstash memory, Railway monthly usage | 70 percent of the plan limit | Agency lead | Check row growth on `StockTransaction`, `AuditLog` and `OutboxEvent`. Prune DONE outbox rows older than 30 days. |

The stock reconciliation check is worth the nightly job on its own. It is 40 lines
of SQL, it runs in under a second on this data volume, and it is the only
automated thing standing between a subtle ledger bug and the client discovering it
three weeks later through a physical count.

```sql
-- runs nightly at 03:00 IST, alerts on any row returned
SELECT s."itemId", s."outletId", s."qtyOnHand" AS balance,
       COALESCE(SUM(t."signedQty"), 0) AS ledger_sum,
       s."qtyOnHand" - COALESCE(SUM(t."signedQty"), 0) AS drift
FROM "ItemStock" s
LEFT JOIN "StockTransaction" t
  ON t."itemId" = s."itemId" AND t."outletId" = s."outletId"
GROUP BY s."itemId", s."outletId", s."qtyOnHand"
HAVING s."qtyOnHand" <> COALESCE(SUM(t."signedQty"), 0);
```

## Metrics worth tracking from day one

Two sets, and the second matters more to whether this project succeeded.

### System metrics

| Metric | Source | Healthy range |
|---|---|---|
| p95 latency, dashboard endpoint | request log `durationMs` where `action = dashboard.read` | under 400 ms warm, under 1,200 ms cold |
| p95 latency, list endpoints | request log `durationMs` | under 300 ms |
| Error rate | `outcome: error` as a share of requests | under 0.1 percent |
| Outbox lag | oldest `PENDING` row age | under 30 seconds |
| Outbox DEAD count | row count | 0 |
| WhatsApp delivery rate | `Notification` rows SENT or DELIVERED over total WHATSAPP rows | above 95 percent |
| Job success rate | job completion lines with `outcome: ok` | 100 percent |
| Database size | Supabase | under 2 GB in year one |
| Redis memory | Upstash | under 100 MB |
| Monthly infrastructure cost | provider invoices | under Rs 5,000 |

### Product adoption metrics

The system replaces WhatsApp. The only proof it worked is that people stopped
using WhatsApp for these things. Measure that directly.

| Metric | Query basis | What it tells you | Target by week 4 after go-live |
|---|---|---|---|
| Daily active users | distinct `userId` in request logs per day | Are staff opening it at all, or is one manager entering everything for everyone | 18 of 25 provisioned users |
| Stock entries per outlet per day | `StockTransaction` count grouped by outlet and business date | Whether the inventory loop is actually being run, or only opening stock is entered and the rest is guessed | 8 or more per outlet |
| Days with a complete opening and closing pair | `StockTransaction` where type in OPENING, CLOSING | The single strongest signal that the paper register is retired | 6 of 7 days |
| Sales entry completion | `DailySalesEntry` rows over outlets times days | Whether the 23:30 reminder is working or being ignored | 95 percent of outlet days |
| Checklist completion rate | `Task` with kind CHECKLIST_RUN, status COMPLETED or VERIFIED over generated | Whether the kitchen open and close moved off WhatsApp | above 85 percent |
| Median task completion time | `completedAt` minus `createdAt` | Whether tasks are being closed as work happens or batch-closed at the end of a shift, which means they are being ticked, not done | under 4 hours |
| Overdue task rate | OVERDUE over total tasks | Whether due dates are realistic or the system is nagging people into ignoring it | under 15 percent |
| Leave requests through the system | `LeaveRequest` count per month against the client's expected volume | Whether leave moved off WhatsApp or people still ask their manager verbally | 90 percent of leave taken |
| Purchases recorded within 24 hours of the invoice date | `Purchase.createdAt` minus `purchaseDate` | Whether price history is being captured live or reconstructed weekly from a pile of bills, which makes the price fluctuation chart useless | 80 percent |
| WhatsApp notification open proxy | `Notification.readAt` on IN_APP rows for the same event | Whether people act inside the app after a WhatsApp nudge, or treat WhatsApp as the whole message | above 60 percent |
| Mobile share of sessions | user agent in request logs | Confirms the responsive requirement was the right call and tells you where to spend UI effort | above 70 percent |

Review these with the client at the end of week 2 after go-live and again at week
4. A low number is not a failure, it is a conversation: either the flow is too
slow on a phone in a hot kitchen, or nobody trained the evening shift, or the
feature solves a problem the client thought they had and did not. All three are
fixable, and none of them are visible from a system metrics dashboard.
