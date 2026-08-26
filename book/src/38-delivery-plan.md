# Three week delivery plan

The SRS commits to a three week build. This chapter turns that into a dated plan with
a ticket level backlog, estimates, and an honest arithmetic check on whether the scope
fits the calendar.

Read this chapter before you pick up your first ticket. Read it again at the end of
week 1, because the week 1 checkpoint is where this project is either saved or lost.

## Team shape and capacity

The plan assumes the team Wide Angle Media fields for a Rs 45,000 fixed price
engagement.

| Role | People | Days available over 3 weeks |
|---|---|---|
| Full-stack engineer | 2 | 15 each |
| Tech lead, part time | 1 | 5 |
| Client-facing project owner | 1 | not counted as build capacity |

Working days are Monday to Friday, three weeks, so 15 working days per engineer.
Total build capacity is 35 engineer-days including the lead's five.

That number matters. Hold on to it.

## The capacity arithmetic

Here is the backlog rolled up by epic, estimated in engineer-days by someone who has
built this shape of system before. Estimates assume the engineer is writing tests
alongside the feature, not after.

| Epic | Estimate (eng-days) | Chapter |
|---|---|---|
| Project setup, monorepo, CI, environments | 2.0 | [08](08-repository-and-local-setup.md), [34](34-ci-cd.md) |
| Database schema, migrations, seed, factories | 2.5 | [10](10-data-model.md), [11](11-migrations-and-seed.md) |
| Auth, tokens, lockout, password flows | 2.0 | [13](13-authentication.md) |
| RBAC, guards, outlet scope, permission matrix | 2.0 | [14](14-rbac-and-permissions.md) |
| API conventions, error handling, validation, health | 1.0 | [15](15-api-conventions.md) |
| Inventory module, backend | 3.5 | [16](16-inventory.md) |
| Purchase and vendor module, backend | 3.0 | [17](17-purchase-and-vendors.md) |
| Workforce: employees, attendance, shifts, backend | 3.0 | [18](18-employees-attendance-shifts.md) |
| Leave and salary, backend | 1.5 | [19](19-leave-and-salary.md) |
| Task engine, checklists, recurrence, audits, backend | 3.5 | [20](20-tasks-checklists-audits.md) |
| Notification engine, outbox, dispatcher, jobs | 2.5 | [21](21-notification-engine.md), [24](24-background-jobs.md) |
| WhatsApp adapter, templates, webhook | 2.0 | [22](22-whatsapp-integration.md) |
| Chat and broadcast | 1.5 | [23](23-messaging-and-broadcast.md) |
| Sales entry | 1.0 | [30](30-sales-entry.md) |
| Analytics, reports, dashboards, backend | 3.0 | [31](31-analytics-and-reporting.md) |
| Customer CRM and game layer, backend and public API | 3.5 | [32](32-customer-crm-and-game.md) |
| Frontend shell, auth, layout, design system | 2.5 | [26](26-frontend-architecture.md), [28](28-ui-system.md) |
| Frontend: inventory and purchase screens | 3.0 | [27](27-screens-and-routes.md) |
| Frontend: workforce and task screens | 3.0 | [27](27-screens-and-routes.md) |
| Frontend: sales, reports, dashboards | 2.5 | [27](27-screens-and-routes.md) |
| Frontend: chat, notifications, admin, game admin | 2.5 | [27](27-screens-and-routes.md) |
| Deployment, runbook, production setup | 1.5 | [35](35-deployment-runbook.md) |
| UAT preparation, bug fixing, handover | 2.5 | [40](40-acceptance-and-uat.md) |
| **Total** | **55.5** | |

Capacity is 35. The backlog is 55.5. The gap is 20.5 engineer-days, which is roughly
59 percent over.

This is not a reason to panic and it is not a reason to pretend. It is a reason to
decide, in week 1, which 20 days come out. The alternative is discovering the gap on
day 14, which is how fixed-price projects turn into unpaid weekends.

## Three ways to close the gap

Present these to the client in week 1, with a recommendation, and get a written answer.

**Option A, defer the customer CRM and game layer to Phase 2.** Saves 3.5 backend days
plus roughly 1.5 frontend days, so about 5 days. This is the strongest candidate
because, as [chapter 32](32-customer-crm-and-game.md) documents, the SRS never actually
specifies it. Section 6.3 is missing from the document, and Section 15.7 and FR-CRM-001
are cited by the open questions but do not exist. The team would be building against a
scope nobody wrote down, in the last week, with no recovery time.

