# Acceptance criteria and the UAT script

The SRS lists six acceptance criteria. Four of them are testable as written and two are
not. This chapter makes all six testable, then gives the UAT session script that produces
the sign-off.

## The six criteria, made testable

**Criterion 1. All Must-Have functional requirements are implemented and pass functional
testing.**

Testable, with one problem: the SRS has no functional requirement block for sales entry,
analytics or the dashboard, yet commits all three in the module list and the week 3 plan.
[Chapter 31](31-analytics-and-reporting.md) writes the missing specifications. For
acceptance, the list below is the definitive set and it should be agreed with the client
in week 1 so nobody argues about it on UAT day.

| FR | Requirement | Verified by |
|---|---|---|
| FR-AUTH-001 | Custom user login | UAT-01 |
| FR-AUTH-002 | Role-based access control | UAT-02, RBAC test matrix |
| FR-AUTH-003 | Session and token management | UAT-01, auth e2e suite |
| FR-INV-001 | Record stock transaction | UAT-03 |
| FR-INV-002 | Low stock alert | UAT-04 |
| FR-INV-003 | Stock history and consumption view | UAT-05 |
| FR-PUR-001 | Create purchase request | UAT-06 |
| FR-PUR-002 | Record purchase and price | UAT-07 |
| FR-PUR-003 | View price history | UAT-08 |
| FR-EMP-001 | Employee profile management | UAT-09 |
| FR-EMP-002 | Attendance, shift and break logging | UAT-10 |
| FR-EMP-003 | Leave request and approval | UAT-11 |
| FR-EMP-004 | Leave and salary history | UAT-12 |
| FR-TASK-001 | Create and assign task | UAT-13 |
| FR-TASK-002 | Complete task | UAT-14 |
| FR-TASK-003 | Overdue task notification | UAT-15 |
| FR-TASK-004 | Checklist and audit execution | UAT-16 |
| FR-NOTIF-001 | Event-driven notification dispatch | UAT-17 |
| FR-NOTIF-002 | Internal chat and broadcast | UAT-18, Should-Have |
| Added | Daily sales entry | UAT-19 |
| Added | Reports and dashboard | UAT-20 |

**Criterion 2. RBAC correctly restricts each defined role to its intended
modules and outlets.**

Testable. Verified two ways: the table-driven RBAC test in
[chapter 33](33-testing-strategy.md) asserts the expected status for every route and
every role automatically, and UAT-02 has the client log in as three different roles and
confirm what they can see.

The acceptance bar is that the automated matrix is green and that a Kitchen Staff login
cannot reach salary, cannot reach the other outlet, and cannot approve a leave request.

**Criterion 3. Inventory, purchase, employee, task and game or reward workflows operate
end to end without unnecessary approval steps.**

Partly testable, and the game and reward half is a problem. See
[chapter 32](32-customer-crm-and-game.md): the SRS never specifies that module. If the
scope decision in [chapter 38](38-delivery-plan.md) defers it, this criterion must be
amended in writing to drop the words "game/reward" before UAT, or the client can
correctly refuse sign-off on a module nobody scoped.

The "without unnecessary approval steps" clause is testable and worth testing explicitly:
completing a routine task must not require a manager action, and a purchase request must
reach a decision in exactly one manager step.

**Criterion 4. Notifications fire correctly for each event listed.**

Testable. UAT-17 walks each event. Where WhatsApp templates are not yet approved by Meta,
the in-app notification is the acceptance evidence and the WhatsApp channel is verified
separately when approval lands. Agree that split with the client in week 1, because the
SRS already marks WhatsApp as third-party dependent.

**Criterion 5. System deployed to production, accessible to authorised users.**

Testable. The smoke suite in [chapter 34](34-ci-cd.md) plus a successful login from the
client's own phone on mobile data, not office wifi.

**Criterion 6. UAT sign-off obtained.**

This is the output of the session below, not a separate test.

## Before the session

The UAT session fails if the environment is not ready. Run this checklist the day before.

