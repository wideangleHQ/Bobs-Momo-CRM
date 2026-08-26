# CI and CD

Two people are shipping this in three weeks. The pipeline exists so neither of
them has to remember anything at 11pm. Push a branch, get an answer in under
eight minutes, merge, watch it reach staging on its own, click once for
production.

Everything below runs on GitHub Actions and Railway. There is no self-hosted
runner, no Kubernetes, and no build server that somebody has to keep alive.

## The pipeline

```text
   git push (feature branch)
            │
            ▼
   ┌────────────────────┐
   │ lint + typecheck   │  ruff-equivalent: eslint, prettier --check,
   │ ~60 s              │  tsc --noEmit across api, web and shared
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐
   │ unit tests         │  bun test, no I/O, ~15 s
   │ ~30 s              │
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐
   │ build              │  nest build + next build, artefacts cached
   │ ~90 s              │
   └─────────┬──────────┘
             ▼
   ┌──────────────────────────────────────┐
   │ integration + e2e                    │  service containers:
   │ ~4 min                               │  postgres:15, redis:7
   │ prisma migrate deploy -> test schema │  supertest + vitest
   └─────────┬────────────────────────────┘
             ▼
   ┌────────────────────┐
   │ migration check    │  prisma migrate diff vs production
   │ ~20 s              │  fails on drift or on a missing migration
   └─────────┬──────────┘
             ▼
      required checks green
             │
             ▼  squash merge to main
   ┌────────────────────┐
   │ deploy staging     │  railway up --service api --environment staging
   │ ~3 min             │  then web
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐
   │ smoke test staging │  6 checks, see the end of this chapter
   │ ~40 s              │  failure = automatic rollback, no gate reached
   └─────────┬──────────┘
             ▼
   ╔════════════════════╗
   ║ manual gate        ║  GitHub environment "production"
   ║ a human approves   ║  required reviewer: the lead
   ╚═════════╤══════════╝
             ▼
   ┌────────────────────┐
   │ migrate production │  prisma migrate deploy against prod DATABASE_URL
   │ ~15 s              │  runs BEFORE the new code starts
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐
   │ deploy production  │  railway up, rolling restart
   │ ~3 min             │
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐
   │ post-deploy smoke  │  same 6 checks against the production URL
   │ ~40 s              │  failure pages the lead and prints the
   └────────────────────┘  rollback command
```

Total for a pull request: about seven minutes. Total from merge to production
including the human gate: about eight minutes of machine time.

## The pull request workflow