**Option B, cut the Should-Have items.** Internal chat and broadcast is marked
Should-Have in the SRS (FR-NOTIF-002), as are stock history views (FR-INV-003) and
price history (FR-PUR-003). Cutting chat alone saves 1.5 backend days and about 1
frontend day. Cutting all three saves about 4 days but guts the reporting value the
owner is actually buying, so cut chat and keep the history views.

**Option C, extend to four weeks.** Adds 10 engineer-days at two engineers. Combined
with Option A this closes the gap with a small buffer. It also puts the project at
roughly 45 days against a 55.5 day backlog, which still requires Option A or B.

The recommendation is A plus B-partial plus C: defer the game layer, cut chat to Phase 2,
extend by one week. That gives 45 capacity days against a 49 day backlog, which is a
9 percent overrun and is survivable with the buffer already built into week 3.

If the client will not extend, the recommendation is A plus B-full, which gives 35
capacity days against a 46.5 day backlog. That is still 33 percent over and the honest
statement to the client is that quality or scope has to give, and quality is not the
right thing to give on a system of record for stock and money.

Whatever is decided, write it down and get it signed. [Chapter 42](42-open-questions.md)
has the letter.

## Week 1: foundation

Goal at the end of week 1: a deployed staging environment where a real user can log in,
see a role-appropriate shell, and record a stock transaction that updates a balance.
Everything else is scaffolding for weeks 2 and 3.

```text
  Mon         Tue         Wed         Thu         Fri
  ─────────── ─────────── ─────────── ─────────── ───────────
  Kickoff     Schema      Auth        RBAC        Inventory
  Repo+CI     Migrations  Tokens      Guards      backend v1
  Envs        Seed        Lockout     Perm matrix Ledger+lock
              Factories   Password    Outlet      Low stock
  ─────────── ─────────── ─────────── ─────────── ───────────
  Client:     Client:     Client:     Client:     CHECKPOINT
  master      TBC          WhatsApp   items CSV   scope
  data ask    answers      submit                 decision
```

| # | Ticket | Est | Depends on | Owner lane |
|---|---|---|---|---|
| S-01 | Monorepo scaffold, bun workspaces, api and web apps, shared package | 0.5 | | A |
| S-02 | Docker compose for local Postgres and Redis, .env.example | 0.25 | S-01 | A |
| S-03 | GitHub Actions PR pipeline: lint, typecheck, unit tests | 0.5 | S-01 | A |
| S-04 | Railway project, two services, staging environment variables | 0.5 | S-01 | A |
| S-05 | Supabase project, both connection strings, storage bucket | 0.25 | | A |
| S-06 | Upstash Redis database, connection verified from api | 0.25 | | A |
| D-01 | Prisma schema, all models from [chapter 10](10-data-model.md) | 1.0 | S-01 | A |
| D-02 | Initial migration applied to local and staging | 0.25 | D-01 | A |
| D-03 | Seed: outlets, departments, units, categories, checklist templates | 0.75 | D-02 | A |
| D-04 | Test factories for every aggregate | 0.5 | D-02 | A |
| A-01 | argon2id hashing, User model wiring, first OWNER user | 0.5 | D-02 | B |
| A-02 | POST /auth/login, access JWT, refresh token issue | 0.5 | A-01 | B |
| A-03 | POST /auth/refresh with rotation and reuse detection | 0.5 | A-02 | B |
| A-04 | Lockout, mustReset, change-password, admin reset | 0.5 | A-02 | B |
| R-01 | PERMISSIONS constant, full matrix from [chapter 14](14-rbac-and-permissions.md) | 0.5 | | B |
| R-02 | JwtAuthGuard, PermissionsGuard, @Permissions decorator | 0.5 | A-02, R-01 | B |
| R-03 | OutletGuard, scope resolution, repository scoping pattern | 0.75 | R-02 | B |
| R-04 | Table-driven RBAC test harness over all routes | 0.25 | R-02 | B |
| C-01 | Error envelope, AllExceptionsFilter, error code registry | 0.5 | S-01 | B |
| C-02 | ZodValidationPipe, shared schema package wiring | 0.25 | S-01 | B |
| C-03 | /healthz and /readyz, Railway health check configured | 0.25 | S-04 | B |
| I-01 | Item, category, unit CRUD endpoints | 0.75 | D-02, R-03 | A |
| I-02 | Stock transaction service: lock, validate, ledger write, balance | 1.0 | I-01 | A |
| I-03 | Low stock threshold check and cooldown | 0.5 | I-02 | A |
| F-01 | Next.js shell, Tailwind, shadcn install, design tokens | 0.75 | S-01 | B |
| F-02 | Login screen, auth context, fetch wrapper with single-flight refresh | 0.75 | A-02 | B |
| F-03 | App shell: role-based nav, bottom nav on mobile, sidebar on desktop | 0.5 | F-02 | B |

