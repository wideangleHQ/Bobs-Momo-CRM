# Technology decisions

Each decision below is recorded as an ADR: the context that forced a choice,
the choice, what it costs us, and what it would cost to undo. Read the
Consequences section of each one. Every decision here has a downside, and the
ones that pretend otherwise are the ones that bite in week three.

Status values are Accepted, Superseded or Proposed. Dates are the date the
decision was made, not the date it was written down.

## ADR-001 NestJS, Prisma and PostgreSQL for the backend

### Status

Accepted, 18 August 2026.

### Context

The SRS names NestJS, Prisma and PostgreSQL. That part is settled. The open
question is shape: one deployable or several. The system covers inventory,
purchase, workforce, tasks, sales, analytics, notifications, messaging and a
customer game layer. Nine business areas is enough that somebody will suggest
microservices.

The actual load is 2 outlets, 20 to 30 staff users, and a public game page.
Write volume peaks at maybe 200 requests in the busiest ten minutes of the day,
around closing. The team is small and the window is three weeks.

### Decision

A modular monolith. One NestJS application, one deployable, one database. Each
business area is a Nest module under `src/modules` with its own controller,
service, repository and DTO folder. Modules talk to each other through injected
services, not HTTP. Cross-module writes happen in one `prisma.$transaction`.

Prisma is the only database access path. No raw SQL except in analytics
queries, where `$queryRaw` with parameter binding is allowed and reviewed.

### Consequences

The whole system deploys or fails together. A bad release in the CRM module
takes inventory down with it, which at 30 users is an inconvenience and at
3,000 users would be an outage worth engineering around.

Cron jobs live in the API process, which means the process cannot scale
horizontally without an advisory lock around each job. That work is not done
yet and is listed in chapter 06's scaling notes.

Module boundaries are a convention, not a compiler-enforced wall. Nothing stops
an engineer importing `PurchaseRepository` into `TasksService` and creating a
coupling that a service boundary would have refused. Code review is the only
enforcement. Chapter 33 lists this as a standing review item.

Prisma's generated client is heavy, and cold start on Railway is measurably
slower with it than with a thin query builder. That interacts badly with the
Hobby plan's idle behaviour.

### Reversal cost

Low to medium. The module structure is the seam. Extracting the CRM and game
layer into its own service is realistic in about a week: it shares only
`Customer`, `RewardIssue` and the outlet reference. Extracting inventory is
much harder because purchase, tasks and analytics all read it. If the monolith
ever splits, it splits at CRM first.

## ADR-002 Node 22 in production, Bun for local development and tests

### Status

Accepted, 18 August 2026. Revisit condition stated below.

### Context

The signed SRS names Bun as the runtime, with the rationale "fast startup and
efficient execution". Both claims are true of Bun in general. Neither claim has
been verified against this specific stack.

The specific risk is decorator metadata. NestJS resolves its entire dependency
injection graph from metadata that TypeScript emits when
`emitDecoratorMetadata` is on and `reflect-metadata` is loaded. Every
`@Injectable()`, every constructor parameter type, every `@Inject()` token
resolves through `Reflect.getMetadata`. Bun's transpiler and its Node API
shim have historically had gaps here, and the failure mode is not a clean
error. It is `Nest can't resolve dependencies of the InventoryService (?)` at
boot, on a service that works fine under Node, with no obvious cause.

The second risk is the Prisma query engine, a platform-specific native binary
loaded at runtime whose bindings assume Node's native module surface. Bun
implements most of that surface, and "most" and "all" are different words when
the failure lands on a Wednesday in week two.

Neither risk is a claim that Bun cannot run NestJS and Prisma. Both work for
many teams today. The claim is narrower: debugging a runtime-level DI or
native-binding issue costs an unbounded number of hours, and this project has
three weeks, a fixed price of Rs 45,000 and no slack. Two days on a runtime bug
is 5 percent of the budget spent to gain a startup improvement nobody in a
two-outlet QSR will perceive.

