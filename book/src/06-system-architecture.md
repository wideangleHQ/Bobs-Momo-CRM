# System architecture

The system has five moving parts. Two of them are ours and run on Railway: a
Next.js web service and a NestJS API service. Three are managed by somebody
else: Postgres on Supabase, Redis on Upstash, and object storage on Supabase.
A sixth, the WhatsApp Business Cloud API, is an outbound integration that the
API talks to and that never talks back except through a webhook.

The API service is the only process in the system that holds a database
credential. The browser never sees `DATABASE_URL`, never sees the Supabase
service role key, and never sees the WhatsApp access token. Everything a user
does passes through `/api/v1`.

## The whole system on one page

```text
  =============== public internet, TLS, port 443 ===============

  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
  │Staff mobile│ │Staff laptop│ │Owner laptop│ │Public game │
  │  browser   │ │  browser   │ │  browser   │ │  browser   │
  └──────┬─────┘ └──────┬─────┘ └──────┬─────┘ └──────┬─────┘
         └──────────────┴───────┬──────┴──────────────┘
                                │ HTTPS 443
                                ▼
       ┌───────────────────────────────────────────────┐
       │ Railway service: web                          │
       │ Next.js 15 App Router on Node 22, port 3000   │
       │ public host app.bobsmomo.in                   │
       └───────────────────────┬───────────────────────┘
                               │ (1) browser fetch, HTTPS 443
                               │     to api.bobsmomo.in
                               │ (2) server component fetch,
                               │     http://api.railway.internal:3001
                               ▼
       ┌───────────────────────────────────────────────┐
       │ Railway service: api                          │
       │ NestJS 11 on Node 22, port 3001               │
       │ public host api.bobsmomo.in                   │
       └─┬─────────────┬───────────┬──────────────┬────┘
         │             │           │              │
          TCP 6543      TLS 6379    HTTPS 443      HTTPS 443
          Supavisor     rediss://   signed URL     Graph API
         │             │           │              │
         ▼             ▼           ▼              ▼
  ┌──────────────┐ ┌────────┐ ┌──────────┐ ┌──────────────┐
  │ Supavisor    │ │Upstash │ │ Supabase │ │ WhatsApp     │
  │ txn-mode     │ │ Redis  │ │ Storage  │ │ Cloud API    │
  │ pooler       │ │ 250 MB │ │ bucket   │ │ graph.       │
  │      │       │ │ fixed  │ │task-proof│ │ facebook.com │
  │      ▼       │ └────────┘ └──────────┘ └──────┬───────┘
  │ PostgreSQL 15│                                │
  │ port 5432    │◄─── DIRECT_URL, migrations     │ webhook
  └──────────────┘     only, not app traffic      │ POST back
                                                  ▼
                                    api.bobsmomo.in/api/v1/
                                    whatsapp/webhook
```

Three things in that picture matter more than the boxes.

The `web` to `api` hop happens twice, over two different paths. Client
components in the browser call `NEXT_PUBLIC_API_BASE_URL`, which resolves to
the public `api.bobsmomo.in` host over the internet. React Server Components
running inside the `web` container call `http://api.railway.internal:3001`
over Railway's private network, which never leaves the datacentre and skips
TLS termination. Both are real paths and both must work. A dashboard that
renders on the server and then hydrates will use both within one page load.

The Postgres box has two doors. Application traffic goes through Supavisor on
port 6543 in transaction mode, which is what `DATABASE_URL` points at.
Migrations go through port 5432 directly, which is what `DIRECT_URL` points
at. ADR-004 in [Technology decisions](07-technology-decisions.md) explains why
mixing them breaks prepared statements.

The WhatsApp arrow is the only one that points back at us. Meta posts delivery
receipts and inbound messages to a webhook on the API. That endpoint is public
and unauthenticated in the JWT sense, so it verifies Meta's signature instead.

## Tier by tier

### Browser tier

Staff use phones on the kitchen floor. Managers use laptops in the office. The
public game page is opened by customers who have no account. All three run the
same Next.js bundle with different routes.

State held here: an in-memory access JWT (never `localStorage`), a refresh
token in an httpOnly cookie the JavaScript cannot read, and the TanStack Query
cache, which is discarded on reload.

What this tier must never do: hold a Supabase key, compute a permission
decision that the server does not also compute, or write a business record
optimistically and assume it stuck. UI-level permission checks exist to hide
buttons, not to enforce anything.

### Web tier, Next.js on Railway

Serves the App Router pages, runs Server Components, proxies nothing. It has no
database client and no Prisma dependency in `package.json`. Its only outbound
dependency is the API.

