# Decisions and assumptions register

The SRS ends with nine open questions marked TBC, all of which it says must be resolved
during week 1 to avoid timeline impact. Waiting for nine answers before starting a three
week build is not an option, so each one already has a Phase 1 default. The build proceeds
on these defaults. The client confirms them, or changes one, and the cost of the change is
known in advance.

Read the reversal cost column as the thing that actually matters. Cheap means a
configuration change or a day of work. Moderate means a schema migration and rework inside
one module. Expensive means it should have been a Phase 2 conversation.

Confirmation deadlines below are working days inside week 1. "Owner" means the Bob's Momo
proprietor. "Ops" means the operations manager. "Lead" means the Wide Angle project lead,
who owns getting the answer in writing.

## Q1. Field-level and action-level permission matrix

| | |
|---|---|
| SRS question | Final field-level and action-level permission matrix per role and module, to be confirmed during the design sprint |
| Phase 1 decision | Role-level permissions only, defined in [chapter 14](14-rbac-and-permissions.md). Field-level permissions are deferred |
| Reversal cost | Moderate |
| Confirmed by | Owner, with Ops |
| Deadline | Week 1, day 3 |

Role-level access with two outlet scope modifiers covers every access rule the SRS
actually describes in prose. Field-level masking (for example, hiding a salary figure from
a store manager who can otherwise see the employee record) is handled in Phase 1 by
splitting the endpoint instead: salary lives behind `workforce.salary.read`, which only
`HR_ACCOUNTS` and `OWNER` hold. Reversal is moderate because retrofitting genuine
field-level rules means a permission model with per-field entries, a response serialiser
that consults it, and a re-test of every endpoint. The cheap escape hatch, splitting one
more endpoint, is available at any time.

## Q2. Outlet to outlet stock transfer

| | |
|---|---|
| SRS question | Whether basic stock transfer between the two outlets is required for Phase 1 |
| Phase 1 decision | In scope. A transfer is a `TRANSFER_OUT` row at the source and a `TRANSFER_IN` row at the destination, linked by `transferPairId` |
| Reversal cost | Cheap |
| Confirmed by | Ops |
| Deadline | Week 1, day 5 |

Two outlets three kilometres apart will move a sack of flour between them whether or not
the software supports it, and if the software does not, both outlets' stock numbers go
wrong on the same afternoon. The ledger design already carries a transaction type enum, so
adding two members and a pairing column costs almost nothing. Reversal is cheap in both
directions: turning it off is removing a UI action and a permission, and the two enum
members can sit unused without harming anything.

## Q3. Low stock threshold values per item

| | |
|---|---|
| SRS question | Low-stock threshold values per item |
| Phase 1 decision | `ItemStock.reorderLevel` is nullable and editable in the UI, per item per outlet. Null means no alert for that item at that outlet. The client supplies starting values in week 1 |
| Reversal cost | Cheap |
| Confirmed by | Inventory manager at each outlet |
| Deadline | Week 1, day 5 for the first pass, tunable forever after |

The values are operational data, not a design decision, and getting them wrong on day one
is expected. Making the threshold nullable means the system ships with no alerts
configured and gets noisier as the client tunes it, which is the correct direction. The
alternative, seeding a guessed default on every item, produces a wall of alerts in week one
of live use and trains everyone to ignore `LOW_STOCK`. Reversal is a form field, so it is
cheap by construction.

## Q4. Payroll computation

| | |
|---|---|
| SRS question | Whether salary computation and payroll processing (deductions, payslips) is in Phase 1, or storage of salary information only |
| Phase 1 decision | Storage only. `SalaryRecord` holds monthly CTC, basic, allowances and effective dates. Nothing computes, nothing is generated |
| Reversal cost | Expensive |
| Confirmed by | Owner, with HR and accounts |
| Deadline | Week 1, day 2 |

Payroll that is correct under Indian statutory rules involves PF, ESI, professional tax,
TDS and payslip formats, plus the legal exposure of getting any of them wrong. It is not a
feature that fits in a three week window alongside eight other modules. Storing the salary
structure costs one table and gives HR the history they asked for. Reversal is expensive
because payroll is a module, not a feature: computation rules, a period concept, payslip
documents, corrections and a re-run path. This is the earliest deadline on the list
because a yes would change the shape of the whole engagement.

## Q5. Biometric or photo-based attendance

| | |
|---|---|
| SRS question | Whether biometric or photo-based attendance is required, currently manual per the hardware exclusion |
| Phase 1 decision | No biometric. Manual web punch through `POST /attendance/punch`. An optional photo exists on task completion only, never on a punch |
| Reversal cost | Moderate for photo on punch, expensive for biometric |
| Confirmed by | Ops |
| Deadline | Week 1, day 3 |

