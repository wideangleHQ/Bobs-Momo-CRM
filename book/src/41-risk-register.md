# Risk register

Risks are scored on likelihood and impact, each 1 to 5. Exposure is the product. Anything
at 12 or above needs an owner and a mitigation that starts in week 1, not a note that
says "monitor".

The register is ordered by exposure. The top five are the ones that actually decide
whether this project ships.

## R-01, the scope does not fit the calendar

Exposure 20. Likelihood 5, impact 4.

The backlog in [chapter 38](38-delivery-plan.md) estimates 55.5 engineer-days against 35
days of capacity. That is not a risk of running late, it is a certainty of running late
unless something is cut. The arithmetic is in that chapter and it is not close.

The failure mode is the common one on fixed-price work: nobody says anything until day
12, then the team works two unpaid weekends, quality drops on the modules built last,
and the client gets a system that computes stock wrong.

Mitigation. Put the arithmetic in front of the client in week 1 with three named options
and a recommendation. Get a written decision by Friday of week 1. Track burn-down daily
against the estimates, not against a feeling, and raise it again at the Friday checkpoint
of week 2 if the trend is off.

Owner: the project owner, with the tech lead supplying the numbers.

Trigger for escalation: less than 60 percent of week 1 tickets closed by Friday.

## R-02, the customer CRM and game layer has no specification

Exposure 20. Likelihood 5, impact 4.

The SRS commits this work in the executive summary, the week 3 plan, the traceability
matrix and acceptance criterion 3, but Section 6.3 is missing from the document and both
Section 15.7 and FR-CRM-001 are cited by the open questions without existing anywhere.
The TO-BE section says five pillars and then lists four, dropping this one.

So the team is contractually committed to building something nobody wrote down, in the
last week of a three week project, where there is no recovery time.

Mitigation. Two acceptable outcomes and no third. Either the client provides a written
scope for this module by the end of week 1, in which case
[chapter 32](32-customer-crm-and-game.md) has a proposed minimum specification to put in
front of them and shorten that conversation. Or it is formally deferred to Phase 2 with
acceptance criterion 3 amended in writing to remove the words "game/reward".

Do not start building this on a verbal description. Do not start building it in week 3.

Owner: the project owner.

Trigger for escalation: no written scope or written deferral by end of week 1.

## R-03, WhatsApp template approval arrives too late

Exposure 12. Likelihood 4, impact 3.

Meta reviews message templates on its own schedule. The SRS already marks WhatsApp as
third-party dependent, so the commercial exposure is limited, but the demonstration
exposure is not: the client's mental picture of this system is "it messages me", and a
UAT session with no WhatsApp feels like a half-built product regardless of what the
contract says.

Rejection reasons are usually fixable and usually take another round trip, which is why
lead time matters more than correctness on the first submission.

Mitigation. Submit every template in week 1, day three at the latest, using the drafts in
[chapter 22](22-whatsapp-integration.md). Build behind the `WHATSAPP_ENABLED` flag so the
whole system works with in-app notifications only. Tell the client in week 1 which
channel UAT will demonstrate, so it is an expectation and not a surprise.

Owner: whoever owns lane C, with the project owner handling the Meta business account.

## R-04, client master data arrives late

Exposure 12. Likelihood 4, impact 3.

The SRS puts item, vendor, employee and outlet master data on the client for week 1. In
practice a QSR owner is running two outlets and this is not their priority. Without it,
seeding is guesswork, reports are empty, low stock thresholds cannot be set, and UAT runs
on fake data that hides real problems.

Mitigation. Send the CSV templates from [chapter 11](11-migrations-and-seed.md) on day
one, not day three. Ask for a partial list rather than a perfect one: thirty items is
enough to build and test against. Offer to sit with the store manager for an hour and
type it, because an hour of engineer time beats a week of waiting. Build the importer
early so the real list can drop in at any point.

Owner: the project owner.

## R-05, stock numbers are wrong and staff go back to the register

Exposure 10. Likelihood 2, impact 5.

This is the low-likelihood, catastrophic-impact one. The entire value of this system is
that the owner can trust the stock figure without walking to the store room. If the
balance is wrong once and someone notices, the paper register comes back out and every
subsequent number is checked against it, which is worse than not having the system.

The specific ways it goes wrong: a race between two concurrent transactions on the same
item, a sign error on one of the eight transaction types, a double submission from a
flaky phone connection, or a purchase that writes stock rows without going through the
inventory service's balance logic.