State held here: none that survives a restart. Session cookies are set by the
API and forwarded, not minted here.

What this tier must never do: import from `apps/api`, connect to Postgres or
Redis, or hold a secret other than build-time public config. If a page needs
data, it asks the API. This keeps the "two services, one credential holder"
property that makes the security story short.

### API tier, NestJS on Railway

One process, one port, a modular monolith with roughly twenty feature modules
under `src/modules`. It owns validation, authorisation, transactions, the
outbox, the cron jobs, the WhatsApp adapter and the audit trail. `@nestjs/
schedule` cron jobs run inside this same process, which is fine at one replica
and becomes a problem at two. See the scaling notes below.

State held here: an in-process Prisma client with `connection_limit=1`, an
ioredis connection, and nothing else. All durable state is in Postgres.

What this tier must never do: trust `outletId` from a request body without
checking it against the caller's scope, mutate `StockTransaction` or
`AuditLog` rows, or perform a multi-row business write outside
`prisma.$transaction`.

### Data tier

Postgres is the system of record. Redis is a cache and a rate limiter, and
losing all of it must cost nothing but latency. Supabase Storage holds task
proof photos, which are the only binary data in the system. WhatsApp is a
delivery channel, never a store, which is a rule the SRS states directly and
which chapter 21 enforces.

## Request lifecycle: POST /api/v1/inventory/transactions

A kitchen manager issues 2.400 KG of chicken mince to the kitchen at 11:40 on a
4G phone. Here is every layer that request touches.

```text
 Staff taps "Save" on the issue-stock sheet
 ──────────────────────────────────────────────────────────────
  1  Client component      react-hook-form + zodResolver against
                           recordTransactionSchema from
                           packages/shared
       │ invalid -> inline field error, zero network calls
       ▼ valid
  2  TanStack useMutation  POST /api/v1/inventory/transactions
                           Authorization: Bearer <accessJwt>
                           Idempotency-Key: <uuid v4 from client>
       │
       ▼  HTTPS 443, roughly 120 ms RTT on 4G in Bhubaneswar
  3  Railway edge  ->  api service, port 3001
       │
       ▼
  4  Nest global pipeline, in this order:
     ┌────────────────────────────────────────────────────┐
     │ a TransformInterceptor  opens, will wrap response  │
     │ b AuditInterceptor      captures actor, ip, body   │
     │ c JwtAuthGuard          verifies signature + exp   │ 401
     │ d PermissionsGuard      inventory.transaction.create│ 403
     │ e OutletGuard           body.outletId in user scope│ 404
     │ f ZodValidationPipe     recordTransactionSchema    │ 400
     └────────────────────────────────────────────────────┘
       │
       ▼
  5  InventoryController.recordTransaction(dto, user)
     one call down, no branching, no Prisma
       │
       ▼
  6  InventoryService.recordTransaction()
     GET idem:<key> in Redis
       │ hit  -> replay stored 201 body, stop here
       ▼ miss
  7  prisma.$transaction(async tx => {
       SELECT * FROM item_stock
         WHERE item_id = $1 AND outlet_id = $2 FOR UPDATE
       derive signedQty from StockTxnType
       balanceAfter = qtyOnHand + signedQty
       if balanceAfter < 0 -> throw INSUFFICIENT_STOCK (422)
       INSERT stock_transaction (append only)
       UPDATE item_stock SET qty_on_hand = balanceAfter
       if crossed reorderLevel and cooldown elapsed:
         INSERT outbox_event (eventKey = 'LOW_STOCK')
     })
       │ any throw -> rollback -> AllExceptionsFilter
       │              -> error envelope with requestId
       ▼ commit
  8  SETEX idem:<key> 86400 <serialised response>
       │
       ▼
  9  AuditInterceptor writes audit_log row
     action = "inventory.transaction.create"
       │
       ▼
 10  RedisService.del  dash:<outletId>:*  and  stock:<outletId>
       │
       ▼
 11  201 Created, StockTransaction object, no envelope
       │
       ▼
 12  TanStack onSuccess -> invalidateQueries(["stock", outletId])
     list refetches, toast: "Issued 2.400 KG Chicken Mince"
```

Two details in that trace are load-bearing.

The row lock at step 7 is `SELECT ... FOR UPDATE` on `item_stock`, not an
optimistic read. Two kitchen staff issuing the same item within the same second
is a normal Tuesday, and without the lock both compute `balanceAfter` from the
same stale `qtyOnHand` and one write silently disappears.

The audit row at step 9 is written after the commit, outside the transaction.
If the process dies between step 7 and step 9 the business write survives and
the audit entry does not. The outbox row, which is the thing that must not be
lost, is inside the transaction. That is the deliberate split: outbox is
exactly-once with the write, audit is best-effort-after. Chapter 15 covers the
audit gap and its reconciliation query.