Biometric hardware is excluded by the SRS hardware clause, so the real question is whether
a selfie should accompany a punch. It should not, in Phase 1. It adds an upload to the one
action that happens most often, on the worst network conditions in the building, at the
moment staff are most impatient, and it creates a personal-image data set the business has
no policy for. Manager edit with a reason is the anti-fraud control instead:
`AttendancePunch.source` records `MANAGER_EDIT` and `editReason` is required. Adding photo
on punch later is moderate (storage, upload flow, retention policy). Biometric is
expensive because it means hardware, a device integration and an on-premise component.

## Q6. Fraud and abuse controls on the customer game

| | |
|---|---|
| SRS question | Extent of fraud and abuse control sophistication achievable within three weeks |
| Phase 1 decision | Rate limiting plus one play per session key per cooldown window. No machine learning, no device fingerprinting |
| Reversal cost | Cheap |
| Confirmed by | Owner |
| Deadline | Week 1, day 5 |

The exposure is a free coupon, not money, and the redemption happens face to face at a
counter where a human hands over food. That caps the loss per abuse at one discounted
order. Rate limiting by IP hash and session key stops the trivial scripted case, which is
the realistic threat for a small local brand. Reversal is cheap because the controls sit at
the edge of the game endpoints and can be tightened without touching the reward or coin
model. Anything more advanced is listed under Future Scope in the SRS anyway.

## Q7. Guest versus identified customer

| | |
|---|---|
| SRS question | Guest versus identified-customer handling in the customer CRM (cites Section 15.7 and FR-CRM-001, neither of which exists in the document) |
| Phase 1 decision | Guests play with an anonymous `sessionKey` and earn nothing. Coins and rewards require a verified phone number on a `Customer` record |
| Reversal cost | Moderate |
| Confirmed by | Owner |
| Deadline | Week 1, day 2 |

Awarding coins to anonymous sessions creates a balance with no owner and no way to redeem
it at a counter, so the guest path has to end at "play and see your score". Requiring a
phone number before coins accrue also gives the business the one piece of customer data it
can actually use later. Reversal is moderate because backfilling guest plays into customer
accounts means resolving session keys to people after the fact, which is guesswork. This
question carries the earliest deadline alongside payroll, because it is the only open
question whose source requirement does not exist: see the gap list in
[chapter 03](03-phase-1-scope.md) and the reconstruction in chapter 32.

## Q8. POS API for sales data

| | |
|---|---|
| SRS question | Whether an existing POS system or API exists for sales data ingestion, or whether daily sales are entered manually in Phase 1 |
| Phase 1 decision | No POS is assumed. `DailySalesEntry` is entered by hand, one row per outlet per business date, locked 48 hours after the business date |
| Reversal cost | Moderate to build the integration, expensive to change what analytics can show |
| Confirmed by | Owner |
| Deadline | Week 1, day 2 |

The SRS assumption section already states that no POS API is assumed unless the client
confirms one, so this decision follows the document. The consequence is the part that
needs saying out loud: with one totals row per outlet per day there is no per-item sales
data, therefore no dish-level margin, no sales-versus-consumption variance per item, and a
P and L overview limited to daily totals against recorded purchases. If a POS with an API
turns up later, ingesting it is a moderate integration job. What is expensive is the
expectation gap, because every report the owner imagines from "sales data" assumes item
level detail that Phase 1 does not have.

## Q9. ER diagram and field-level schema

| | |
|---|---|
| SRS question | Full ER diagram and field-level schema to be finalised in week 1 |
| Phase 1 decision | The Prisma schema in [chapter 10](10-data-model.md) is the answer, and it is the single source of database truth. The ER diagram is in the same chapter |
| Reversal cost | Cheap early, expensive after live data |
| Confirmed by | Lead, reviewed with Owner for entity coverage |
| Deadline | Week 1, day 5 |

The SRS entity list is a list of nouns, not a schema, and no module can be built against a
noun. Chapter 10 turns it into typed models with keys, indexes and constraints. Reversal
is cheap during week 1, when there is nothing but seed data and a migration reset is
routine. Once the client's real master data and a week of live transactions are in, the
same change is a data migration on an append-only ledger, and the cost changes class.

## Standing assumptions

These come from the SRS assumptions section and from the commercial framing. Each one is
believed to be true. The blast radius column says what happens to the build if it is not.