1. Production is deployed and the smoke suite is green.
2. Real master data is loaded: both outlets, real departments, the client's actual item
   list, real vendor list, real employee list.
3. One user account exists per role, with the password written on a printed sheet.
4. Historical data is seeded so reports are not empty. Fourteen days of plausible stock
   transactions, purchases, attendance, tasks and daily sales. An empty dashboard reads
   as broken even when it is correct.
5. Low stock thresholds are set on at least five items so UAT-04 can fire.
6. At least one recurring checklist is configured and has generated instances.
7. WhatsApp is either live with approved templates, or `WHATSAPP_ENABLED=false` and the
   client has been told in advance which channel is being demonstrated.
8. Two real phones are in the room, one Android on mobile data, one laptop.
9. A defect log is open, with columns for id, script step, severity, description,
   screenshot and owner.

## Severity definitions

Agree these before the session starts, not while arguing about a specific bug.

| Severity | Definition | Effect on sign-off |
|---|---|---|
| S1 blocker | A committed workflow cannot be completed at all, or data is wrong | Blocks sign-off |
| S2 major | Workflow completes but with a wrong result, or a role sees data it should not | Blocks sign-off |
| S3 minor | Cosmetic, copy, layout, or a slow screen that still works | Sign-off with a fix list |
| S4 request | New behaviour not in the SRS | Phase 2 list, does not block |

The S4 row is the important one. Most UAT findings at a QSR are S4, and treating them as
defects is how a three week project becomes a five week project.

## The UAT script

Each step names the actor, the device, the exact actions, and the expected result. The
client performs the actions. The team watches and does not touch the phone.

**UAT-01, login and session.** Store Manager, phone. Log in with the printed credentials.
Expected: the app opens on a store manager home screen, the change-password screen
appears first because `mustReset` is true, and after changing the password the home
screen loads. Then close the browser, reopen, and confirm the session is still valid.

**UAT-02, role boundaries.** Three logins in sequence, phone. Log in as Kitchen Staff and
confirm there is no salary screen, no other outlet, and no leave approval. Log in as HR
and confirm salary is visible and stock entry is not. Log in as Owner and confirm both
outlets appear in the outlet selector.

**UAT-03, record a stock transaction.** Kitchen Manager, phone. Record an issue of 5 kg
of a real item from the store to the kitchen. Expected: the transaction saves, the
current stock figure drops by exactly 5, and the ledger shows the new row with the
balance after. Then attempt to issue more than is on hand and confirm a clear blocking
message, not a crash.

**UAT-04, low stock alert.** Inventory Manager, phone. Issue enough of a threshold item
to cross below its reorder level. Expected: within seconds a notification appears for the
manager, and if WhatsApp is live, a WhatsApp message arrives. Then issue more of the same
item and confirm no second alert arrives, because the cooldown is working.

**UAT-05, stock history and consumption.** Owner, laptop. Open the consumption report for
the last seven days for one outlet. Expected: numbers match what the client expects from
their own register for at least two items. This is the step that most often surfaces a
definition disagreement, so have the definition of consumption from
[chapter 31](31-analytics-and-reporting.md) ready to read out.

**UAT-06, purchase request.** Store Manager, phone. Raise a request for three items.
Expected: the request saves, and the Purchase Manager receives a notification.

**UAT-07, approve and record a purchase.** Purchase Manager, laptop. Approve the request,
then record the purchase against a real vendor with real quantities and prices from a
real bill the client brings to the session. Expected: the purchase total matches the
paper bill to the rupee, stock increases by the purchased quantities, and price history
now has a row per line.

**UAT-08, price history.** Owner, laptop. Open the price trend for one item. Expected:
the trend shows the price just entered and any seeded history, and the owner can answer
the question "what did chicken cost last Tuesday" in under ten seconds without help.

**UAT-09, employee profile.** HR, laptop. Create a new employee, assign outlet,
department and role, and create a login for them. Expected: the employee appears in the
roster picker and the task assignee picker immediately.