### Decision

Production runs Node 22 LTS. The Dockerfile's runtime stage is
`FROM node:22-alpine` and the process starts with `node dist/main.js`.

Bun stays in the repository for everything else. `bun install` is the package
manager and `bun.lockb` is the committed lockfile. Every script in
`package.json` runs through Bun, and `bun test` is the test runner.

The SRS commitment is therefore honoured where Bun's speed is actually felt, in
the developer workflow, while the production hot path runs on the runtime the
framework and ORM are tested against. This is a deviation from a signed
document and is stated plainly to the client rather than glossed over.

The production swap back to Bun is one line: change the runtime stage to
`FROM oven/bun:1-alpine` and the start command to `bun dist/main.js`.

### Consequences

Two runtimes in one repo. Something can work under `bun test` and fail under
Node in production, or the reverse. The mitigation is that CI runs the build
and the end-to-end suite on Node 22 in a container that matches production,
while unit tests run on Bun for speed. Anything that touches Prisma or Nest
bootstrapping is covered by the Node-side suite.

Bun's Jest-compatible test API is close to Jest but not identical. Some Nest
testing utilities and mocking patterns need adjusting, a friction cost paid in
small amounts across the build.

We lose whatever startup improvement Bun would have given on Railway cold
starts, which is the one place it would genuinely have helped.

### Revisit condition

Reconsider after Phase 1 ships and the system has run two weeks in production
without incident. The test is concrete: run the full end-to-end suite against a
Bun runtime container in staging. If it passes twice on consecutive days,
change the Dockerfile line and deploy to staging for a week before production.
Do not attempt this during the three week build.

### Reversal cost

One line in `apps/api/Dockerfile`, plus a staging soak. Call it a day of work
including verification. This is the cheapest reversal in this chapter, which is
exactly why deferring it is the right call.

## ADR-003 Postgres transactional outbox with @nestjs/schedule, not BullMQ

### Status

Accepted, 19 August 2026.

### Context

The SRS says "Upstash Redis for caching and background processing where
required". BullMQ is the default choice for background jobs in a Node stack, so
it deserves an explicit rejection rather than a silent one.

BullMQ's worker uses blocking Redis commands (`BZPOPMIN` and friends) and holds
a long-lived TCP connection per worker. Upstash's serverless model is built for
short request-response traffic, and a persistent blocking connection sits
awkwardly with a per-command pricing model and with Railway's habit of
restarting or spinning down a container. A worker asleep on a blocking read
when the container is recycled is a bug nobody wants at 22:30 during a closing
rush.

Then there is the volume. Low stock crossings, task assignments, overdue
sweeps, leave and purchase decisions, missed sales entries, broadcasts. Across
two outlets that is tens of events per day. Not tens per second.

The other property that matters more than throughput is atomicity. When
`InventoryService` decrements stock below the reorder level, the `LOW_STOCK`
notification must fire if and only if that transaction committed. Enqueueing to
Redis inside a Postgres transaction gives you neither guarantee: the enqueue can
succeed and the transaction roll back, or the transaction commit and the
enqueue fail.

### Decision

A transactional outbox in Postgres. `OutboxEvent` rows are inserted inside the
same `prisma.$transaction` as the business write. An `@nestjs/schedule` cron
job, `OutboxDispatcher`, polls every 15 seconds for rows where
`status = 'PENDING'` and `availableAt <= now()`, claims them by moving them to
`PROCESSING`, dispatches, and marks `DONE` or `DEAD`. Failed transport attempts
get exponential backoff by pushing `availableAt` forward.

Redis is kept, and earns its place doing three things it is genuinely good at:
caching read models, storing idempotency replays, and counting rate limit
buckets. All three are fire-and-forget and all three tolerate a total Redis
outage without data loss.

This keeps the signed cost table in SRS section 18 intact. Upstash stays on the
Fixed 250 MB plan at $10 per month, no new line item appears, and the
under Rs 5,000 monthly ceiling holds.

