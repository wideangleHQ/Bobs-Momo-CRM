# Introduction

This book is the implementation manual for Bob's Momo ERP and CRM, Phase 1. It exists so
that an engineer who joined this morning can pick up a ticket this afternoon and touch the
right files, with the right permission key, inside the right transaction boundary, and
write a test that proves it.

## Who this book is for

You are a mid-level full-stack engineer. You are comfortable with TypeScript, React and
SQL. You have probably not written NestJS with decorator-driven dependency injection
before, you have probably not modelled a Prisma schema at this size, and you have almost
certainly never worked inside a quick service restaurant. Two of those three gaps are the
reason this book is long.

The book assumes competence and does not assume context. It will not explain what a
foreign key is. It will explain, at length, why a closing checklist submitted at 00:30 on
Tuesday belongs to Monday's trading day, because that rule leaks into eleven tables and
four background jobs.

## What this book is not

It is not the contract. The signed scope document is
`docs/Bobs_Momo_ERP_CRM_SRS.md`, produced by Wide Angle Media and Technologies for Bob's
Momo on 16 August 2026. That document says what the client is owed. This book says how it
gets built. Where the two disagree on a detail, the SRS wins on scope and this book wins
on mechanism. Where the SRS is silent, this book decides and records the decision in
[chapter 04](04-decisions-register.md) rather than leaving it to whoever picks up the
ticket.

The SRS also has real defects: a missing module section, a functional requirement that is
cited but never written, and cross-reference numbering that does not resolve.
[Chapter 03](03-phase-1-scope.md) lists each one with its impact on the build. The book
does not pretend the source document is clean.

## How the book is organised

| Chapters | Part | What it covers |
|---|---|---|
| 01 to 05 | Foundations | The business, the scope boundary, the decisions register, the glossary |
| 06 to 09 | Architecture | System shape, repository layout, architecture decision records, local environment |
| 10 to 12 | Data | Prisma schema and ER diagram, migrations and seeding, time and money rules |
| 13 to 15 | Platform | Authentication, RBAC and the permission matrix, API conventions and the error code registry |
| 16 to 17 | Operations domain | Inventory and the stock ledger, purchase requests, purchases, vendors and price history |
| 18 to 20 | Workforce domain | Employees and attendance, shifts, leave and salary, the task and checklist engine |
| 21 to 25 | Platform services | Notifications, the transactional outbox, WhatsApp delivery, scheduled jobs, cache and rate limiting |
| 26 to 29 | Frontend | Next.js App Router structure, data fetching, forms, the mobile-first floor views |
| 30 to 32 | Reporting and CRM | Daily sales entry, analytics and the dashboard, the customer game and reward layer |
| 33 to 37 | Quality and operations | Testing strategy, observability, deployment, runbooks, incident response |
| 38 to 42 | Delivery | The three week plan, acceptance criteria, UAT, handover, Phase 2 candidates |

Four chapters are worth knowing by number from day one because everything else points at
them. [Chapter 10](10-data-model.md) holds the schema. [Chapter 12](12-data-scoping-and-integrity.md)
owns the business-day and Decimal rules. [Chapter 14](14-rbac-and-permissions.md) holds the role by
permission matrix. [Chapter 15](15-api-conventions.md) holds the error code registry.

## How to read this depending on what you were assigned

Read chapters 01 to 03 whatever your ticket is. They take about forty minutes and they
stop you from building something that is out of scope.

Your first four hours:

| Order | Read | Why |
|---|---|---|
| 1 | 01, 02, 03 | Business, trading day, scope boundary |
| 2 | 04 (skim the tables) | The nine open questions are already answered, do not re-open them |
| 3 | 06 to 09 | Get the API, the web app and the database running locally |
| 4 | 10 | Model names and field names you will type all week |
| 5 | 15 | Request and response envelope, status codes, error shape |

Your first week, added on top:

| Order | Read | Why |
|---|---|---|
| 6 | 12 | Business dates, Asia/Kolkata, Decimal arithmetic |
| 7 | 13 and 14 | Every endpoint you write needs a guard and a permission key |
| 8 | Your domain chapters | 16 to 17, 18 to 20, 21 to 25, 26 to 29 or 30 to 32 |
| 9 | 33 to 35 | What tests are expected and how the thing deploys |

If your ticket is a bug at 2am, go straight to the runbook chapters in 33 to 37 and come
back to the domain chapter afterwards.

## Conventions used in this book

### Endpoint contracts

Every endpoint documented in a module chapter appears in this block form before any prose
about it. The block is the contract. The prose explains the rules behind it.

> **Spec note:** the endpoint contract block below is a book formatting
> convention. It is not defined in this handbook. Its field set is fixed: method and
> path, permission, scope, idempotency, body, success, errors.

```text
POST /api/v1/inventory/transactions
  Permission  inventory.transaction.create
  Scope       OWN_OUTLET
  Idempotent  yes, Idempotency-Key header, 24h replay window
  Body        RecordTransactionDto
  Success     201, StockTransaction object
  Errors      400 VALIDATION_FAILED
              404 ITEM_NOT_FOUND
              422 INSUFFICIENT_STOCK
              429 RATE_LIMITED
```