## Write path and read path

```text
  WRITE PATH                       READ PATH
  ──────────                       ─────────
  controller                       controller
      │                                │
  service (rules, tx)              service
      │                                │
  prisma.$transaction              RedisService.get(key)
      │                                │ hit -> return, ~3 ms
   ┌──┴──────────────┐                 ▼ miss
   │ business rows   │             repository (Prisma read)
   │ outbox_event    │                 │
   └──┬──────────────┘             Redis SETEX key ttl
      │ commit                         │
      ▼                                ▼
  Redis DEL cache keys             JSON response
      │
      ▼ (separately, every 15 s)
  OutboxDispatcher cron
      │
      ├─ Notification rows (IN_APP)
      └─ WhatsApp Cloud API (WHATSAPP)
```

Writes never read from Redis for business state, and never write business state
to Redis. Redis holds three categories only: cached read models with a TTL
(dashboard summaries, published game config, item lists), idempotency
replays keyed by `Idempotency-Key` with a 24 hour TTL, and rate limit counters.
Flush the entire Redis instance during business hours and the only visible
effect is slower dashboards for a minute and a window where a double-tapped
submit could create a duplicate row.

Cache invalidation is explicit deletion on write, not TTL expiry alone. A
manager who records a purchase and then opens the dashboard expects the number
to have moved. TTLs are the backstop for the paths we forgot to invalidate, so
they are short: 60 seconds for dashboard aggregates, 300 seconds for master
data lists, 3600 seconds for published game config.

## Failure modes

Each of these has happened to somebody on this stack. The question is not
whether it happens but what the staff member on the floor sees when it does.

### Postgres: Supavisor pool exhaustion during the 22:00 closing rush

Both outlets close within twenty minutes of each other. Closing checklists,
closing stock counts and the daily sales entry all land in the same window,
which is the busiest write burst of the day. If the API is running two replicas
and Prisma is misconfigured with `connection_limit=10` instead of `1`,
Supavisor's transaction-mode pool fills and the next query waits.

What the user sees: the save spinner runs for ten seconds, then a toast reading
"Something went wrong. Your entry was not saved." Prisma raises `P2024`, "Timed
out fetching a new connection from the connection pool".

Behaviour: hard fail for that request, no data loss, no partial write. The
transaction never opened, so nothing rolled back halfway. The user retries and
it usually succeeds because the burst is thirty seconds wide, not thirty
minutes.

Designed behaviour: `connection_limit=1` in `DATABASE_URL`, statement timeout
of 10 seconds set at the database level, and a Prisma pool timeout of 10
seconds so the failure is fast and legible rather than a hung request. The
closing checklist form keeps its filled state in the client on error so the
retry costs one tap, not five minutes of re-entry.

### Redis: Upstash request limit or bandwidth ceiling exceeded

The Fixed 250 MB plan has a bandwidth allowance, and a badly written dashboard
that caches a 400 KB payload and reads it on every widget mount will chew
through it. Upstash responds with `ERR max requests limit exceeded` or drops
the connection.

What the user sees: nothing. Dashboards take 300 ms instead of 40 ms.

Behaviour: degrade, always. Every `RedisService` call is wrapped so a Redis
error is logged at `warn` and treated as a cache miss. Rate limiting fails open
rather than closed, because a QSR where nobody can punch in is worse than a QSR
where somebody could theoretically brute-force a login for ninety seconds.
Idempotency replays fail open too, which means a double-tap during a Redis
outage can create a duplicate stock transaction. That is why the ledger is
append-only and correctable with an `ADJUSTMENT` row rather than being an
unrecoverable state.

### Supabase Storage: upload rejected or bucket unreachable

Kitchen staff attach a photo to a completed cleaning checklist. The phone is on
patchy 4G and the signed upload fails, or the bucket policy was changed and the
service role key no longer grants insert.

What the user sees: the checklist item shows "Photo failed to upload. Retry" and
the item stays unmarked if `requiresPhoto` is true, or completes without the
photo if it is false.

Behaviour: degrade for optional photos, block for required ones. The task
completion write and the attachment write are separate requests. The task is
never left half-completed by a storage failure, because the `TaskAttachment` row
is only inserted after the storage object exists. An orphan storage object with
no row is possible and harmless. An orphan row pointing at a missing object is
not, so the order is fixed: upload first, insert second.

### WhatsApp Cloud API: template rejected by Meta