### Consequences

Latency floor of 15 seconds on every notification. A leave request submitted at
14:00:01 produces a WhatsApp message at up to 14:00:16. For this business that
is invisible. For a system where somebody is watching a screen waiting, it
would not be.

Every 15 seconds the API runs an indexed query against `outbox_event` whether
or not there is work. The index `@@index([status, availableAt])` makes it cheap,
but it is a permanent floor of about 5,760 queries per day against the
database that a push-based queue would not pay.

No dead letter UI, no retry dashboard, no job concurrency controls. Requeueing a
`DEAD` event is a SQL `UPDATE`. Chapter 22 documents the exact statement.

### Revisit condition

When sustained notification volume passes roughly 500 events per hour, or when
a second API replica is needed. At that point BullMQ pays for itself and the
outbox table becomes the durable handoff into it rather than the queue itself.

### Reversal cost

Low. The outbox table stays either way. `OutboxDispatcher.dispatch()` changes
from "call the handler directly" to "add a BullMQ job". Two days including a
worker deployment and a Redis plan upgrade.

## ADR-004 Supabase Postgres behind the Supavisor pooler

### Status

Accepted, 19 August 2026.

### Context

Supabase is named in the SRS for the database, storage and backups, at $25 per
month on Pro. That covers three of our needs in one line item, which is most of
why it is there.

Supabase fronts Postgres with Supavisor, a pooler with two modes on two ports.
Session mode on 5432 gives one client one backend connection for the life of
the session. Transaction mode on 6543 hands a backend connection to a client
only for the duration of a transaction, then returns it to the pool.

Transaction mode is what lets a small Postgres instance survive multiple
application instances. It also breaks prepared statements. Prisma prepares
statements by default and reuses them by name, and under transaction mode the
next transaction may land on a different backend connection that has never
heard of that name, or one where the name is already taken. The symptom is
`ERROR: prepared statement "s0" already exists`, intermittently, under load,
never in local development.

Migrations have the opposite requirement. `prisma migrate deploy` runs DDL,
advisory locks and multi-statement scripts that need a stable session. They must
not go through transaction-mode pooling.

### Decision

Two URLs, two ports, two jobs.

`DATABASE_URL` points at Supavisor transaction mode on port 6543 with
`pgbouncer=true&connection_limit=1`. The `pgbouncer=true` flag tells Prisma to
stop using named prepared statements. The `connection_limit=1` keeps each
application instance's Prisma pool to a single connection, because the real
pooling is happening in Supavisor and a second layer of pooling on top just
consumes Supavisor's budget.

`DIRECT_URL` points at port 5432 and is used only by `prisma migrate` and
`prisma db push`. It is declared in the Prisma datasource block so the CLI picks
it up automatically.

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

The exact env var shapes:

