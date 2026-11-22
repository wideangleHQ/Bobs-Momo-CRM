# Database connection budget and stabilization (Phase 1)

Written 5 November 2026. Covers the audit, what changed, and what is still unverified.

## 1. Root cause

The Supabase Session Pooler allows **15 client connections for the whole project**. Three things in the code could each open far more than that:

1. **The main Prisma client had no pool size.** With no `connection_limit` in `DATABASE_URL`, Prisma uses 2 x CPU cores + 1. The local `apps/api/.env` has no `connection_limit`, and the development machine has 12 cores: **25 connections** from one process. (An earlier note says `connection_limit=10` was once in the URL; it is not there now.)
2. **The advisory-lock client had the same default** (`AdvisoryLockService`, a second `PrismaClient` on `DIRECT_URL`). In the local `.env` `DIRECT_URL` is also the pooler, so it was another potential 25.
3. **The owner dashboard fired about 17 queries at once** (4 sales totals, a series, a missing-entry scan that repeated the sales read, purchases, wastage, low stock, task counts, approvals, game counts), several of them nested `Promise.all` calls. Each concurrent query wants its own connection, so a dashboard on a large default pool opens new sessions until the pooler refuses with `EMAXCONNSESSION`.

Local development and Railway share one database, so the 15 are shared between this laptop, Railway, `prisma migrate deploy` on every Railway boot, and any Prisma Studio or script session.

A fourth, silent fault: the lock client used a multi-connection pool for a **session-scoped** `pg_try_advisory_lock`. The unlock could run on a different connection from the lock, leaving the lock held on the first connection and the job skipped on later ticks. It also did not catch errors from the lock query itself.

## 2. Connection budget

Verified = read from the repository. Assumed = needs confirmation.

| Process | Where | Before | After | Status |
|---|---|---|---|---|
| API main client | Local | 25 (default on 12 cores, no `connection_limit` in `.env`) | 3 | Verified |
| API job-lock client | Local | up to 25 | 1 | Verified |
| API main client | Railway | Prisma default, unknown (depends on the host's CPU count; `railway.json` sets `numReplicas: 1`) | 5 | Replica count verified in `railway.json`; Railway variables **not** inspected |
| API job-lock client | Railway | Prisma default | 1 | Verified |
| `prisma migrate deploy` | Railway, on every boot (Dockerfile CMD) | 1 transient | 1 transient | Verified |
| Prisma Studio, seeds, scripts, tests | Local, ad hoc | 1 to 25 each | unchanged, short lived | Assumed |
| BullMQ workers | none: jobs run in the API process with `@nestjs/schedule` and advisory locks | 0 | 0 | Verified |
| Other apps sharing the database | unknown | ? | ? | **Needs confirmation** |

Steady state after the change: local 3 + 1, Railway 5 + 1 = **10 of 15**, leaving 5 for migrations and tools. With a second Railway replica the sum is 16, which is over budget; lower `DB_POOL_SIZE` to 3 on Railway first (3 + 1 per replica, so 2 replicas = 8, plus local 4 = 12).

## 3. What changed

| Change | File |
|---|---|
| Pool size and timeout applied to the main client: `DB_POOL_SIZE` (5 production and staging, 3 otherwise, 10 under `NODE_ENV=test`), `DB_POOL_TIMEOUT_S` (20). A `connection_limit` already in the URL wins. | `src/common/prisma/database-url.ts`, `prisma.service.ts`, `config/env.ts` |
| Lock client pinned to one connection, no in-process overlap, errors never escape a cron tick, unlock failure logged | `src/common/jobs/advisory-lock.service.ts` |
| Reusable per-request concurrency limiter (not a global queue) | `src/common/concurrency/limiter.ts` |
| Owner dashboard: one sales read replaces six overlapping ones, one outlet read replaces two, 10 statements in total, at most 3 in flight | `src/modules/analytics/analytics.service.ts` |
| Identical dashboards requested while one is building share it | same |
| Pool timeout, unreachable database and pooler refusal return `503 COMMON_UNAVAILABLE` with `Retry-After: 2` instead of a 500 | `common/filters/all-exceptions.filter.ts`, `packages/shared/src/errors.ts` |
| Observability: pool settings logged at boot (no credentials), one line a minute of query count, average, maximum and slow count, connection faults at error level, credentials stripped from Prisma messages | `prisma.service.ts` |

Not changed: Redis caching (Phase 2), the Transaction Pooler, response shapes, calculations, indexes, `.env`.

## 4. Query concurrency

| | Before | After |
|---|---|---|
| Owner dashboard statements | about 17 | 10 (11 counted in the test, including a guard lookup) |
| Concurrent at once | about 17 | 3 |
| Sales table reads | 6 | 1 |
| Outlet reads | 2 | 1 |

`outletDashboard` and `functionalDashboard` keep their query shapes (they share the refactored task-count helper) and still fan out with plain `Promise.all`. They are smaller than the owner dashboard and were not the reported failure, so they were left for a follow-up.

## 5. Scheduler and workers

There is no BullMQ in the repository. Four crons (`outbox-dispatch` every 30 s, `overdue-tasks`, `recurring-tasks`, `low-stock-digest`) run inside every API process that has `JOBS_ENABLED` not set to `false`, guarded by Postgres advisory locks. Findings: a local `bun run dev` with Railway's database competes for the same locks and does the same work (set `JOBS_ENABLED=false` locally); the outbox dispatcher already uses `FOR UPDATE SKIP LOCKED` and exponential backoff (30 s, 2 min, 10 min, 1 h, five attempts), so retries do not storm.

## 6. Test evidence (isolated PostgreSQL 16 and Redis, never the shared database)

| Check | Result |
|---|---|
| `test/db-connections.e2e.test.ts` with `DB_POOL_SIZE=3`: 200 concurrent analytics requests in 4 waves | peak **4** app connections (3 + lock client) |
| Same load with the pool forced back to 25 | peak **27** |
| Lock held by another session makes the job skip, then run after release | passed |
| Same job cannot overlap itself; a failing job releases its lock | passed |
| Filter returns 503 for P2024, P1001 and EMAXCONNSESSION; 409 and 500 unchanged | passed |
| Postgres stopped under load, then restarted | 503 with `Retry-After`, automatic recovery on the next request |

## 7. Not verified

- Nothing was run against Supabase or Railway, so **the 15-session exhaustion is mitigated, not verified in production.**
- A real pool timeout (P2024) under saturation was verified only by the filter test, not end to end.
- Railway's variables were not inspected; if `DATABASE_URL` there already carries a `connection_limit`, that value wins over `DB_POOL_SIZE`.
- Whether `DIRECT_URL` on Railway is the direct host or the pooler decides whether the lock client really has a private session. On the pooler in session mode it works; on the transaction pooler it cannot.
