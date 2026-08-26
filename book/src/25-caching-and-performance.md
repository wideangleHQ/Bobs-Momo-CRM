# Caching and performance

At two outlets and thirty users, almost nothing in this system needs a cache.
The database is a Postgres 15 instance on Supabase Pro serving a table whose
largest row count after a year is around 40,000. A correctly indexed query
against that returns in single-digit milliseconds. Adding a cache in front of it
buys perhaps 4ms and introduces a class of bug that costs hours: a manager
records a stock issue, refreshes the page, and sees the old balance. They report
it as "the stock number is wrong", which is the worst possible bug description,
and the investigation goes to the ledger before it goes to the cache.

Every cache is a copy of the truth that can disagree with the truth. At this
scale the milliseconds saved are not worth the disagreements bought.

Redis is still in the stack, and the SRS names Upstash for caching and
background processing. It earns its Rs 850 a month for three things that need
shared state across processes, not for making reads faster.

| Use | Why it cannot live in the API process |
|---|---|
| Rate limit counters | A counter in Node memory resets on every deploy and is wrong the moment there are two replicas |
| Idempotency keys | A double-tapped submit can land on a different replica than the first attempt |
| A small set of hot read caches | Shared so a cache warmed by one request serves the next, and invalidatable from any process |

Background processing is not on that list. ADR-003 put the job queue in
Postgres, and [Background jobs](24-background-jobs.md) explains why.

## Rate limiting

Rate limiting is a security control, not an optimisation. The SRS requires it
on the public game APIs to mitigate abuse, and the auth endpoints need it more
than the game does, because an unthrottled login endpoint is a password
guessing service.

The implementation is a sliding window log in a Redis sorted set. Each request
adds a member scored by its timestamp, old members are trimmed, and the
remaining cardinality is the count in the window.

```ts
const SCRIPT = `
  local key    = KEYS[1]
  local now    = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit  = tonumber(ARGV[3])
  local id     = ARGV[4]

  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  local used = redis.call('ZCARD', key)
  if used >= limit then
    return {0, used}
  end
  redis.call('ZADD', key, now, id)
  redis.call('PEXPIRE', key, window)
  return {1, used + 1}
`;

async function allow(key: string, windowMs: number, limit: number) {
  const [ok, used] = await redis.eval(
    SCRIPT, 1, key, Date.now(), windowMs, limit, randomUUID(),
  ) as [number, number];
  return { allowed: ok === 1, used, remaining: limit - used };
}
```

The Lua script matters. Trim, count and add have to happen atomically, or two
concurrent requests both read a count of 9 against a limit of 10 and both
proceed. Upstash supports `EVAL`, and the whole script is one round trip.

Key shape and tiers:

| Tier | Key | Window | Limit | Applies to |
|---|---|---|---|---|
| Login | `bm:prod:rl:login:{username}:{ip}` | 15 min | 10 | `POST /auth/login` |
| Password reset | `bm:prod:rl:reset:{ip}` | 1 hour | 5 | `POST /auth/password-reset` |
| Authenticated read | `bm:prod:rl:api:{userId}` | 1 min | 120 | every GET under `/api/v1` |
| Authenticated write | `bm:prod:rl:write:{userId}` | 1 min | 60 | POST, PUT, PATCH, DELETE |
| Reports | `bm:prod:rl:report:{userId}` | 1 min | 20 | `/analytics/*` |
| Public game | `bm:prod:rl:game:{ipHash}` | 1 min | 30 | unauthenticated CRM game endpoints |
| Game play submit | `bm:prod:rl:play:{sessionKey}` | 1 hour | 20 | `POST /crm/plays` |

A rejection returns 429 with `RATE_LIMITED` and a `Retry-After` header in
seconds. The login tier keys on username and IP together so that one attacker
cannot lock out a real user by burning their username's budget from elsewhere,
and so that one office IP does not throttle five staff logging in at shift
change.