Mitigation. All four are addressed in the design and all four need a test that proves it.
The row lock in [chapter 12](12-data-scoping-and-integrity.md), the sign rules table in
[chapter 16](16-inventory.md), the idempotency key in
[chapter 15](15-api-conventions.md), and the rule in [chapter 17](17-purchase-and-vendors.md)
that purchase calls the inventory service rather than writing rows itself. On top of
those, the nightly reconciliation job that recomputes every balance from the ledger and
alerts on drift, and the property-based test in
[chapter 33](33-testing-strategy.md) that throws random transaction sequences at the
invariant.

The per-module coverage floor is 100 percent on inventory, purchase and the balance
logic. That is the one place in this project where a blanket coverage number is not
enough.

Owner: the tech lead, who reviews both money paths personally.

## R-06, the Bun runtime causes a late, hard-to-diagnose failure

Exposure 9. Likelihood 3, impact 3.

The SRS names Bun as the runtime. NestJS depends on decorator metadata emitted by the
TypeScript compiler and read through `reflect-metadata`, and the Prisma query engine ships
as a native binary with its own Node API expectations. Both have historically been rough
edges on Bun. Discovering an incompatibility on day 16 while deploying to production is a
bad day.

Mitigation. ADR-002 in [chapter 07](07-technology-decisions.md) runs Node 22 in production
and keeps Bun for install, scripts and the test runner, so the commitment is honoured in
substance and the swap back is a one-line Dockerfile change once the stack is proven. Be
straight with the client about this rather than quietly substituting a runtime they named
in a signed document.

Owner: the tech lead.

## R-07, Supabase connection pool exhaustion under Prisma

Exposure 9. Likelihood 3, impact 3.

Supabase fronts Postgres with Supavisor in transaction mode. Prisma's default connection
behaviour and prepared statements do not survive transaction-mode pooling without the
right connection string parameters, and migrations must use the direct connection rather
than the pooler. The symptom is intermittent, appears under load, and looks like a
different bug every time.

Mitigation. Get the `DATABASE_URL` and `DIRECT_URL` split right on day one per ADR-004,
with `pgbouncer=true` and a small `connection_limit`. Load test the dashboard and the
stock entry endpoint before UAT, not after. Document the symptom in the troubleshooting
table in [chapter 08](08-repository-and-local-setup.md) so the second engineer does not
lose an afternoon to it.

Owner: whoever owns the spine in week 1.

## R-08, mobile usability fails in the actual kitchen

Exposure 9. Likelihood 3, impact 3.

Everything in this system is tested on a desk. It gets used by someone standing next to a
fryer, holding a phone in one hand, with flour on their fingers, on 4G that drops behind
the walk-in fridge. A form that works fine in a browser at 1440 pixels can be unusable at
360 pixels with a wet thumb.

Mitigation. The mobile rules in [chapter 28](28-ui-system.md) are hard requirements, not
guidance: 44 pixel touch targets, bottom navigation, single-column forms, numeric input
modes, sticky submit bars. Beyond that, the Friday week 2 demo puts the client's own store
manager on their own phone and the team watches without helping. Every fumble is a defect.

Owner: whoever owns the frontend.

## R-09, the client adds scope during week 3

Exposure 8. Likelihood 4, impact 2.

Once people can see a working system they think of things. This is healthy and it is also
how the last week gets consumed. The SRS anticipates it with a scope management clause
that distinguishes minor refinements from material new functionality.

Mitigation. State the Wednesday-noon freeze in week 1, not on the day it is needed. Keep a
visible Phase 2 list from week 1 so a request goes somewhere rather than being refused.
Quote the SRS clause when the conversation happens, and give the client an estimate for
the new item rather than a no.

Owner: the project owner.

## R-10, no POS means the P&L cannot be what the owner is picturing

Exposure 8. Likelihood 4, impact 2.

The SRS lists a P&L Overview with the caveat "where data availability permits". With no
POS integration, no recipe or bill of materials, and manual daily sales totals, what can
actually be produced is total sales minus total purchases for a period. That is a gross
margin approximation, not a P&L, and it excludes labour, rent, utilities and the
difference between packaging purchased and packaging consumed.

The risk is not technical. It is that the owner opens the screen in UAT expecting a
profit figure and gets something less.

