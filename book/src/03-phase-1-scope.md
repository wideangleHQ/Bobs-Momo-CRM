# Phase 1 scope boundary

Phase 1 is a three week build for a one time development cost of Rs 45,000, with a target
infrastructure spend under Rs 5,000 per month. Those two numbers set the boundary more
firmly than any requirement list does. This chapter is the definitive statement of what is
inside it.

Because the SRS has broken cross-reference numbering (section headings and body references
disagree throughout), every citation in this chapter names the SRS section by title rather
than by number.

## The boundary in one picture

```text
  ┌─────────────────────────────────────────────────────────────┐
  │ COMMITTED: built, tested and demonstrated in Phase 1 UAT     │
  │                                                              │
  │  Auth + RBAC   Inventory ledger   Purchase + price history   │
  │  Employees     Attendance/leave   Tasks + checklists         │
  │  Notifications Daily sales entry  Dashboard                  │
  │                                                              │
  │   ┌───────────────────────────────────────────────────┐      │
  │   │ CONDITIONAL: built, delivery depends on a third   │      │
  │   │ party. In-app fallback ships regardless.          │      │
  │   │   WhatsApp Business Cloud API delivery            │      │
  │   └───────────────────────────────────────────────────┘      │
  │                                                              │
  │   ┌───────────────────────────────────────────────────┐      │
  │   │ COMMITTED BUT UNSPECIFIED: in the timeline and    │      │
  │   │ the cost, with no requirement block behind it.    │      │
  │   │   Customer CRM, game config, coins, rewards       │      │
  │   │   Analytics, dashboard, daily sales entry         │      │
  │   └───────────────────────────────────────────────────┘      │
  └─────────────────────────────────────────────────────────────┘
        │
        │  everything below this line needs a new estimate
        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ DEFERRED (Future Scope)          OUT (not in any phase       │
  │   Hardware: printers, scanners,    under this agreement)     │
  │   KDS, displays, biometric,          Google OAuth            │
  │   cash drawers                       Payment gateway         │
  │   POS integration                    Native mobile apps      │
  │   Payroll computation                Multi-level approvals   │
  │   Advanced fraud detection           Hardware procurement    │
  │   Outlets beyond the initial 2                               │
  │   BI layer beyond the dashboard                              │
  └─────────────────────────────────────────────────────────────┘
```

## Module by module

| Module | Status | Where the SRS puts it |
|---|---|---|
| Authentication, custom credentials | Committed | Functional Requirements, FR-AUTH-001 |
| RBAC, role and outlet scoping | Committed | Functional Requirements, FR-AUTH-002 |
| Token issue, refresh and expiry | Committed | Functional Requirements, FR-AUTH-003 |
| Inventory items, categories, units | Committed | Inventory Management, Scope |
| Stock transactions and running balance | Committed | Functional Requirements, FR-INV-001 |
| Low stock alerts | Committed | Functional Requirements, FR-INV-002 |
| Stock history and consumption view | Committed, Should-Have | Functional Requirements, FR-INV-003 |
| Outlet to outlet stock transfer | Committed by decision | Inventory Management marks it TBC; resolved in [chapter 04](04-decisions-register.md) |
| Vendor master and vendor-item links | Committed | Purchase and Vendor Management |
| Purchase requests, single manager decision | Committed | Functional Requirements, FR-PUR-001 |
| Purchase records with unit price | Committed | Functional Requirements, FR-PUR-002 |
| Item price history and trend view | Committed, Should-Have | Functional Requirements, FR-PUR-003 |
| Employee profiles | Committed | Functional Requirements, FR-EMP-001 |
| Attendance, shifts, breaks | Committed | Functional Requirements, FR-EMP-002 |
| Leave request and single approval | Committed | Functional Requirements, FR-EMP-003 |
| Leave history and salary storage | Committed | Functional Requirements, FR-EMP-004 |
| Payroll computation, payslips, deductions | Deferred | Future Scope; resolved as storage only in chapter 04 |
| Task creation, assignment, recurrence | Committed | Functional Requirements, FR-TASK-001 |
| Task completion with optional photo | Committed | Functional Requirements, FR-TASK-002 |
| Overdue task notification | Committed | Functional Requirements, FR-TASK-003 |
| Checklists, SOPs and operational audits | Committed | Functional Requirements, FR-TASK-004 |
| Event-driven notification dispatch | Committed | Functional Requirements, FR-NOTIF-001 |
| Internal chat and broadcast | Committed, Should-Have | Functional Requirements, FR-NOTIF-002 |
| WhatsApp message delivery | Conditional | Third-Party Integrations, "provider dependent" |
| Daily sales entry, manual | Committed, no FR block | Management and Analytics; TBC resolved in chapter 04 |
| Management dashboard and reports | Committed, no FR block | Module Architecture and the week 3 plan |
| Customer records, game config, coins, rewards | Committed, no FR block | Executive summary, traceability matrix, week 3 plan |
| Audit log of key business actions | Committed | Non-Functional Requirements, Auditability |
| POS integration | Deferred | Future Scope |
| Hardware of any kind | Deferred | Technology Stack, hardware exclusion subsection |
| Google OAuth or any social login | Out | Out of Scope |
| Payment gateway | Out | Out of Scope, unless separately scoped |
| Native mobile applications | Out | Out of Scope, Phase 1 is responsive web only |
| Multi-level approval chains | Out | Out of Scope |
| Advanced fraud and abuse detection | Deferred | Future Scope |
| Advanced analytics or BI layer | Deferred | Future Scope |