Week 1 client actions, which the project owner chases daily and which are on the
critical path:

1. Item master list, vendor list, employee list, in the CSV formats from
   [chapter 11](11-migrations-and-seed.md). Due Wednesday.
2. Answers to the nine open questions in [chapter 42](42-open-questions.md). Due Tuesday.
3. Meta Business account access so WhatsApp templates can be submitted Wednesday.
   Template approval takes days and is the single longest external lead time in the
   project. Submitting in week 3 is how WhatsApp does not ship.
4. The scope decision from the capacity arithmetic above. Due Friday.

## Week 2: the operational core

Goal at the end of week 2: every operational module works end to end on staging with a
real UI, and notifications fire. This is the week that delivers the value the client is
actually buying.

```text
  Mon         Tue         Wed         Thu         Fri
  ─────────── ─────────── ─────────── ─────────── ───────────
  Inventory   Purchase    Workforce   Task engine Notifications
  screens     backend     backend     +checklists outbox+jobs
  Purchase    +screens    Attendance  Recurrence  WhatsApp
  requests                board       Overdue     adapter
  ─────────── ─────────── ─────────── ─────────── ───────────
                                                  CHECKPOINT
                                                  demo to
                                                  client
```

| # | Ticket | Est | Depends on | Owner lane |
|---|---|---|---|---|
| I-04 | Transfer endpoints, paired ledger rows | 0.5 | I-02 | A |
| I-05 | Closing stock capture and variance adjustment | 0.5 | I-02 | A |
| I-06 | Stock list, ledger history, consumption and wastage aggregates | 0.75 | I-02 | A |
| P-01 | Vendor CRUD and vendor-item links | 0.5 | R-03 | A |
| P-02 | Purchase request create, approve, reject, cancel | 0.75 | P-01 | A |
| P-03 | Purchase record: transaction, price history, stock receive | 1.0 | P-02, I-02 | A |
| P-04 | Purchase void with compensating adjustments | 0.5 | P-03 | A |
| P-05 | Price trend endpoint with moving averages | 0.25 | P-03 | A |
| W-01 | Employee CRUD, employee to user linking | 0.5 | R-03 | B |
| W-02 | Attendance punch, break log, day aggregate maintenance | 1.0 | W-01 | B |
| W-03 | Shifts, roster, bulk create, overlap guard | 0.75 | W-01 | B |
| W-04 | Leave request, approve, reject, ON_LEAVE attendance write | 0.75 | W-02 | B |
| W-05 | Salary records, effective dating, restricted access | 0.5 | W-01 | B |
| T-01 | Task CRUD, state machine, assignment | 1.0 | R-03 | A |
| T-02 | Checklist templates and bulk result submission | 0.75 | T-01 | A |
| T-03 | failCreatesTask follow-up task generation | 0.5 | T-02 | A |
| T-04 | Recurrence generator job with idempotency guard | 0.75 | T-01 | A |
| T-05 | Overdue sweep with once-only notification | 0.5 | T-01 | A |
| T-06 | Task attachments via Supabase signed URLs | 0.5 | T-01 | A |
| N-01 | OutboxEvent write helper, dispatcher cron, SKIP LOCKED claim | 0.75 | D-02 | B |
| N-02 | Recipient resolvers for all 14 event keys | 0.75 | N-01 | B |
| N-03 | Notification read model, preferences, unread count | 0.5 | N-01 | B |
| N-04 | Advisory lock wrapper, job registry, all scheduled jobs | 0.5 | N-01 | B |
| N-05 | WhatsApp adapter, null adapter, E.164 normalisation | 0.75 | N-01 | B |
| N-06 | WhatsApp webhook, signature check, status mapping | 0.5 | N-05 | B |
| F-04 | Inventory screens: stock list, entry, transfer, closing, history | 1.25 | I-06, F-03 | B |
| F-05 | Purchase screens: requests, records, vendors, price trends | 1.0 | P-05, F-03 | B |
| F-06 | Workforce screens: employees, punch, board, roster, leave | 1.25 | W-04, F-03 | A |
| F-07 | Task screens: my tasks, task detail, checklist run, board | 1.0 | T-06, F-03 | A |
| F-08 | Notification bell, list, preferences | 0.5 | N-03, F-03 | B |