Base path is `/api/v1`. Collections return `{ "data": [...], "meta": {...} }`. Single
resources return the object with no wrapper. Failures always return the `error` envelope
described in chapter 15. A resource that exists but sits outside your outlet scope returns
404, not 403, so that the API never confirms the existence of the other outlet's data.

### Permission keys

Permission keys are written `module.resource.action`, lowercase, dot separated, in code
font: `inventory.transaction.create`, `purchase.request.approve`,
`workforce.leave.decide`. They are never capitalised and never pluralised. Two scope
modifiers apply on top of a key, `ALL_OUTLETS` and `OWN_OUTLET`, plus `SELF` on the
workforce endpoints where a kitchen staff member reads and writes their own attendance
without seeing anyone else's. Chapter 14 is the only place the full matrix lives. Module
chapters state the key per endpoint and link back.

### Model, field and enum names

Prisma model names appear as `StockTransaction`, fields as `qtyOnHand`, enum members in
upper snake case as `TRANSFER_OUT`. If a name in a chapter does not match
[chapter 10](10-data-model.md), chapter 10 is right and the other chapter has a bug. File
an issue rather than coding around it.

### Notification event keys

Event keys are upper snake case strings such as `LOW_STOCK` and `TASK_OVERDUE`. The same
string appears in `OutboxEvent.eventKey`, `Notification.eventKey` and
`NotificationPreference.eventKey`. The full list of fourteen keys is in chapter 21. Do not
invent variants, and do not build a second event vocabulary for a new feature.

### Requirement identifiers

Functional requirements from the SRS keep their identifiers: `FR-INV-001`,
`FR-TASK-004`. Every committed requirement is mapped to an owning chapter in
[chapter 03](03-phase-1-scope.md). If you are asked to build something with no FR
identifier, that is a scope question, not an engineering question.

### Money, quantity and time

Money is `Decimal(14, 2)`. Quantity is `Decimal(14, 3)`. Neither is ever `Float` in the
schema, in a DTO, or in a computation. Amounts are rupees and are written `Rs 45,000` in
prose. Timestamps are stored in UTC. Business dates are stored as `@db.Date` and always
mean an Asia/Kolkata calendar day whose boundary is 04:00 IST. Chapter 12 owns that rule
and every date bug traces back to it.

### ASCII diagrams

Diagrams are ASCII inside a `text` fence, under 78 columns so mdBook renders them without
horizontal scroll. Read them like this:

```text
  ┌──────────────┐        box            a service, class or job
  │  Component   │        │  ▼           solid arrow, synchronous call
  └──────┬───────┘        ┊  ┋           dotted line, asynchronous hop
         │                ── label ──    a boundary, usually a transaction
         ▼                1. step        numbered step inside a boundary
  ┌──────────────┐
  │  Next thing  │
  └──────────────┘
```

A boundary line labelled as a transaction means every numbered step inside it happens in
one `prisma.$transaction`, and a failure at any step rolls back all of them.

### Code fences

Every fence declares a language: `ts`, `prisma`, `sql`, `bash`, `json`, `yaml`, or `text`
for diagrams and plain output. Untagged fences do not survive review.

## Before you write any code

Work through this list once per ticket. It takes five minutes and it is the difference
between a review that takes twenty minutes and one that takes two days.

1. You have read the SRS once, end to end. It is 750 lines. Do it on day one, not later.
2. Your local API, web app and database are running and `/healthz` returns 200. Setup is
   in chapters 06 to 09 and is expected to take under an hour.
3. You have run the seed and logged in as at least three different roles, including
   `KITCHEN_STAFF`, so you have seen how little that role is allowed to see.
4. You know the FR identifier your ticket implements, or you know it has none and you have
   asked why before starting.
5. You know the permission key and the outlet scope for every endpoint you are adding.
6. You know whether your endpoint accepts an `Idempotency-Key`. Three do:
   `POST /purchases`, `POST /inventory/transactions`, `POST /attendance/punch`.
7. You know which enums you touch and you have confirmed the exact members in chapter 10
   rather than inventing a new status.
8. You know whether your write needs an `OutboxEvent` row, and if so which `eventKey`.
   If a human needs to be told something happened, the answer is yes.
9. You know the `AuditLog.action` string your write records, in the same
   `module.resource.action` shape as the permission key.
10. You have checked that nothing in your change hard deletes a row. Soft delete is
    `isActive: false`. `RefreshToken` and cascade children are the only exceptions.
11. If your change touches a date, you know whether it is a business date or a timestamp,
    and you have read chapter 12 before deciding.
12. You know which test file your change lands in: `*.service.spec.ts` for a business rule,
    `*.e2e-spec.ts` for an endpoint contract.

Items 5, 8 and 10 are the three that get missed most often, and all three are expensive to
retrofit once data exists.