```yaml
# .github/workflows/pr.yml
name: pull request

on:
  pull_request:
    branches: [main]

concurrency:
  group: pr-${{ github.head_ref }}
  cancel-in-progress: true

env:
  BUN_VERSION: '1.1.38'
  NODE_VERSION: '22'

jobs:
  static:
    name: lint and typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ env.BUN_VERSION }}

      - name: Cache bun install
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lockb') }}
          restore-keys: bun-${{ runner.os }}-

      - run: bun install --frozen-lockfile

      - name: Generate Prisma client
        run: bunx prisma generate --schema apps/api/prisma/schema.prisma

      - run: bun run lint
      - run: bun run format:check
      - run: bun run typecheck

  unit:
    name: unit tests
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ env.BUN_VERSION }}
      - uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lockb') }}
      - run: bun install --frozen-lockfile
      - run: bunx prisma generate --schema apps/api/prisma/schema.prisma
      - run: bun run test:unit -- --coverage
      - name: Upload coverage summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-unit
          path: coverage/
          retention-days: 7

  build:
    name: build
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ env.BUN_VERSION }}
      - uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lockb') }}
      - name: Cache Next.js build
        uses: actions/cache@v4
        with:
          path: apps/web/.next/cache
          key: next-${{ runner.os }}-${{ hashFiles('bun.lockb') }}-${{ github.sha }}
          restore-keys: next-${{ runner.os }}-${{ hashFiles('bun.lockb') }}-
      - run: bun install --frozen-lockfile
      - run: bunx prisma generate --schema apps/api/prisma/schema.prisma
      - run: bun run build

  integration:
    name: integration and e2e
    runs-on: ubuntu-latest
    needs: [unit, build]

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: bobsmomo
          POSTGRES_PASSWORD: bobsmomo
          POSTGRES_DB: bobsmomo_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U bobsmomo"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      TEST_DATABASE_URL: postgresql://bobsmomo:bobsmomo@localhost:5432/bobsmomo_test
      DATABASE_URL: postgresql://bobsmomo:bobsmomo@localhost:5432/bobsmomo_test
      REDIS_URL: redis://localhost:6379
      JWT_ACCESS_SECRET: ci-access-secret-not-used-in-prod
      JWT_REFRESH_SECRET: ci-refresh-secret-not-used-in-prod
      APP_TIMEZONE: Asia/Kolkata
      WHATSAPP_ENABLED: 'false'
      NODE_ENV: test

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ env.BUN_VERSION }}
      - uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lockb') }}
      - run: bun install --frozen-lockfile

      - name: Generate Prisma client
        run: bunx prisma generate --schema apps/api/prisma/schema.prisma

      - name: Apply migrations to the test database
        run: bunx prisma migrate deploy --schema apps/api/prisma/schema.prisma

      - name: Integration and e2e tests
        run: bun run test:integration -- --coverage

      - name: Enforce coverage floors
        run: bun run coverage:check

      - name: Install Playwright browsers
        run: bunx playwright install --with-deps chromium

      - name: Seed and run browser journeys
        run: |
          bun run db:seed:test
          bun run start:test &
          bunx wait-on http://localhost:3000/healthz -t 60000
          bun run test:browser

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 14

  migration-check:
    name: migration safety
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ env.BUN_VERSION }}
      - run: bun install --frozen-lockfile

      - name: Detect drift between production and the migration history
        env:
          PROD_DATABASE_URL: ${{ secrets.PROD_DATABASE_URL_READONLY }}
        run: bun run scripts/check-migration-drift.ts

      - name: Fail if schema.prisma changed without a migration
        run: |
          bunx prisma migrate diff \
            --from-migrations apps/api/prisma/migrations \
            --to-schema-datamodel apps/api/prisma/schema.prisma \
            --shadow-database-url "$TEST_SHADOW_URL" \
            --exit-code && echo "schema and migrations agree"
        env:
          TEST_SHADOW_URL: postgresql://bobsmomo:bobsmomo@localhost:5432/shadow
```

The `--frozen-lockfile` flag is the point of committing `bun.lockb`. If a
dependency drifted, the install fails rather than silently resolving something
new on a Tuesday.

`prisma generate` runs in every job that touches TypeScript, because the
generated client is what `tsc` type checks against and it is not committed.

## The deploy workflow

```yaml
# .github/workflows/deploy.yml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      target:
        description: Environment to deploy
        required: true
        default: staging
        type: choice
        options: [staging, production]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

jobs:
  staging:
    name: deploy staging
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging.erp.bobsmomo.in
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: '1.1.38' }
      - run: bun install --frozen-lockfile

      - name: Install Railway CLI
        run: bun add -g @railway/cli

      - name: Apply migrations to staging
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
        run: bunx prisma migrate deploy --schema apps/api/prisma/schema.prisma

      - name: Deploy API
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service api --environment staging --detach

      - name: Deploy web
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service web --environment staging --detach

      - name: Wait for the health check
        run: bunx wait-on https://staging-api.erp.bobsmomo.in/healthz -t 180000

      - name: Smoke test
        env:
          SMOKE_BASE_URL: https://staging-api.erp.bobsmomo.in
          SMOKE_WEB_URL: https://staging.erp.bobsmomo.in
          SMOKE_USER: ${{ secrets.STAGING_SMOKE_USER }}
          SMOKE_PASSWORD: ${{ secrets.STAGING_SMOKE_PASSWORD }}
        run: bun run smoke

      - name: Roll back staging on smoke failure
        if: failure()
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway rollback --service api --environment staging --yes

  production:
    name: deploy production
    runs-on: ubuntu-latest
    needs: staging
    environment:
      name: production           # required reviewer configured in GitHub
      url: https://erp.bobsmomo.in
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: '1.1.38' }
      - run: bun install --frozen-lockfile
      - run: bun add -g @railway/cli

      - name: Apply migrations to production
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
        run: bunx prisma migrate deploy --schema apps/api/prisma/schema.prisma

      - name: Deploy API
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service api --environment production --detach

      - name: Deploy web
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service web --environment production --detach

      - name: Wait for the health check
        run: bunx wait-on https://api.erp.bobsmomo.in/healthz -t 180000

      - name: Post-deploy smoke test
        env:
          SMOKE_BASE_URL: https://api.erp.bobsmomo.in
          SMOKE_WEB_URL: https://erp.bobsmomo.in
          SMOKE_USER: ${{ secrets.PROD_SMOKE_USER }}
          SMOKE_PASSWORD: ${{ secrets.PROD_SMOKE_PASSWORD }}
        run: bun run smoke

      - name: Announce failure
        if: failure()
        run: |
          echo "PRODUCTION SMOKE FAILED"
          echo "Roll back with:"
          echo "  railway rollback --service api --environment production"
          exit 1
```