Meta reviews message templates. A template that has been sending fine for two
weeks can be paused or rejected, usually for a formatting or category
violation, and the API then returns HTTP 400 with error code 132001,
"Template name does not exist in the translation" or a `132000` parameter count
mismatch after somebody edits the template body.

What the user sees: nothing on the web app. The in-app notification arrives
normally. The WhatsApp message does not.

Behaviour: degrade. The outbox dispatcher marks the `Notification` row
`FAILED` with `failReason` set to the Meta error code, and the `OutboxEvent`
moves to `DONE` rather than retrying, because a rejected template will be
rejected identically on every retry. Retrying a template rejection is how you
get rate limited by Meta. Transport errors (timeout, 5xx, 429) do retry with
backoff up to five attempts before the event is marked `DEAD`. The in-app
channel is written first and independently, so WhatsApp being down never
prevents a manager from seeing a leave request in the app.

### Railway: cold start after idle

Railway Hobby will spin a service down when it has had no traffic. Nobody opens
the ERP between 01:00 and 06:30. The first request of the morning, a store
manager punching in at 06:45, hits a cold container.

What the user sees: the login page takes 8 to 14 seconds. Occasionally the
first API call times out at the browser and the user taps again, which works.

Behaviour: degrade, slowly. The mitigation is a `GET /healthz` ping every 5
minutes from an external uptime checker, which keeps both services warm for
about Rs 0 per month and doubles as the alerting path. A second effect matters
more: `@nestjs/schedule` cron jobs do not run in a spun-down container, so the
06:00 recurring-task generation job would be skipped entirely. The recurring
job is therefore written to be catch-up safe. It generates any instance whose
scheduled time has passed and whose `lastRunAt` predates it, rather than
assuming it fires exactly on the minute.

### Supabase: daily backup window

Supabase Pro takes daily automated backups with 7 day retention. On a small Pro
instance the backup window shows up as a latency bump, typically a few hundred
milliseconds of extra p99 for a minute or two, occasionally a dropped
connection that Prisma reconnects through.

What the user sees: one slow page load, at a time of day when the outlets are
usually closed.

Behaviour: degrade. Nothing is scheduled against the backup window on our side.
The restore path is the part that needs rehearsing, not the backup path, and
chapter 36 owns that runbook. The number to remember today is that recovery
point objective is up to 24 hours on Pro. If a table is dropped at 23:00 the
data written since the previous night's backup is gone. That is the accepted
risk at this budget, and it is why the outbox and audit tables are append-only:
they are the reconstruction source when a business table needs repair.

## Scaling notes

The system is sized for 2 outlets and about 30 users. It will not stay there.

### At 5 outlets, roughly 75 users

First thing to break: the dashboard aggregate query. Chapter 31's P&L and
consumption views scan `stock_transaction` filtered by `outlet_id` and
`business_date`. With five outlets and a year of history that table crosses a
million rows and the 60 second cache stops hiding the cost, because five
managers on five different outlet filters produce five distinct cache keys and
each miss pays full price.

Fix: a nightly rollup job writing to a `daily_stock_summary` table, and point
the dashboard at the rollup with the live table used only for the current
business day. This is a half-day change and needs no schema redesign because
the ledger already carries `businessDate`.

Second thing: the single API replica. Cron jobs live in the process, so scaling
to two replicas duplicates every scheduled job, generating two copies of every
recurring task.

Fix: a Postgres advisory lock around each job body, taken at the start of the
run and released at the end. Roughly fifteen lines in a decorator. Do this
before adding the second replica, not after.

### At 20 outlets, roughly 300 users

First thing to break: Supavisor connection budget. Twenty outlets means more
API replicas, and transaction-mode pooling has a hard ceiling on the Supabase
plan. Fix: move up a Supabase compute tier, and split the read-heavy analytics
queries onto a read replica with a separate Prisma client.

Second thing: the outbox poll. A 15 second poll across one table is free at
tens of events per day. At twenty outlets the notification volume is hundreds
per hour, and the `PENDING` scan plus the WhatsApp send latency start to exceed
the poll interval, so runs overlap. Fix: at that point BullMQ on a real Redis
instance is worth its cost, and ADR-003 records the trigger condition for
revisiting it. The outbox table stays, because it is what makes the queue
handoff exactly-once. The dispatcher just moves from polling to enqueueing.

Third thing: `@db.Uuid` primary keys with random v4 values cause B-tree index
fragmentation on the hottest insert tables once they pass a few million rows.
Fix is UUIDv7 for new tables, which is a default change, not a migration of
existing data.

Nothing on that list requires the modular monolith to be broken up. The module
boundaries in `src/modules` are the seams if it ever does, and ADR-001 explains
why splitting them now would cost three weeks we do not have.