```bash
# transaction-mode pooler, application traffic
DATABASE_URL="postgresql://postgres.PROJECTREF:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# direct connection, migrations only
DIRECT_URL="postgresql://postgres.PROJECTREF:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

Note that the username is `postgres.PROJECTREF`, not `postgres`. Supavisor uses
the project reference as part of the username to route to the right tenant.
Getting this wrong produces a `Tenant or user not found` error that reads like a
password problem and is not.

### Consequences

Two connection strings to keep in sync in three environments. Every developer
who has seen only one `DATABASE_URL` before will at some point set both to the
same value, and the failure is silent until the first migration or the first
load spike.

No `LISTEN`/`NOTIFY` and no session-scoped advisory locks over the pooled
connection. Both are useful and both are unavailable on the application path.
This is a second reason the outbox in ADR-003 polls rather than listens.

Transaction-scoped advisory locks (`pg_advisory_xact_lock`) do still work, which
is what the future cron-job locking will use.

Prisma's own connection pool is effectively disabled at
`connection_limit=1`, so pool timeouts surface as `P2024` under bursts. That
error is expected behaviour under this configuration, not a misconfiguration.

Region matters. Supabase in `ap-south-1` (Mumbai) is roughly 30 to 40 ms from a
Railway service in Singapore and roughly 5 ms from one in Mumbai. Every query in
a request multiplies that. Chapter 34 covers the region pinning.

### Reversal cost

Medium. Moving off Supabase means moving the database, the storage bucket and
the backup arrangement together. Postgres itself is portable via `pg_dump`, but
`TaskAttachment.storageKey` values point at Supabase Storage object keys, so a
migration means rewriting those and re-uploading the objects. Call it three to
five days.

## ADR-005 Railway hosts both the API and the web app

### Status

Accepted, 20 August 2026.

### Context

The SRS puts the backend on Railway and describes the frontend as "Next.js
production hosting", which everybody reads as Vercel. Two reasons not to.

The first is licensing. Vercel's Hobby tier prohibits commercial use. Bob's Momo
is a business running its operations on this system, which is commercial use by
any reading. The honest options are Vercel Pro at $20 per month per seat, or a
different host.

The second is arithmetic. The signed ceiling is Rs 5,000 per month for
everything. At roughly Rs 84 to the dollar that is about $59.

```text
  Service                    Plan            USD/mo    INR/mo
  ────────────────────────── ─────────────── ──────── ────────
  Railway (api + web)        Hobby              5.00      420
  Supabase                   Pro               25.00    2,100
  Upstash Redis              Fixed 250 MB      10.00      840
  Domain + DNS               annual, prorated   1.50      126
  ────────────────────────── ─────────────── ──────── ────────
  Total                                        41.50    3,486
  Headroom to the Rs 5,000 ceiling                       1,514
  ────────────────────────── ─────────────── ──────── ────────
  With Vercel Pro instead                      61.50    5,166
  Over ceiling by                                          166