## The exclusions, stated plainly

These are not oversights and they are not negotiable inside Phase 1. Each one is written
into the SRS as an exclusion, and each one has an engineering consequence you need to know
about before you design anything.

Thermal printers, barcode scanners, Kitchen Display Systems, customer displays, biometric
devices and cash drawers are all removed from the Phase 1 architecture. The consequence is
that every inventory, purchase and operational entry is a web form filled in by a human.
Design forms for a phone keypad and a person in a hurry: numeric keyboards on quantity
fields, sensible defaults, no more than one screen of input per action.

Google OAuth and any social login are excluded on explicit client instruction.
Authentication is custom credentials with argon2id hashing, a JWT access token and a
rotating refresh token. There is no identity provider to fall back on, which means account
lockout, password reset and the forced first-login reset (`User.mustReset`) are all our
problem. Chapter 13 owns this.

Native mobile applications are out. Phase 1 is responsive web only. There is no app store
release, no push notification channel and no offline mode. WhatsApp and in-app
notifications are the only two ways to reach someone who is not looking at the screen.

Payment gateway integration is out unless separately confirmed and scoped. Nothing in the
system takes money. `DailySalesEntry` records amounts that were already collected at the
counter, split across cash, UPI, card and other. It is a record, not a transaction.

Multi-level approval chains are out. Every workflow has at most one decision step. A
purchase request goes to the purchase manager and is approved or rejected. A leave request
goes to the store manager and is approved or rejected. If a design document you are handed
contains the phrase "then escalates to", it is out of scope.

Payroll computation is out. `SalaryRecord` stores structure (monthly CTC, basic,
allowances, effective dates) and nothing computes from it. No payslips, no deductions, no
statutory calculation. This distinction matters because storing salary structure is a
half-day of work and computing payroll correctly for Indian statutory rules is not.

POS integration is out. No POS API is assumed to exist. Sales arrive as one manually
entered `DailySalesEntry` row per outlet per day. Every analytics figure that depends on
sales inherits that granularity: there is no per-item sales data in Phase 1, therefore no
per-dish margin, therefore the P and L overview is limited to what daily totals and
recorded purchases can support.

## Conditional on a third party

WhatsApp delivery is the only conditional item in Phase 1. The SRS lists the WhatsApp
Business API as confirmed and desired, dependent on provider API availability, approval
and usage pricing, and treats its usage cost as separate from the fixed infrastructure
budget. The client bears that usage cost.

Meta's approval process for a WhatsApp Business Cloud API number, business verification
and message template approval is outside our control and routinely takes longer than three
weeks. The build therefore treats WhatsApp as a delivery adapter behind the notification
system, not as the notification system.

```text
   business write (in transaction)
         │
         ▼
   OutboxEvent row  ─── PENDING
         │
         ▼
   OutboxDispatcher cron
         │
         ├──────────────► Notification row, channel IN_APP   [always ships]
         │
         └──────────────► Notification row, channel WHATSAPP [conditional]
                                │
                                ▼
                          WhatsAppService
                                │
                          ┌─────┴─────┐
                          │ approved? │
                          └─────┬─────┘
                         yes    │    no
                          ┌─────┴─────┐
                          ▼           ▼
                     send via     status SUPPRESSED,
                     Cloud API    logged, no retry storm
```

The acceptance position is this. If Meta approval lands before UAT, WhatsApp delivery is
demonstrated. If it does not, in-app notifications are demonstrated, the WhatsApp adapter
is delivered and tested against the provider sandbox, and the switch is a credential
change. No committed requirement fails because of a provider queue.

## Committed functional requirements

Sixteen requirement blocks exist in the SRS. Thirteen are Must-Have, three are
Should-Have. All sixteen are committed in Phase 1, with the Should-Have items scheduled
after the Must-Have items in the same module chapter.