Migrations run before the code deploys, on purpose. See the zero-downtime section
below for why that ordering forces backward-compatible migrations.

## Branch and merge policy

Trunk based. `main` is always deployable. Feature branches live hours or a day,
not a week, and are named `type/short-description` matching the commit type:
`feat/stock-transfer`, `fix/purchase-total-rounding`.

Direct pushes to `main` are blocked by branch protection. The required checks are
`lint and typecheck`, `unit tests`, `build`, `integration and e2e` and
`migration safety`. One approving review is required. Stale reviews are dismissed
on new commits. Administrators are included in the restriction, because the
person most likely to push a quick fix straight to main at midnight is the person
with admin.

Merges are squash merges. The squash commit message is the pull request title and
must follow Conventional Commits:

```text
type(scope): description

feat(inventory): outlet to outlet stock transfer
fix(purchase): compute lineTotal at 2dp with half-up rounding
chore(ci): cache the Next.js build directory
```

Types are `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `security`.
Scopes are the module directory names: `auth`, `inventory`, `purchase`, `vendors`,
`workforce`, `tasks`, `sales`, `analytics`, `notifications`, `crm`, `web`,
`shared`, `db`, `ci`.

A `commitlint` step in the pull request workflow validates the title. It exists so
the changelog generates itself and so `git log --oneline` on `main` reads as a
list of things that happened rather than "wip", "fix", "fix again".

## The migration safety gate

Two failures are worth catching before a human sees them.

The first is drift: someone changed production's schema by hand, so the next
`prisma migrate deploy` will either fail or apply on top of a shape it does not
expect. The check compares production's live schema against what the migration
folder says it should be.

```ts
// scripts/check-migration-drift.ts
import { execFileSync } from 'node:child_process';

const prod = process.env.PROD_DATABASE_URL_READONLY;
if (!prod) throw new Error('PROD_DATABASE_URL_READONLY is not set');

const out = execFileSync(
  'bunx',
  [
    'prisma', 'migrate', 'diff',
    '--from-url', prod,
    '--to-migrations', 'apps/api/prisma/migrations',
    '--shadow-database-url', process.env.TEST_SHADOW_URL!,
    '--script',
  ],
  { encoding: 'utf8' },
);

const meaningful = out
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('--'));