```

Vercel Pro alone puts the fixed stack over the signed number before WhatsApp
usage, which is billed separately and is variable. Railway Hobby's $5 includes
$5 of usage credit and both services fit inside it at this scale.

The third reason is latency. Two services in one Railway project share a
private network, so Server Component fetches go over `api.railway.internal` in
single-digit milliseconds. A Vercel-hosted frontend calling a Railway-hosted API
crosses the public internet on every server render, and if the two regions
differ that is 40 to 200 ms added to a page already waiting on Supabase in
Mumbai.

### Decision

One Railway project, two services, `api` and `web`, both pinned to the same
region as the Supabase project. `web` reaches `api` over the private network for
server-side fetches and over the public domain for browser fetches.

### Consequences

No Vercel edge network, no automatic image optimisation CDN, no preview
deployment per pull request out of the box. Static assets are served by the
Next.js server on Railway rather than from a global CDN. For users who are all
within 30 km of Bhubaneswar, this costs approximately nothing. For the public
game page, if it is ever shared widely, it would matter.

Railway builds with Nixpacks or a Dockerfile rather than Vercel's Next.js-aware
pipeline, which is more configuration for us to own.

Both services share one Railway project's usage budget, so a runaway build loop
or a memory leak in one bills against the other.

### Reversal cost

Low. Moving `web` to Vercel is a repo connect, an env var copy and a DNS change.
Half a day. The decision is a cost decision, not an architectural one, and
should be revisited the moment the client wants a marketing site or the game
page gets real traffic.

## ADR-006 Salary storage without payroll computation in Phase 1

### Status

Accepted, 20 August 2026. Resolves SRS open question 4.

### Context

The SRS asks whether payroll computation is in scope or storage only. Payroll
in India is not a feature, it is a compliance surface: provident fund, employee
state insurance, state-varying professional tax, TDS, statutory bonus, gratuity
and audit-survivable payslip formats. Odisha professional tax alone has its own
slabs and filing calendar. Building that correctly takes longer than the whole
three week window. Building it incorrectly creates client liability worth many
multiples of the Rs 45,000 fee.

### Decision

`SalaryRecord` stores structure only: `monthlyCtc`, optional `basic`, optional
`allowances`, an effective date range, and a note. No deductions, no payslips,
no month-end run, no statutory calculation. Read access is restricted to
`HR_ACCOUNTS` and `OWNER` through the permission key `workforce.salary.read`.

Attendance data is captured completely enough that a payroll module could later
compute from it: `AttendanceDay` carries `workedMins`, `lateMins`, `breakMins`
and a status, and `LeaveRequest` carries typed leave with a `dayCount`. The
inputs exist. The computation does not.

### Consequences

The client still runs payroll in Excel. The system does not remove that work, it
only removes the "what was Ramesh's salary in March" lookup problem.

An effective-dated salary history exists from day one, which is the part that is
genuinely painful to reconstruct later.

Somebody will ask for a payslip button in week two. The answer is chapter 04's
scope register, not a code change.

### Reversal cost

High, and deliberately so. Payroll is a Phase 2 module with its own
requirements gathering, not a feature toggle. Estimate three to four weeks
including compliance review. The data model does not block it.

## ADR-007 Custom credentials authentication with argon2id, no OAuth

### Status

Accepted, 20 August 2026.

### Context

The SRS excludes Google OAuth explicitly, twice, and attributes it to client
instruction. This is worth stating clearly: the exclusion is a client
instruction, not an engineering preference. Given a free choice, OAuth or a
managed identity provider would be the cheaper and safer option for a team this
size, because password handling is the single most common place small
applications get breached.

The client's reasoning is operational. Kitchen staff do not reliably have
Google accounts, QSR turnover is high, and the owner wants to create and
disable accounts directly without depending on anybody's personal email.

### Decision

Username and password credentials stored as argon2id hashes. A short-lived
access JWT plus a rotating opaque refresh token stored hashed in
`RefreshToken`, with `familyId` for reuse detection. Account lockout after
repeated failures via `failedLogins` and `lockedUntil`. `mustReset` forces a
password change on first login for admin-created accounts. Chapter 13 owns the
full flow.

argon2id parameters: 19 MiB memory cost, time cost 2, parallelism 1, which is
the OWASP baseline and fits inside a Railway Hobby container's memory without
making login a visible pause.

### Consequences

We own a password reset flow. Without an email provider in the fixed cost
budget, reset in Phase 1 is manager-initiated: an `OWNER` or `HR_ACCOUNTS` user
sets a temporary password and `mustReset` to true, and hands it over in person.
This works for 30 people in two buildings and does not work for 300 across ten
cities.

We own lockout handling, which means we own the support case where a store
manager is locked out at 06:45 and the only person who can unlock them is
asleep. The mitigation is that `lockedUntil` expires automatically after 15
minutes rather than requiring manual intervention.

No SSO, no device-level session revocation beyond revoking refresh token
families, and no second factor. Adding TOTP later is straightforward. Adding it
now is scope nobody asked for.

### Reversal cost

Medium. Adding an OAuth provider alongside credentials is roughly three days:
one Passport strategy, a provider link table, and an account-linking flow.
Replacing credentials entirely would strand existing accounts and is not
realistic without a migration window.

## ADR-008 Append-only stock ledger with a materialised balance

### Status

Accepted, 21 August 2026.

### Context

Two ways to answer "how much chicken mince is at Patia right now". Sum the
ledger on every read, or keep a running balance and update it on every write.

Summing is correct by construction and cannot drift. It also gets slower every
day, and the number is read constantly: the stock list, the low stock check on
every transaction, the dashboard, the issue-stock form's validation. At a
million ledger rows that read happens dozens of times per page.

### Decision

`StockTransaction` is an append-only ledger. Rows are never updated and never
deleted. A correction is a new row with `type = ADJUSTMENT` and a mandatory
`reason`.

`ItemStock.qtyOnHand` is the materialised balance, one row per item per outlet,
updated inside the same transaction as the ledger insert, under a
`SELECT ... FOR UPDATE` row lock. Every ledger row also stores `balanceAfter`,
so the ledger is self-describing and a drift check is a single query comparing
the latest `balanceAfter` against `ItemStock.qtyOnHand`.

### Consequences

Two writes per stock movement instead of one, and a row lock that serialises
concurrent movements of the same item at the same outlet. That is the correct
behaviour and it does mean two staff issuing the same item queue behind each
other for a few milliseconds.

Drift is possible if anybody ever writes to `item_stock` outside the service.
The defence is a nightly reconciliation job that recomputes each balance from
the ledger and logs a discrepancy, plus the review rule that `item_stock` is
only ever written by `InventoryService`.

`balanceAfter` on every row means the ledger is only valid read in insert order
per item and outlet. Backdating a transaction would invalidate every subsequent
`balanceAfter`. Backdating is therefore not supported: `businessDate` can be
set, but the row still appends at the end of the ledger.

Storage grows forever. At two outlets, 150 items and roughly 40 movements per
outlet per day, that is about 30,000 rows per year. Irrelevant against Supabase
Pro's 8 GB.

### Reversal cost

Low in one direction, high in the other. Dropping the materialised balance and
computing on read is a query change plus a cache. Going the other way, from
computed-on-read to materialised, would need a backfill and a lock audit.
Starting materialised is the cheaper starting point.

## ADR-009 Tailwind and shadcn/ui, mobile first

### Status

Accepted, 21 August 2026.

### Context

The interface needs about 40 screens in three weeks. The options are a paid
component library, a full design system built in-house, or Tailwind with
copy-in components.

Where the system is used decides more than any of that. Kitchen staff complete
checklists on a phone, standing, with wet or gloved hands. Managers approve
leave on a phone. Only the owner's analytics views and the roster editor are
realistically desktop screens. The SRS says the same thing in its
non-functional requirements: "usable on desktop and mobile browsers, since
staff will access it on phones on the floor".

### Decision

Tailwind CSS 4 with shadcn/ui components, which are copied into the repo under
`components/ui` rather than installed as a dependency. Radix primitives
underneath give keyboard handling and accessible focus management without us
writing any of it.

Mobile first means the base Tailwind classes describe the phone layout and
`md:` and `lg:` prefixes add the desktop layout, not the reverse. Tap targets
are 44 px minimum. Primary actions sit within thumb reach at the bottom of the
viewport on task and checklist screens, not in a top-right toolbar.

### Consequences

Components live in our repo, so upstream fixes are not automatic. Updating a
shadcn component is a manual re-copy and a diff review.

No purchased design system means no ready-made data grid. The purchase and
stock history tables are built from `Table` plus TanStack Query pagination, and
they are plainer than a commercial grid. Acceptable at 25 rows per page.

Mobile-first costs desktop density. The owner's dashboard shows fewer numbers
per screen than a desktop-first design would. Chapter 29 covers where we break
that rule for analytics views.

### Reversal cost

Very high. Restyling 40 screens is a rebuild of the frontend. This is the
stickiest decision in the chapter, which is why it is worth being deliberate
about it now.

## ADR-010 Monorepo with a shared zod package

### Status

Accepted, 21 August 2026.

### Context

The API and the web app must agree on every request and response shape. The
usual failure is that they agree on Monday, diverge on Thursday, and nothing
catches it until a form posts `qty` to an endpoint expecting `quantity`. The
options are generating an OpenAPI spec from Nest decorators and generating a
client from it, or sharing the schema definitions directly.

### Decision

A single repository with `apps/api`, `apps/web` and `packages/shared`.
`packages/shared` exports zod schemas and the types inferred from them. The API
validates incoming requests with those schemas through `ZodValidationPipe`. The
web app validates forms with the same schemas through `zodResolver`, and types
its TanStack Query results from the same inferred types.

```ts
// packages/shared/src/inventory.ts
export const recordTransactionSchema = z.object({
  itemId:   z.string().uuid(),
  outletId: z.string().uuid(),
  type:     z.nativeEnum(StockTxnType),
  quantity: z.coerce.number().positive().multipleOf(0.001),
  reason:   z.string().min(3).optional(),
  note:     z.string().max(500).optional(),
  businessDate: z.string().date(),
}).refine(
  (v) => !['WASTAGE', 'ADJUSTMENT'].includes(v.type) || !!v.reason,
  { message: 'reason is required for wastage and adjustments',
    path: ['reason'] },
);

