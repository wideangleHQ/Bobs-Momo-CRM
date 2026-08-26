# Bob's Momo ERP & CRM

Operations, workforce, inventory and reporting for two quick service outlets in
Bhubaneswar. Built from the signed SRS in
[book/docs/Bobs_Momo_ERP_CRM_SRS.md](book/docs/Bobs_Momo_ERP_CRM_SRS.md) and the
Phase 1 handbook in [book/src/](book/src/).

## What is here

| Part | What it does |
|---|---|
| `apps/api` | NestJS 11 on Node 22, Prisma 6, PostgreSQL 15, Redis |
| `apps/web` | Next.js 15 App Router, React 19, Tailwind 4, TanStack Query |
| `packages/shared` | Zod schemas, the permission matrix, the error registry |
| `book` | The 42 chapter engineering handbook |

Modules: authentication and RBAC, inventory and the stock ledger, purchase and
vendors, workforce (employees, attendance, shifts, leave, salary), the shared
task engine with checklists and audits, notifications over an outbox with a
WhatsApp adapter, internal messaging, daily sales, analytics, administration,
and the customer game and reward layer.

## Run it locally

Needs Bun 1.3+, Node 22 and Docker Compose.

```bash
bun install
docker compose up -d                  # Postgres on 54322, Redis on 63790
cp .env.example apps/api/.env         # then paste two `openssl rand -hex 32` secrets
cp apps/web/.env.example apps/web/.env.local
bun run shared:build
bun run --cwd apps/api db:migrate
bun run --cwd apps/api db:seed        # reference data, demo data, logins printed
bun run dev                           # api :3001, web :3000
```

Check it came up:

```bash
curl -s localhost:3001/api/v1/health/readyz   # {"status":"ok","db":"up","redis":"up"}
bun run scripts/smoke.mjs http://localhost:3001/api/v1 owner 'ChangeMe123!'
```

`just setup` does the whole of the above in one command, and `just validate-all`
runs exactly what CI runs.

Full setup notes, including the troubleshooting table, are in
[book/src/08-repository-and-local-setup.md](book/src/08-repository-and-local-setup.md).

## Read the handbook

```bash
cargo install mdbook      # once, if you do not have it
mdbook serve book --open  # http://localhost:3000
```

Or build static HTML:

```bash
mdbook build book         # output in book/book/
```

## What is in it

42 chapters across eleven parts, covering the data model, every module's endpoint
contracts, the RBAC matrix, the frontend screen inventory, testing, deployment, and a
ticket-level three week delivery plan. Start at
[book/src/01-introduction.md](book/src/01-introduction.md).

Two things to read before writing any code:

1. [Phase 1 scope boundary](book/src/03-phase-1-scope.md), which lists what the SRS
   commits to and the four places where the SRS is incomplete.
2. [Three week delivery plan](book/src/38-delivery-plan.md), which shows the backlog is
   55.5 engineer-days against 35 days of capacity and names the three ways to close the
   gap.