if (meaningful.length > 0) {
  console.error('PRODUCTION SCHEMA DRIFT DETECTED');
  console.error('Production differs from the migration history by:');
  console.error(meaningful.join('\n'));
  process.exit(1);
}
console.log('No drift. Production matches the migration history.');
```

The second is a schema file edited without a migration generated. That is the
`prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` step in
the workflow. Exit code 2 means there is a difference, which means somebody edited
`schema.prisma` and forgot `prisma migrate dev`.

The rule that follows from both: a migration is applied to production by the
deploy workflow and by nothing else. No engineer runs `prisma migrate deploy`,
`prisma db push`, or raw DDL against the production database from a laptop. The
history in `_prisma_migrations` has to be the truth, and a hand-applied change
makes it a lie that the next deploy discovers.

The exception is a production incident where the fix cannot wait for a pull
request cycle, for example an index that has to exist right now to stop the
database timing out. The authorisation is: the lead engineer approves it in
writing in the incident channel, the SQL is pasted there before it is run, and a
migration reproducing exactly that SQL is opened as a pull request the same day
so `_prisma_migrations` catches up. If that pull request is not merged within 24
hours, the drift check fails every subsequent build until somebody deals with it.
That is the intended pressure.

## Railway configuration

One Railway project, two environments (`staging` and `production`), two services
in each.

| Service | Root | Build | Start | Public URL |
|---|---|---|---|---|
| `api` | `apps/api` | `bun install --frozen-lockfile && bunx prisma generate && bun run build` | `node dist/main.js` | `api.erp.bobsmomo.in` |
| `web` | `apps/web` | `bun install --frozen-lockfile && bun run build` | `bun run start` | `erp.bobsmomo.in` |

The API starts under Node 22, not Bun. That is ADR-002 in
[chapter 07](07-technology-decisions.md): Bun installs, builds and tests, Node
runs the server, because NestJS decorator metadata plus the Prisma query engine on
Bun is not a risk worth taking in a three week window. The swap back is one line
in this file.

```json
// apps/api/railway.json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "bun install --frozen-lockfile && bunx prisma generate && bun run build",
    "watchPatterns": ["apps/api/**", "packages/shared/**"]
  },
  "deploy": {
    "startCommand": "node dist/main.js",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5,
    "numReplicas": 1,
    "sleepApplication": false
  }
}
```

```json
// apps/web/railway.json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "bun install --frozen-lockfile && bun run build",
    "watchPatterns": ["apps/web/**", "packages/shared/**"]
  },
  "deploy": {
    "startCommand": "bun run start",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5,
    "numReplicas": 1,
    "sleepApplication": false
  }
}
```

`healthcheckPath` is `/healthz`, which returns 200 as soon as the process is
listening and Prisma has connected. It does not check Redis or WhatsApp, because a
Redis blip should degrade the dashboard cache, not stop Railway from routing
traffic. `/readyz` does check the dependencies and is what the uptime monitor and
the smoke tests use. [Chapter 36](36-observability-and-audit.md) covers the
difference.

`healthcheckTimeout` of 60 seconds is generous for a service that boots in about
8. It absorbs a cold Supabase connection on the first request after an idle
period.

`sleepApplication` is false on both. Railway's sleep saves credits but adds a
cold start of several seconds, and the first thing a kitchen manager does at
06:30 is open the app. Paying for the idle hours is cheaper than the impression
that the system is slow.

Environment variables are set per environment in the Railway dashboard, never in
this file and never in the repository. The full list is in
[chapter 09](09-environments-and-configuration.md). Staging and production have different values
for `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`SUPABASE_SERVICE_KEY`, `WHATSAPP_ACCESS_TOKEN` and `CORS_ORIGINS`. Staging runs
with `WHATSAPP_ENABLED=false` so a test leave approval never messages a real
employee's phone.

## Zero downtime at this size

Railway does a rolling restart: it starts the new container, waits for
`/healthz` to answer 200, shifts traffic, then stops the old container. With one
replica the overlap is roughly 10 to 30 seconds during which both the old and the
new code are serving requests against the same database.

That overlap is the whole zero-downtime problem here. It means every migration
must be backward compatible with the release currently running, for the duration
of the rollout. Concretely: no `DROP COLUMN` in the same deploy that stops writing
to it, no `NOT NULL` added to a column the old code still inserts as null, no
renaming anything.

The pattern is expand and contract, and [chapter 11](11-migrations-and-seed.md) owns it in
detail. The summary is three deploys where a naive change would be one:

```text
  Deploy 1 (expand)     Deploy 2 (migrate)      Deploy 3 (contract)
  ─────────────────     ──────────────────      ───────────────────
  add new column,       code reads new,         drop old column
  nullable              writes both, then       after a release that
  code writes both      backfill runs           never touched it
```

For a two-outlet business, a 30 second window where a stock write could hit
either version is not theoretical: the kitchen at BM-PATIA might be recording an
issue at exactly that moment. Backward compatibility is not ceremony here, it is
the difference between that row landing and that row erroring.

## Rollback

Railway keeps previous deployments. Rolling back is one command or two clicks.

```bash
# From the CLI, from any machine with the Railway token
railway rollback --service api --environment production

# Or pick a specific deployment
railway deployments --service api --environment production
railway rollback --service api --environment production --deployment <id>
```

The rollback restarts the previous container image. It takes about 40 seconds. It
does not touch the database.

That last sentence is the entire policy driver. A code rollback does not roll back
a migration. If release 12 added a `NOT NULL` column and you roll back to release
11, release 11's insert statements now fail against a schema that demands a column
release 11 does not know exists. You have swapped a bug for an outage.

So the policy is forward-only migrations plus fix-forward as the default habit.
Migrations are never reversed in production. When a deploy is bad:

1. Roll the code back to restore service. The schema stays where it is, which is
   safe because every migration was written to be backward compatible with the
   previous release.
2. Fix the code on a branch, open a pull request, let the pipeline run.
3. Deploy forward.