export type RecordTransactionInput =
  z.infer<typeof recordTransactionSchema>;
```

Change the schema and both sides break at compile time, in the same pull
request. That is the entire point.

### Consequences

One version, one release, one CI pipeline. The API and the web app cannot be
deployed independently without care, because a schema change lands in both at
once. Railway deploys both services from the same commit, so this is consistent
but it also means a frontend-only fix redeploys the API.

`packages/shared` becomes a magnet. Somebody will put a React hook or a Prisma
type in it. The rule is that `packages/shared` imports nothing from `apps/*`,
has no runtime dependency beyond zod, and contains no framework code. Enforced
by review and by its `package.json` dependency list being one line long.

The rule in the `.refine()` above lives in two places: the schema and the
service that also enforces it. The schema catches shape, the service catches
state. That duplication is intentional, since a schema cannot know the current
stock balance.

No generated API client and no OpenAPI document. If the API is ever handed to a
third party, that document has to be written.

### Reversal cost

Medium. Splitting the repo means publishing `packages/shared` to a private
registry and versioning it, which introduces exactly the drift the monorepo was
built to prevent. Two to three days of tooling, and a permanent ongoing cost.

## Rejected alternatives

| ADR | Option not taken | Why not |
|---|---|---|
| 001 | Microservices per business domain | Nine deployables for 30 users buys distributed-systems problems and no benefit. |
| 001 | TypeORM or raw `pg` instead of Prisma | The SRS names Prisma and its migration tooling is the fastest path in a three week window. |
| 002 | Bun in production as the SRS states | An unbounded debugging risk on NestJS DI metadata and the Prisma engine binary, for a startup gain nobody in the building will notice. |
| 002 | Node everywhere, drop Bun entirely | Discards the SRS commitment with nothing gained, since Bun's install and test speed is real and costs nothing locally. |
| 003 | BullMQ on Upstash Redis | Blocking commands and persistent connections fit badly with Upstash's model and Railway restarts, at tens of events per day. |
| 003 | Postgres `LISTEN`/`NOTIFY` for event dispatch | Unavailable through Supavisor transaction-mode pooling, which the app path requires. |
| 004 | Session-mode pooling on 5432 for app traffic | Burns one backend connection per app instance and does not scale past a second replica. |
| 004 | Self-hosted Postgres on Railway | Saves $25 but we then own backups, storage and point-in-time recovery for a client with no ops team. |
| 005 | Vercel Pro for the frontend | $20 per month puts the fixed infrastructure total over the signed Rs 5,000 ceiling before WhatsApp usage. |
| 005 | Vercel Hobby for the frontend | Its terms prohibit commercial use, and this is a commercial deployment. |
| 006 | Full payroll with statutory deductions | Indian statutory compliance is a multi-week module and getting it wrong creates client liability. |
| 007 | Google OAuth or a managed identity provider | Excluded by client instruction, and kitchen staff turnover makes personal-account dependency impractical. |
| 008 | Compute stock balances by summing the ledger on read | The balance is read dozens of times per page and the ledger only grows. |
| 009 | A purchased admin component library | Licence cost against a Rs 45,000 project, plus a house style we cannot change cheaply. |
| 009 | Desktop-first responsive design | Staff use phones on the floor, so the phone layout is the one that must be right first. |
| 010 | OpenAPI generation plus a generated client | An extra build step and a generated artefact to review, when sharing zod schemas gives the same safety directly. |
| 010 | Separate repositories for api and web | Reintroduces contract drift between the two, which is the exact problem being solved. |