| FR | Requirement | Priority | Owning chapter |
|---|---|---|---|
| FR-AUTH-001 | Custom user login | Must-Have | 13 |
| FR-AUTH-002 | Role-based access control | Must-Have | 14 |
| FR-AUTH-003 | Session and token management | Must-Have | 13 |
| FR-INV-001 | Record stock transaction | Must-Have | 16 |
| FR-INV-002 | Low stock alert | Must-Have | 16, dispatch in 21 |
| FR-INV-003 | Stock history and consumption view | Should-Have | 16 |
| FR-PUR-001 | Create purchase request | Must-Have | 17 |
| FR-PUR-002 | Record purchase and price | Must-Have | 17 |
| FR-PUR-003 | View price history | Should-Have | 17 |
| FR-EMP-001 | Employee profile management | Must-Have | 18 |
| FR-EMP-002 | Attendance, shift and break logging | Must-Have | 18 |
| FR-EMP-003 | Leave request and approval | Must-Have | 19 |
| FR-EMP-004 | Leave and salary history | Must-Have | 19 |
| FR-TASK-001 | Create and assign task | Must-Have | 20 |
| FR-TASK-002 | Complete task | Must-Have | 20 |
| FR-TASK-003 | Overdue task notification | Must-Have | 20, sweep job in 24 |
| FR-TASK-004 | Checklist and audit execution | Must-Have | 20 |
| FR-NOTIF-001 | Event-driven notification dispatch | Must-Have | 21 |
| FR-NOTIF-002 | Internal chat and broadcast | Should-Have | 21 to 25 |

## Requirements the SRS commits to but does not specify

These are defects in the source document, not in the build. Each one is stated with what
is missing, what it costs us, and which chapter closes it.

Section 6.3 does not exist. The module architecture runs 6.1 Operations, 6.2 Workforce,
then jumps to 6.4 Management and Analytics. Customer Experience is named as a pillar in
the executive summary, appears in the traceability matrix, and occupies most of week 3 in
the delivery timeline, but has no scoping section. It is also missing from the pillar
bullet list in the TO-BE section, which enumerates four pillars under the heading "five
business pillars". The impact is that the entire customer-facing feature set has no
agreed contents. Chapter 32 reconstructs a minimal scope from the fragments that do exist
and marks it as the largest single scope risk in the project.

Section 15.7 and FR-CRM-001 are cited but were never written. Open question 7 in the SRS
points at both of them for guest versus identified customer handling. Neither exists
anywhere in the document. The impact is that the customer CRM and game layer is committed
in both the timeline and the Rs 45,000 cost while carrying no testable requirement, so
acceptance for that module cannot be demonstrated against the SRS. Chapter 04 records the
Phase 1 default (guests play with a session key and earn nothing, coins and rewards need a
verified phone number) and chapter 32 turns it into a buildable specification. This needs
client sign-off in week 1, in writing, before any CRM work starts.

No FR block exists for sales entry, analytics or the dashboard. The acceptance criteria
require that all Must-Have functional requirements are implemented, and analytics has no
functional requirement at all, so it can be neither passed nor failed. Meanwhile the
Management and Analytics section lists six reports and the module list treats them as
delivered. The impact is an open-ended reporting surface. Chapters 30 and 31 close it by
defining the exact endpoint set and the exact figures the dashboard shows, capped at what
one `DailySalesEntry` row per outlet per day can support.

Cross-reference numbering is broken throughout. The System Architecture section is titled
14 but numbers its subsections 16.1 through 16.12. The Assumptions and Constraints section
is titled 21 but numbers its subsections 23.1 and 23.2. Client and Agency Responsibilities
is titled 26 with subsections 28.1 and 28.2. Body text points at "Section 13", "Section
14", "Section 15", "Section 16.10", "Section 20", "Section 24", "Section 25" and "Section
29" and most of those references do not resolve to the section the sentence intends. One
example with a commercial edge: the executive summary says the infrastructure stack is
detailed in "Section 20", but Section 20 is Testing and UAT, while costs are in
Deployment and Infrastructure Cost. The impact is that any acceptance argument citing an
SRS section number is ambiguous. The working rule for this project, and for this book, is
to cite the SRS by section title only.

## Scope change protocol

The SRS defines a category called Minor Refinements: small changes to UI, workflows, field
structures and implementation details, made during planning, design, development or
testing, accommodated inside the agreed scope. It also states that major new modules or
materially expanded functionality require separate evaluation and approval. The line
between those two is where projects of this size fail, so here is the working test.

A change is a minor refinement if it changes how an already-committed thing looks or is
entered, without adding a new noun to the data model, a new role, a new integration, or a
new decision step. Renaming a field label, adding a note field to a form, changing the
order of checklist items, adding a filter to a list view, splitting one screen into two,
or adjusting a default all qualify. These get absorbed.

A change needs a new estimate if any of the following is true. It adds a table or a state
machine that is not in [chapter 10](10-data-model.md). It adds a role beyond the nine in
`RoleKey`. It adds an approval step to a workflow that currently has one or zero. It adds
a third-party integration. It requires per-item sales data, which Phase 1 cannot produce
without a POS. It requires hardware. It requires payroll computation. It extends the
system to a third outlet during Phase 1. It adds a language or a timezone.

Two changes look minor and are not, so they are called out explicitly. Making
`reorderLevel` a rule rather than a number (for example, "alert when three days of average
consumption remain") is a forecasting feature, not a threshold edit. Adding "just a small
report" that needs figures the daily sales row does not carry is a POS request wearing a
different hat.

When a request crosses the line, the response is not refusal. It is a written estimate
against Phase 2, recorded the same day, with the Phase 1 behaviour left intact. The three
week window has no slack in it, and the most reliable way to miss the date is to absorb
four changes that were each individually reasonable.