The exception is a migration that is genuinely destructive and got through review:
a `DROP COLUMN` that removed data, a backfill that wrote wrong values across a
table. Code rollback does not help. The path is:

1. Stop writes. Set the API service to zero replicas in Railway so nothing else
   lands on top of the damage.
2. Restore from the Supabase daily backup or a point in time before the migration.
   Procedure 4 in [chapter 35](35-deployment-runbook.md) has the steps.
3. Reconcile anything written between the backup point and the stop, using the
   `AuditLog` table, which is append only and survives independently of the
   damaged table.
4. Write a forward migration that corrects the state, and deploy it through the
   normal pipeline.

This is why destructive migrations need the maintenance window procedure rather
than a normal release. A `DROP COLUMN` never rides along with a feature.

## Versioning and the changelog

The repository is versioned `MAJOR.MINOR.PATCH` and tagged on every production
deploy. Phase 1 ships as `1.0.0` at UAT sign-off. Before that, staging builds are
`0.x.y`.

`MINOR` increments when a release adds a feature or an endpoint. `PATCH`
increments for fixes and internal changes. `MAJOR` is reserved for a change that
breaks the API contract with the web app, which inside one repository deploying
both halves together should never happen in Phase 1.

`CHANGELOG.md` is generated from the squash commit messages on `main` between
tags, grouped by type, with `feat` and `fix` first and `chore` last. The client
gets the `feat` and `fix` sections pasted into the weekly update, which is why the
description half of a conventional commit should read as something a restaurant
owner understands. "fix(purchase): purchase totals now round to the paisa
correctly" is a useful line. "fix(purchase): decimal coercion" is not.

## The smoke test suite

Six checks. They run against a freshly deployed environment, take about 40
seconds, and use a dedicated smoke account (`smoke@bobsmomo.internal`, role
`COUNTER_CASHIER`, scoped to a single outlet, no ability to change anything that
matters).

| # | Check | Asserts | On failure |
|---|---|---|---|
| 1 | `GET /healthz` | 200 within 2 s, body `{"status":"ok","version":"<sha>"}`, version matches the deployed commit | Deploy is not live. Roll back. |
| 2 | `GET /readyz` | 200, body reports `db: ok`, `redis: ok`, `storage: ok` | A dependency is down. Do not roll back yet, check the provider dashboard first. |
| 3 | `POST /api/v1/auth/login` with the smoke account | 200, access token returned, refresh cookie set | Auth is broken for everyone. Roll back immediately. |
| 4 | `GET /api/v1/inventory/items?page=1&pageSize=5` with that token | 200, `meta.total` greater than 0, response under 1 s | The read path or the database is broken. Roll back. |
| 5 | `GET /api/v1/analytics/dashboard?outletId=<smoke outlet>` | 200, response under 2 s cold, all numeric fields present and not null | The dashboard or its cache is broken. Roll back. |
| 6 | Web app root loads and renders the login form | 200 HTML, the string `Sign in` present, no 5xx on any asset request | The frontend is broken while the API is fine. Roll back the `web` service only. |

The suite deliberately does not write anything. A smoke test that creates a stock
transaction would leave rubbish in the production ledger, and the ledger is append
only, so that rubbish would be permanent. Read-only checks plus a login are enough
to catch every failure mode a deploy actually produces: a bad build, a missing
environment variable, a migration that did not apply, a broken auth secret, a
Redis URL pointing at the wrong database.

```ts
// scripts/smoke.ts, run with `bun run smoke`
const api = process.env.SMOKE_BASE_URL!;
const web = process.env.SMOKE_WEB_URL!;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    console.log(`ok    ${name}  ${Date.now() - started}ms`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.error(`FAIL  ${name}  ${(e as Error).message}`);
  }
}

await check('healthz', async () => {
  const r = await fetch(`${api}/healthz`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const body = await r.json();
  if (body.version !== process.env.GITHUB_SHA?.slice(0, 7)) {
    throw new Error(`version ${body.version} is not the deployed commit`);
  }
});

// ... checks 2 through 6 follow the same shape

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nall smoke checks passed');
```

On staging, a failure triggers the automatic `railway rollback` step and the
production job never starts, so a broken build cannot reach the client. On
production, a failure fails the workflow, prints the rollback command, and the
lead gets the GitHub Actions failure notification. There is no automatic
production rollback, because at 06:30 on a weekday a human deciding is better
than a script deciding, and the rollback command is one line away.