The 120 per minute authenticated read tier is deliberately generous. A staff
member on the task board with a 15 second poll plus a 60 second badge poll plus
normal navigation uses maybe 15 a minute. The limit exists to catch a runaway
client loop, not to shape normal use.

None of this works in process memory. Railway restarts the container on every
deploy, which would reset every counter and hand an attacker a fresh budget
each time the team ships. And the moment there are two replicas, each holds half
the truth, so the effective limit doubles and neither instance knows it.

## Idempotency

Three endpoints accept an `Idempotency-Key` header per the API conventions:
`POST /purchases`, `POST /inventory/transactions` and `POST /attendance/punch`.
All three are things staff do on a phone with two bars of signal, where the
submit button gets tapped twice because nothing appeared to happen.

Key shape: `idem:{userId}:{key}`, scoped by user so one person's key cannot
collide with or replay another's.

Stored value:

```json
{
  "status": 201,
  "bodyHash": "9f2b...",
  "requestHash": "c41d...",
  "body": { "id": "...", "purchaseNo": "PO-2026-0117", "totalAmount": "4820.00" },
  "storedAt": "2026-08-26T09:14:02.117Z"
}
```

TTL is 24 hours, set with `SET key value EX 86400 NX`. The `NX` matters: it is
the claim. The first request to present a key wins the write, processes the
business transaction, and then overwrites the placeholder with the real
response.

Replay behaviour:

1. No stored value. Claim the key with a placeholder, process, store the real
   response, return it.
2. Stored value with a matching `requestHash`. Return the stored `status` and
   `body` verbatim, with `Idempotency-Replayed: true`. No database write
   happens.
3. Stored value with a different `requestHash`. Return 409 with
   `IDEMPOTENCY_KEY_REUSED`. The client reused a key for a different payload,
   which is a client bug, and replaying the wrong response would be worse than
   an error.
4. Stored placeholder still in flight. Return 409 with
   `IDEMPOTENCY_IN_PROGRESS`. The first request has not finished, so there is no
   response to replay yet, and processing the second concurrently is exactly
   what the header exists to prevent.

The 24 hour TTL comes from the failure mode being defended against: a mobile
retry happens within seconds, and a manual retry within minutes. Twenty-four
hours is generous by three orders of magnitude and keeps the memory footprint
at a few kilobytes.

## Read caches

Five candidates were considered. Four are cached, one is not.

| Key | TTL | Contents | Invalidated by |
|---|---|---|---|
| `bm:prod:dash:{outletId}:{businessDate}` | 60s | Dashboard summary tiles: today's sales, open tasks, staff present, items below reorder | TTL only |
| `bm:prod:stock:{outletId}` | 30s | Current stock list for one outlet, item name, qty on hand, reorder level | `DEL` on commit of any `StockTransaction` for that outlet |
| `bm:prod:game:config:{slug}` | 300s | Published `GameConfig.rulesJson` plus its reward definitions | `DEL` on `POST /crm/games/:id/publish` |
| `bm:prod:notif:unread:{userId}` | 15s | Integer unread notification count | `DEL` on `Notification` insert for that user, on read, and on read-all |
| Permission map | none | Role to permission key mapping | not applicable, see below |

The dashboard is TTL-only on purpose. It aggregates across five modules, so
invalidating it correctly means hooking every write in the system, and being
60 seconds stale on a summary tile is not a bug anybody can act on. Precise
invalidation here would cost more code than the cache saves.