Mitigation. Say it in week 1, in plain words, and again on the screen itself. The
analytics chapter requires the caveat to be rendered as visible label text on the P&L
view, not buried in documentation. Show a sample of the real output early so expectations
are set against something concrete.

Owner: the project owner.

## R-11, a single engineer is unavailable for several days

Exposure 8. Likelihood 2, impact 4.

At two engineers, losing one for three days removes ten percent of total capacity from an
already over-committed plan. Illness, a family event, another client escalation.

Mitigation. Keep the lane split from [chapter 39](39-parallel-work.md) documented so the
other engineer can pick up a lane without archaeology. No work uncommitted overnight. Pull
requests under 400 lines so nothing sits half-reviewed. The tech lead's five days are the
buffer, and they should be spent on review and the money paths, not pre-allocated to
feature work.

Owner: the tech lead.

## R-12, infrastructure cost drifts above the stated ceiling

Exposure 6. Likelihood 3, impact 2.

The SRS targets under Rs 5,000 per month. Railway Hobby at 5 dollars, Supabase Pro at 25
and Upstash at 10 comes to 40 dollars, roughly Rs 3,400 at current rates, which leaves
headroom. The two things that eat it are WhatsApp conversation charges, which are
usage-based and quoted separately in the SRS, and frontend hosting if Vercel Pro is used
for commercial deployment at 20 dollars, which pushes the total to about Rs 5,100.

Mitigation. ADR-005 in [chapter 07](07-technology-decisions.md) hosts the frontend on
Railway alongside the API, which keeps the fixed cost inside the ceiling. Set a Supabase
usage alert. Give the client a WhatsApp volume estimate in week 1 with the arithmetic
shown, so a variable cost is a decision rather than a surprise on the first invoice.

Owner: the project owner.

## R-13, no accrual tracking means leave balances get argued about

Exposure 6. Likelihood 3, impact 2.

Phase 1 stores leave requests and history but does not track entitlement or accrual, per
the decision in [chapter 04](04-decisions-register.md). Managers approve leave by looking
at history and using judgement, which is what they do today on WhatsApp.

The risk is that the client assumed a balance was included and finds out in UAT.

Mitigation. It is in the decisions register, it is in the scope chapter, and it should be
said out loud in the week 1 scope conversation. Adding accrual later is additive: an
entitlement table and a balance calculation, with no change to the existing leave flow.

Owner: the project owner.

## R-14, reward abuse on the public game endpoints

Exposure 6. Likelihood 3, impact 2.

Only applies if the CRM and game layer is in scope. The public endpoints are the only part
of this system exposed to the open internet, and coupons have real cash value at the
counter. Open question 6 in the SRS asks how sophisticated the fraud controls need to be,
which is an honest admission that three weeks does not buy much.

Mitigation. The controls in [chapter 32](32-customer-crm-and-game.md) are rate limits, a
server-side score ceiling, one play per session per cooldown, a daily coin cap, single-use
random coupon codes, and a full audit trail. What is not built is device fingerprinting,
behavioural analysis and signed replay validation. The business mitigation matters more
than the technical one: keep reward values small in Phase 1, so farming coins is not worth
anyone's afternoon.

Owner: whoever builds the CRM module, with the reward value decision owned by the client.

## R-15, staff do not adopt it and quietly keep using WhatsApp

Exposure 5. Likelihood 5, impact 1 technically, 5 commercially.

Scored low on technical impact and high on commercial impact, which is why it sits at the
bottom of a technical register and at the top of the client's actual concern. Every piece
of software that replaces a WhatsApp group faces this. The system can be perfect and still
lose to a habit.

Mitigation. Three things, none of which are code. Training per role on their own phones
after sign-off, not a group demo. Making the fast path faster than WhatsApp for the two
highest-frequency actions, which are the attendance punch and the checklist run, so using
the app is the lazy option. And tracking the product adoption metrics from
[chapter 36](36-observability-and-audit.md) in the first two weeks, because knowing that
the Patia outlet stopped submitting closing checklists on day four is the difference
between a fixable problem and a dead project.

Owner: the project owner, with the client's owner as the person who has to insist.

## Review cadence

Read this register at the Friday checkpoint of each week. Rescore R-01 and R-02 every
week without exception, because those two decide the outcome and their likelihood changes
fast once decisions are made.

Anything that moves above exposure 12 during the build gets added to this list with an
owner the same day.