The Friday demo is not a formality. Put the client's own store manager in front of the
staging app on their own phone and watch them try to record a stock issue without help.
Everything they fumble is a week 3 fix, and finding it on day 10 is cheap.

## Week 3: reporting, hardening, UAT

Goal at the end of week 3: production is live, the client has signed off, and the team
has handed over documentation and credentials.

```text
  Mon         Tue         Wed         Thu         Fri
  ─────────── ─────────── ─────────── ─────────── ───────────
  Sales entry Dashboards  Prod setup  UAT session Bug fixes
  Analytics   Chat        Smoke       Bug triage  Sign-off
  backend     Admin       tests       Fixes       Handover
  ─────────── ─────────── ─────────── ─────────── ───────────
  FREEZE: no new scope from Wednesday 12:00 onwards
```

| # | Ticket | Est | Depends on | Owner lane |
|---|---|---|---|---|
| SA-01 | Daily sales entry, split validation, 48 hour lock | 0.75 | R-03 | A |
| SA-02 | Sales entry missing reminder job | 0.25 | SA-01, N-04 | A |
| AN-01 | Sales, consumption, waste report endpoints | 1.0 | SA-01, I-06 | A |
| AN-02 | Performance report, formulas and denominators | 0.5 | T-05, W-02 | A |
| AN-03 | Gross margin approximation with caveat labelling | 0.5 | AN-01, P-03 | A |
| AN-04 | Dashboard endpoint, three role variants, caching | 0.75 | AN-01 | A |
| AN-05 | CSV export with outlet scope enforcement | 0.25 | AN-01 | A |
| M-01 | Chat and broadcast backend | 1.0 | N-01 | B |
| M-02 | Chat and broadcast screens | 0.75 | M-01 | B |
| F-09 | Sales entry screen | 0.5 | SA-01 | B |
| F-10 | Report screens with charts and CSV download | 1.0 | AN-05 | B |
| F-11 | Dashboards, three variants | 0.75 | AN-04 | B |
| F-12 | Admin screens: users, outlets, templates, recurrences, audit log | 1.0 | R-03 | A |
| O-01 | Production Supabase, Redis, Railway setup per runbook | 0.5 | | A |
| O-02 | Production migration, seed, first owner user | 0.25 | O-01 | A |
| O-03 | Smoke test suite and post-deploy gate | 0.5 | O-01 | A |
| O-04 | Uptime check, alert conditions, log redaction verified | 0.25 | O-01 | A |
| Q-01 | Playwright journeys, six critical flows | 1.0 | F-11 | B |
| Q-02 | Security checklist walkthrough from [chapter 37](37-security.md) | 0.5 | O-02 | B |
| Q-03 | UAT script preparation and test data load | 0.5 | O-02 | A |
| Q-04 | UAT session facilitation | 0.5 | Q-03 | both |
| Q-05 | UAT bug fixing window | 1.5 | Q-04 | both |
| H-01 | Handover: credentials, runbook walkthrough, training session | 0.5 | Q-05 | both |

## The scope freeze rule

From Wednesday noon of week 3, no new scope enters the build. Anything the client asks
for after that point goes on a written Phase 2 list, gets acknowledged in the same
conversation, and does not get built.

This rule is the difference between a project that ships and a project that keeps
almost shipping. The SRS already provides the language for it in the scope management
clause: minor refinements to UI, workflows and field structures are accommodated,
material new functionality is evaluated separately. Use that sentence.

State the rule to the client in week 1, not on the day you first need it.

## Definition of done

A ticket is done when all of these are true. Not most of them.

1. The code is merged to main through a reviewed pull request.
2. Every new endpoint has a permission decorator and appears in the RBAC test matrix.
3. Unit tests cover the branches, including the error paths.
4. An integration or e2e test covers the happy path and at least one failure.
5. Any multi-write operation is inside a single Prisma transaction with the outbox
   insert included.
6. The error codes it can return are in the registry in
   [chapter 15](15-api-conventions.md).
7. Anything user-facing works on a 360 pixel wide viewport.
8. Any ASCII diagram in a file you touched is still accurate.
9. CI is green.

## Daily rhythm

A fifteen minute standup at 09:45, and it answers three questions per person: what
landed yesterday, what lands today, what is blocked. If something has been blocked for
more than four hours it goes to the tech lead the same day, not at the next standup.

An end-of-day push. No work sits uncommitted overnight on a three week project.

A Friday checkpoint against the goals at the top of each week section. If the week's
goal is not met on Friday, the scope conversation happens on Friday, not the following
Wednesday.