The stock list is the opposite. It is the number a manager checks immediately
after recording a transaction, so a stale value looks like data loss. The
invalidation fires on transaction commit, not before:

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.stockTransaction.create({ data: txn });
  await tx.itemStock.update({ where: { id }, data: { qtyOnHand: next } });
  await this.outbox.emit(tx, lowStockEvent);
});
// after commit, never inside
await this.redis.del(`bm:prod:stock:${outletId}`);
```

Deleting inside the transaction would clear the cache and then let a concurrent
read repopulate it from uncommitted state, which puts the pre-transaction value
back with a fresh 30 second lease. Delete after commit, and accept that a reader
in the microseconds between commit and delete sees a stale value. That window is
sub-millisecond and self-heals in 30 seconds regardless.

The game config is cached for five minutes because it is read by every
anonymous visitor to the public game and changed roughly never. Publishing is
the only thing that changes it, and publish deletes the key.

The permission map needs no cache and does not get one. It is a constant in
TypeScript: a frozen object mapping each `RoleKey` to its permission key list,
compiled into the bundle. It cannot change at runtime, there is no admin screen
to edit it, and a role change on a user takes effect at their next login when a
new JWT is minted with the new `roleKey`. Caching a compile-time constant in
Redis would add a network round trip to every authorisation check to avoid an
object property lookup. Stating this explicitly matters because "cache the
permissions" is a suggestion that comes up in every review.

## Cache keys and TTLs

Key format:

```text
bm:{env}:{domain}:{identity}[:{qualifier}]