| Assumption | Blast radius if false |
|---|---|
| Client provides item, vendor, employee and outlet master data during week 1 | The largest schedule risk in the project. Without items and vendors, inventory and purchase have nothing to test against, UAT runs on invented data, and week 3 becomes data entry instead of bug fixing. Mitigation is a CSV import path and a seed set that mirrors the real menu |
| No existing POS system or API | If a POS with an API exists, sales entry work is partly wasted and the analytics surface has to be renegotiated upward. If a POS exists without an API, nothing changes except that manual entry is duplicated work for the counter staff, which hurts adoption |
| Two outlets at launch | Outlet count is data, not code, so a third outlet is a row plus master data. The real risk is a third outlet during Phase 1, which pulls in onboarding, master data and UAT for a site that does not exist yet |
| Manual data entry is acceptable | If manual entry proves unacceptable to staff, adoption drops and the stock numbers stop being trusted, which fails the primary owner outcome. This is a product risk, not a technical one, and it is why entry is designed around the calm hours of the trading day |
| Around 20 to 30 users | Sizing for Railway Hobby, Supabase Pro and a fixed 250MB Upstash plan assumes this order of magnitude. Ten times the users breaks the under Rs 5,000 per month target before it breaks the architecture |
| Asia/Kolkata is the only timezone | `Outlet.timezone` exists and defaults to Asia/Kolkata, but every business-date computation, cron expression and report boundary assumes a single zone. A genuinely multi-zone deployment means auditing every date computation in the system |
| English is the only UI language | No internationalisation framework is installed and strings are inline. Adding Odia or Hindi means extracting every string, which is mechanical but touches every component and is not a week 3 task |
| Staff use personal Android phones on mobile browsers | Drives mobile-first layout, large tap targets, minimal typing and tolerance for slow connections. If a shared tablet per outlet is used instead, session handling and the forced-reset flow need rethinking, because a shared device means shared logins unless someone stops it |

## Decisions this book makes that the SRS did not ask about

Six things need to be settled before anyone writes a line of code, and none of them appear
in the SRS as a question. They are settled here.

The business day starts at 04:00 IST, not midnight. A QSR closes near midnight and the
closing checklist, the closing stock count and the sales entry often land after it. If the
day boundary were midnight, a Saturday night's closing count would file itself under
Sunday, and every consumption report would be wrong by one day at the busiest times of the
week. Any timestamp between 00:00 and 03:59 IST resolves to the previous calendar date as
its `businessDate`. This rule is implemented in one place, documented in chapter 12, and
never re-implemented locally in a service.

Money and quantity are `Decimal`, never `Float`. Money is `Decimal(14, 2)` and quantity is
`Decimal(14, 3)`. Binary floating point cannot represent 0.1 exactly, and a stock ledger
that recomputes a running balance across hundreds of rows will drift visibly. Three decimal
places on quantity exists because the kitchen issues in grams against items held in
kilograms. This applies end to end: the Prisma column, the zod schema, the service
arithmetic and the JSON on the wire, which carries a string rather than a number.

Stock is an append-only ledger. `StockTransaction` rows are never updated and never
deleted. A correction is a new `ADJUSTMENT` row with a reason. `ItemStock.qtyOnHand` is a
derived running balance kept in the same transaction as the ledger row that moved it. The
reason is auditability: the owner's question is rarely "what is the number" and usually
"why did the number change", and only an immutable ledger answers that. It also makes
concurrent writes safe to reason about, because no two requests contend on rewriting
history.

Deletion is `isActive: false`. Nothing that a user can delete through the UI is removed
from the database. An item that stops being stocked still appears in six months of
purchase history. An employee who leaves still owns last quarter's completed tasks. Hard
deletes either break foreign keys or silently rewrite the past. The only hard deletes in
the system are `RefreshToken` rows and cascade children of a parent that is itself being
removed.

Primary keys are UUIDs generated by the database default. Sequential integers leak
business volume to anyone who can read an id, and they make the eventual merge of seed,
staging and production data awkward. UUIDs cost index size and are worth it at this scale.
Human-facing identifiers are separate and readable: `BM-EMP-0007`, `PR-2026-0042`,
`PO-2026-0117`, and item SKUs like `ITM-CHICKEN-MINCE`.

Notifications go through a transactional outbox, not a direct call. When a business write
needs to tell somebody, it inserts an `OutboxEvent` row inside the same
`prisma.$transaction` as the write itself, and a cron dispatcher picks it up. Calling
WhatsApp inline would mean a slow third-party API sitting inside a database transaction,
and a provider timeout could either roll back a legitimate stock entry or leave a message
sent for a transaction that rolled back. The outbox makes the rule simple: if the business
change committed, the notification will eventually be delivered, and if it did not, no
notification exists.