**UAT-10, attendance and breaks.** Kitchen Staff, phone. Punch in, start a break, end the
break, punch out. Meanwhile the Store Manager watches the live attendance board on a
laptop. Expected: the board shows the status change within one refresh cycle, and the
worked minutes at the end exclude the break.

**UAT-11, leave request and approval.** Kitchen Staff requests two days of leave. Store
Manager receives the notification, approves it. Expected: the employee receives a
decision notification, and the attendance board for those future dates shows the employee
as on leave.

**UAT-12, leave and salary history.** HR, laptop. Open the employee's leave history and
confirm the approved leave appears. Open the salary record and confirm it is visible.
Then log in as Store Manager and confirm salary is not visible anywhere.

**UAT-13, create and assign a task.** Store Manager, phone. Create a task with a due time
two hours out and assign it to a specific staff member. Expected: the staff member gets a
notification and the task appears at the top of their list.

**UAT-14, complete a task.** The assigned staff member, phone. Open the task, start it,
attach a photo, complete it. Expected: it completes without any manager approval step,
and the manager sees the completion and the photo.

**UAT-15, overdue notification.** Use a task seeded with a due time in the past. Expected:
within ten minutes the manager receives one overdue notification, and only one, even
after waiting a further ten minutes.

**UAT-16, checklist and audit.** Kitchen Staff, phone. Run the kitchen opening checklist.
Mark one item as failed. Expected: the checklist submits, the failure is recorded, and a
follow-up task is automatically created and assigned to the store manager with high
priority. This is the step that demonstrates the shared task engine, so narrate it.

**UAT-17, notification coverage.** Walk the notification event table with the client and
confirm each event that has been triggered during this session produced a notification to
the right person. Trigger any that have not fired yet.

**UAT-18, chat and broadcast.** Store Manager sends a broadcast to their outlet. Expected:
every staff member in that outlet receives it, and the other outlet does not. Mark as
Should-Have if it was deferred.

**UAT-19, daily sales entry.** Counter Cashier, phone. Enter yesterday's real sales
figures including the payment split. Expected: it saves, the split validation catches a
deliberate mismatch when tested, and the figure appears on the dashboard.

**UAT-20, reports and dashboard.** Owner, laptop. Open the dashboard, then drill into
wastage, then export a report to CSV and open it. Expected: the numbers are consistent
between the dashboard tile and the detail report, and the CSV opens cleanly in Excel with
correct Indian number formatting.

## Running the session

Two hours, two facilitators. One drives the script and one takes the defect log. Do not
fix anything during the session, even a one-line fix, because a mid-session deploy
invalidates everything tested before it.

Take a screenshot of every defect at the moment it happens. A description written an hour
later is always worse than the screenshot.

At the end, read the defect log back in full, agree the severity of each item on the spot,
and agree which S3 items are in the fix window and which move to Phase 2.

## Sign-off

Sign-off happens when there are zero open S1 and zero open S2 defects. S3 items may be
open, listed, with an agreed fix date.

The sign-off record should state, in writing:

1. The date and the attendees.
2. The scope actually accepted, referencing the FR list above, including any module
   formally deferred to Phase 2 per the week 1 scope decision.
3. The defect log, with severity and disposition for every item.
4. The S3 fix list with dates.
5. The Phase 2 list, so the S4 requests are captured rather than lost.
6. What the client is responsible for after go-live: WhatsApp usage charges, master data
   maintenance, adding staff accounts.

## After sign-off

Three things that are part of the engagement and are routinely forgotten.

A training session for staff, separate from UAT. UAT proves the software works. Training
is what makes people use it. Thirty minutes per role, on their own phones, with the
person who will actually do the task.

A two week hypercare window with an agreed response time, written down. State it honestly:
at this price there is no round-the-clock rotation, and the client is better served by a
clear weekday support window than by an implied promise nobody can keep.

The handover pack: credentials in a password manager the client controls, the runbook
from [chapter 35](35-deployment-runbook.md), the environment variable list, and the
Phase 2 list.