bm:prod:stock:3a9d1b2c-...
bm:prod:dash:3a9d1b2c-...:2026-08-26
bm:staging:notif:unread:8c1f2e3d-...
bm:prod:idem:8c1f2e3d-...:a41f-b2c9
```

The `env` segment means staging and production can share a Redis instance
without staging invalidations touching production keys, which matters on a
Rs 850 a month plan with one database.

The rule with no exceptions: every key written to Redis has a TTL. Not the
long-lived ones, not the "this never changes" ones, not the idempotency
placeholders. `SET` without `EX` is banned, and a lint rule catches it.

The reason is failure recovery rather than memory. A key with no TTL that gets
written with a wrong value stays wrong until a human notices and deletes it. A
key with a TTL is wrong for at most its TTL and then self-heals. Every
invalidation path in this chapter is code that can have a bug in it, and the TTL
is the backstop for the bug you have not found. On a 250 MB fixed plan the
memory argument holds too, but self-healing is the argument that matters.

## Cache-aside

One helper, used by all four cached reads.

```ts
async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T;

  const value = await load();
  // ponytail: no lock. See the stampede note below.
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  return value;
}
```

Read the cache, return on a hit, otherwise load, store, return. That is the
whole pattern and it is the right one here because every cached value is
derivable from the database at any time.

A cache stampede is what happens when a popular key expires and every concurrent
request misses at once, so all of them run the expensive load together. With one
key, a 200ms query and 500 concurrent requests, you get 500 simultaneous
identical queries and a database that falls over precisely because the cache was
working.

At this scale that cannot happen. Peak concurrency is about eight users. When
`bm:prod:stock:{outletId}` expires, at most a few requests miss together, and
each runs a 5ms indexed query. Eight duplicate 5ms queries is not an event.

The point at which it would matter: a key read by more than roughly fifty
concurrent requests, backed by a load that takes more than roughly 200ms. The
public game config is the only key with any path to that, and only if the game
goes viral. The fix at that point is a per-key lock, `SET lock:{key} 1 NX EX 5`,
where the winner loads and the losers wait 50ms and re-read. Six lines. Not
today.

## Query performance

Caching is the second lever. Indexes are the first, and a missing index is the
only thing at this data volume that turns a fast query slow.

Chapter 10 owns the index strategy. The four that carry the interactive
application:

| Index | Serves |
|---|---|
| `Task @@index([outletId, status, dueAt])` | The task board, the busiest screen in the app |
| `StockTransaction @@index([itemId, outletId, createdAt])` | Item history and the consumption report |
| `Notification @@index([userId, readAt, createdAt])` | The inbox and the unread count |
| `OutboxEvent @@index([status, availableAt])` | The dispatcher claim, four times a minute forever |

### N+1

Prisma makes N+1 easy to write and easy to fix. The task board is the clearest
example. The naive version:

```ts
// 1 query for the tasks
const tasks = await prisma.task.findMany({
  where: { outletId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
});

// then 2 more per task
for (const t of tasks) {
  t.assignee = await prisma.employee.findUnique({ where: { id: t.assigneeId! } });
  t.commentCount = await prisma.taskComment.count({ where: { taskId: t.id } });
}
```

Fifty open tasks is 101 queries. Each one is fast, 1 to 3ms, and the endpoint
still takes 250 to 400ms because it pays a round trip to Supavisor a hundred
times. This is the shape of almost every slow endpoint anyone will ever write in
this codebase.

The fix:

```ts
const tasks = await prisma.task.findMany({
  where: { outletId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  select: {
    id: true,
    title: true,
    priority: true,
    status: true,
    dueAt: true,
    assignee: { select: { id: true, fullName: true } },
    _count:   { select: { comments: true } },
  },
  orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
  take: 100,
});
```

Two queries: one for tasks with the assignee joined, one batched count. Around
12ms. Prisma issues the relation load as a single `IN` query, not one per row.

`select` rather than `include` on list endpoints. `include` returns every scalar
column of the parent and the relation, which on `Task` means dragging
`description`, six timestamps and every foreign key across the wire for a board
that renders five fields. `select` is a list of what the screen actually needs,
and it doubles as documentation of the endpoint's response shape.

Two rules follow from this section.

No list endpoint returns unbounded rows. Every `findMany` that backs an endpoint
carries a `take`, whether or not the endpoint is paginated. The page size cap
from the API conventions is 100, and a query with no `take` is a query that
returns 40,000 stock transactions the first time somebody removes a date filter.

Every aggregate report takes an explicit date range with a maximum span. The
analytics endpoints require `from` and `to`, reject a missing one with
`DATE_RANGE_REQUIRED`, and reject a span over 366 days with
`DATE_RANGE_TOO_WIDE`. Without that, "show me the P&L" scans the entire ledger,
and it works fine in month one and times out in year three.

## Performance budget

Targets are p95 measured server-side, from request received to response written,
excluding network time to the client.

| Endpoint | p95 target | How it is measured |
|---|---|---|
| `POST /auth/login` | 400ms | Dominated by argon2id verification, which is deliberately slow. Measured by the request timing interceptor |
| `GET /analytics/dashboard` | 800ms | Five module aggregates, cached 60s. The target is the cold path |
| `GET /inventory/stock?outletId=` | 300ms | Cached 30s. Cold path is one indexed query plus a join |
| `GET /tasks?outletId=&status=` | 250ms | Uncached, `(outletId, status, dueAt)` index, `take: 100` |
| `POST /purchases` | 600ms | Six writes in one transaction including the outbox row |
| `POST /inventory/transactions` | 400ms | Three writes plus a conditional outbox emit |
| `GET /notifications/unread-count` | 80ms | Redis hit on the common path |
| `GET /analytics/*` reports | 2s | Aggregates over a bounded date range |

Measurement is a NestJS interceptor that records method, route template,
status and duration for every request, logged as a structured line. Route
template, not path, so `/tasks/:id` aggregates instead of producing one series
per uuid. p95 is computed from the log, weekly, and after any change to a query
on the list above.

The login target deserves a note, because 400ms looks slow next to 80ms for a
count. argon2id is configured to take roughly 250ms on the Railway Hobby
instance, and that cost is the feature: it is what makes an offline attack on a
stolen hash expensive. Tuning it down to hit a prettier number would weaken the
one control standing between a database leak and every staff password.

## What the load actually is

Every architectural decision in this book is downstream of these numbers, so
they are worth writing out.

Thirty users total, across two outlets, of whom maybe twenty log in on a given
day. Peak concurrency is around eight: shift change at one outlet, four people
punching in while a manager reviews the roster and a cashier enters yesterday's
sales.

Writes per day, counted by module:

| Module | Writes per day |
|---|---|
| Attendance punches and breaks | 30 employees, 4 punches, 2 break events, roughly 180 |
| Stock transactions | 55 per outlet, roughly 110 |
| Task status changes and checklist results | roughly 300 |
| Purchases and purchase requests | roughly 20 rows including line items |
| Messages and message reads | roughly 150 |
| Notifications | roughly 200 rows across channels |
| Sales entries | 2 |
| Audit log | one per state-changing operation, roughly 900 |
| Total | roughly 1,900 |

Call it 2,000 writes a day. Spread over a fourteen hour trading day that is
about 0.04 writes per second average, with a burst of maybe 5 per second at
shift change.

Annual growth in the largest table:

```text
  StockTransaction, per outlet per trading day
    received   ~15 lines      issued    ~30 lines
    wastage     ~5 lines      closing   ~10 lines
                              ------------------
                              ~60 rows / outlet / day
  x 2 outlets x 335 trading days = ~40,000 rows / year
```

Forty thousand rows a year. `AuditLog` grows faster at roughly 300,000, which
is why it has an archive job. Everything else is smaller. After three years the
database is under 500 MB against an 8 GB plan.

What these numbers justify, and what would overturn each one:

| Decision | Justified by | Revisit when |
|---|---|---|
| Cron plus Postgres outbox, not BullMQ | 200 notifications a day | Sustained backlog in `OutboxEvent`, or over 10,000 events a day |
| One Railway replica | 8 concurrent users | p95 rising with concurrency, or a need for zero-downtime deploys |
| Polling, not websockets | 30 clients, cached endpoints | Over 200 clients, or a workflow needing sub-second delivery |
| Four cached keys | Indexed queries under 15ms | Any endpoint missing its p95 target with correct indexes |
| Offset pagination, no cursor | Largest list is 40,000 rows | A list users page deep into, where `OFFSET 10000` starts to hurt |
| No read replica | Reads and writes both trivial | Read load competing with writes, visible as lock waits |
| Indefinite message retention | 22 MB a year | Database approaching the plan limit |

The pattern to notice: every one of these is a decision to not build something,
and every one has a stated number that would change the answer. That is the
difference between a simple architecture and an underbuilt one.

## Connection pooling

Prisma connects through Supavisor in transaction mode on port 6543. Two
settings in `DATABASE_URL` are not optional.

```bash
DATABASE_URL="postgresql://USER:PASS@REGION.pooler.supabase.com:6543/postgres\
?pgbouncer=true&connection_limit=5"

DIRECT_URL="postgresql://USER:PASS@db.PROJECT.supabase.co:5432/postgres"
```

`pgbouncer=true` disables Prisma's prepared statement cache. In transaction
pooling a connection is returned to the pool after every statement, so the
session that prepared a statement is not the session that executes it. Without
this flag Prisma prepares `s0` on one backend and later tries to execute it on
another that has never seen it.

`connection_limit=5` caps how many connections one Prisma client opens. The
default is `num_cpus * 2 + 1`, which on a Railway container reporting eight
cores is seventeen connections from a single replica. Supavisor's pool is
shared by the application, the job runner's direct client, any migration in
flight and anything the team has open in a SQL editor. Seventeen from one
process exhausts it, and this is why the number must be small: at 0.04 writes
per second, five connections is four more than the application needs.

Symptoms of getting it wrong, and which setting causes each:

| Symptom | Cause |
|---|---|
| `prepared statement "s0" already exists`, Postgres error 42P05 | `pgbouncer=true` missing |
| `Timed out fetching a new connection from the connection pool`, Prisma P2024 | `connection_limit` too high across replicas, or a leaked long transaction holding connections |
| `remaining connection slots are reserved` | Something bypassed the pooler and connected on 5432 |
| Migrations hang or fail with a shadow database error | Migration run against `DATABASE_URL` instead of `DIRECT_URL` |

The first symptom is the one that wastes a day, because it appears intermittently
under concurrency and looks like a Prisma bug. It is not. It is a missing query
parameter.

`DIRECT_URL` on port 5432 is used by exactly two things: `prisma migrate`, and
the `JobLockService` client that holds session-level advisory locks. Both need a
session that survives more than one statement. Nothing else touches it.

## Failure modes

| Failure | How you notice | Effect | Response |
|---|---|---|---|
| Stale stock list after a transaction | Manager reports the wrong balance | Looks like data loss, high support cost | `DEL` after commit, verified by an invalidation test |
| Cache invalidated inside the transaction | Intermittent stale reads under load | Rare, hard to reproduce | Invalidation is always after commit, never inside |
| Redis unreachable | Latency spike, errors on cached endpoints | Everything breaks if reads are not fault tolerant | `cached()` catches Redis errors, logs, and falls through to the loader. A Redis outage degrades speed, not function |
| Rate limiter fails open | No 429s in the log at all | Login endpoint unthrottled | Rate limiting fails closed on a Redis error for auth routes, open for reads. The asymmetry is deliberate |
| Key written without a TTL | Redis memory climbs, a wrong value persists | Stale data forever | Lint rule bans bare `SET`, and a test asserts every key helper passes a TTL |
| N+1 introduced in a new endpoint | p95 for that route above budget | Slow screen | Prisma query logging in tests, and a query-count assertion on list endpoints |
| Unbounded list query | Timeout or a huge response | Endpoint unusable, memory spike | Every `findMany` carries a `take` |
| `connection_limit` too high after adding a replica | P2024 timeouts under normal load | Requests fail intermittently | Divide the pool budget by replica count, not per replica |
| Report over an unbounded date range | Slow query in the log, then a timeout | One endpoint down | `from` and `to` required, span capped at 366 days |

## Test plan

Rate limiting:

1. Eleven login attempts in one minute: the eleventh returns 429 with
   `RATE_LIMITED` and a `Retry-After` header.
2. The window slides. After advancing the clock past 15 minutes, the next
   attempt succeeds.
3. Two different usernames from the same IP have independent budgets.
4. With Redis stubbed to throw, an auth route returns 429 and a read route
   returns 200. This is the fail-closed and fail-open asymmetry.

Idempotency:

5. The same `Idempotency-Key` on two identical `POST /purchases` calls creates
   one `Purchase` row and returns the same body twice, the second with
   `Idempotency-Replayed: true`.
6. The same key with a different body returns 409 `IDEMPOTENCY_KEY_REUSED` and
   creates nothing.
7. Two users presenting the same key string both succeed, proving the key is
   user-scoped.

Caching, and the test that matters most:

8. **Invalidation actually happens on write.** Call `GET /inventory/stock` and
   assert the Redis key exists. Call `POST /inventory/transactions` for that
   outlet. Assert the key is gone. Call the GET again and assert the returned
   quantity reflects the transaction. Three assertions, and it fails the day
   somebody adds a second code path that writes stock without invalidating.
9. A second GET within the TTL does not hit the database. Assert with a Prisma
   query-count spy, not with timing.
10. After the TTL expires the loader runs again.
11. Publishing a game config deletes `bm:prod:game:config:{slug}` and the next
    read returns the new version.
12. `cached()` with Redis throwing returns the loaded value and logs a warning,
    rather than propagating the error.
13. Every key helper in the codebase produces a key matching
    `^bm:(dev|staging|prod):`. A table-driven test over the helper exports.

Query shape:

14. `GET /tasks` with 50 seeded tasks issues at most 3 queries. Counted with the
    Prisma `query` event, asserted as a hard number. This is the N+1 regression
    test and it is worth having on every list endpoint.
15. `GET /analytics/pnl` without `from` and `to` returns 400
    `DATE_RANGE_REQUIRED`. With a 400 day span it returns 400
    `DATE_RANGE_TOO_WIDE`.
16. Every list endpoint returns at most 100 rows when asked for 500.
