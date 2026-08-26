# Open questions for the client

Every question here has a default answer already chosen in
[chapter 04](04-decisions-register.md), so nobody is blocked waiting. The point of asking
is to confirm the defaults are right before they become expensive to change, not to stop
work.

The questions are grouped by deadline. Group 1 changes what gets built and must be
answered by Tuesday of week 1. Group 2 changes how something behaves and can wait until
Friday. Group 3 is operational and can wait until week 2.

## Group 1, answer by Tuesday of week 1

These four change the shape of the build. A late answer costs days.

**Q1. Is the customer CRM and game layer in Phase 1?**

Default if no answer: deferred to Phase 2.

Why we are asking. The SRS commits this work in the executive summary, the week 3 plan,
the traceability matrix and acceptance criterion 3. But Section 6.3, which should scope
it, is missing from the document, and both Section 15.7 and FR-CRM-001 are cited by the
SRS open questions without existing anywhere in it. The TO-BE section says five pillars
and then lists four. So we are committed to building it and have nothing that says what
it is.

What we need if it is in scope. A written page covering: which website game or games feed
it, how a score converts to coins, what rewards exist and what they are worth, whether a
customer must give a phone number, and who redeems a coupon at the counter. Our proposed
minimum specification is in [chapter 32](32-customer-crm-and-game.md) and can be approved
or edited rather than written from scratch.

What deferring costs. Nothing technically. Acceptance criterion 3 needs amending in
writing to remove the words "game/reward", and roughly five engineer-days come back into
the plan, which materially improves the odds on everything else.

**Q2. Which scope option do we take to fit three weeks?**

Default if no answer: Option A plus B-partial, meaning the game layer and internal chat
both move to Phase 2.

Why we are asking. The ticket-level backlog in [chapter 38](38-delivery-plan.md) comes to
55.5 engineer-days. Capacity over three weeks with two engineers and a part-time lead is
35 days. The gap is 20.5 days. That is arithmetic, not pessimism, and it means something
has to change: scope, timeline, or quality. We are not willing to change quality on a
system that tracks stock and money, so it is scope or timeline.

The three options, with the numbers, are in chapter 38. Our recommendation is to defer the
game layer, move internal chat to Phase 2, and extend by one week. That puts 45 capacity
days against a 49 day backlog, which is survivable.

What we need. A decision, in writing, by Friday of week 1 at the latest. Answering on day
12 is the same as not answering.

**Q3. Does a POS system exist that we can pull sales from?**

Default if no answer: no POS, sales are entered by hand once per outlet per day.

Why we are asking. This is open question 8 in the SRS. Daily sales feeds the dashboard,
the sales report and the gross margin view. If there is an existing POS with an export or
an API, sales capture becomes automatic and the numbers get better. If there is not,
someone at each outlet types four figures at close, every day, forever, and the whole
reporting layer depends on them remembering.

What we need if a POS exists. The vendor and product name, whether it has an API or a
scheduled export, and a sample of the export file.

What it changes. With a POS, roughly a day of integration work and the daily sales entry
screen becomes a fallback. Without one, we build the manual entry screen and the 23:30
reminder job, and we should tell the store managers on day one that this is now part of
closing.

**Q4. Is payroll computation in scope, or salary storage only?**

Default if no answer: storage only. No payslips, no deductions, no computation.

Why we are asking. This is open question 4 in the SRS. Storage is a table and a restricted
screen. Computation is attendance-linked pay, leave deduction rules, statutory
deductions, payslip generation and a whole category of correctness risk, and it is not
something to attempt in the last week of a three week build.

What it changes. Storage only is already estimated at 1.5 days including leave. Adding
computation is at least four more days and would need its own specification for the
deduction rules, which do not exist yet.

## Group 2, answer by Friday of week 1

These change behaviour rather than scope. The defaults are safe.

**Q5. Do the two outlets transfer stock to each other?**

Default: yes, it is built. Paired transfer rows, one out and one in.

Why we are asking. This is open question 2 in the SRS. We are building it regardless
because the ledger design makes it nearly free, roughly half a day. The question is
whether it should appear in the navigation for everyone or be hidden behind a manager
permission, and whether a transfer needs the receiving outlet to confirm receipt or is
recorded once by the sender.

Default behaviour: recorded once by the sender, visible to both outlets, no receipt
confirmation step. Adding confirmation is a second state and roughly half a day more.

**Q6. What are the reorder levels per item?**

Default: null for every item, meaning no low stock alert until someone sets one.

Why we are asking. This is open question 3 in the SRS. The low stock alert is one of the
features the client explicitly wanted, and it does nothing at all until these numbers
exist. A system that never alerts looks broken.

What we need. A number for the twenty or thirty items that actually run out. Not the whole
catalogue. We can set the rest later from consumption data once there are a few weeks of
it.

Practical suggestion: give us "how many days of stock should trigger a reorder" per item
instead of a raw quantity, and we will compute the level once there is consumption
history. For week 1, a rough quantity is fine and can be edited in the app at any time.

**Q7. Should attendance require a photo or biometric?**

Default: no. Manual punch in and punch out from the web app, with no photo and no device.

Why we are asking. This is open question 5 in the SRS. Hardware, including biometric
devices, is excluded from Phase 1 by the SRS itself, so biometric is out either way. The
live question is whether a punch should capture a selfie to discourage someone punching in
for a colleague.

What it changes. A photo on punch is roughly half a day plus storage cost, and it slows
the most frequently used action in the entire system down by several seconds on a phone in
a kitchen. Our recommendation is no photo in Phase 1. The manager can already edit a punch
with a reason, and every edit is audited, which covers the honest cases. If buddy punching
turns out to be a real problem, add it in Phase 2 with real evidence of the problem.

**Q8. Who exactly holds each role, and what are the permission edge cases?**

Default: the matrix in [chapter 14](14-rbac-and-permissions.md), applied at role level.

Why we are asking. This is open question 1 in the SRS, which asks for a field-level and
action-level permission matrix. We have written a full action-level matrix across nine
roles. Field-level permissions, meaning one role seeing some columns of a record and not
others, are not built, and the only place it matters is salary, which is handled by
restricting the whole resource to HR and the Owner.

What we need. A list of the real people and which role each one gets. Specifically:
whether the same person is both Store Manager and Kitchen Manager at an outlet, whether
the Operations Manager role exists yet or is the owner wearing a second hat, and whether
anyone besides the owner should see the other outlet's data.

Ask us if any cell in the matrix looks wrong. It is a table, and changing a cell in week 1
is a one line change.

## Group 3, answer during week 2

Operational, and none of them block the build.

**Q9. Who owns the Meta Business account for WhatsApp?**

Default: we submit templates using an account the client creates and grants us access to.

Why we are asking. Message templates need approval from Meta, and approval takes days that
we do not control. Submitting in week 1 rather than week 3 is the single most useful
scheduling decision available on this project. We need account access before we can
submit.

Also worth deciding now: WhatsApp charges per conversation, the cost is usage-based and
sits outside the fixed infrastructure figure, and the SRS already places that cost with
the client. We will give a volume estimate with the arithmetic shown, so the first invoice
is not a surprise.

**Q10. What is the support arrangement after go-live?**

Default: a two week hypercare window with a weekday response window, then no ongoing
support unless separately agreed.

Why we are asking. The SRS covers development, deployment and UAT, and is silent on what
happens in week four. At this price there is no round-the-clock rotation, and a clear
weekday window is worth more to the client than an implied promise nobody can keep.

What we need. Agreement on the window and on who at Bob's Momo is the single point of
contact for issues, because five people reporting the same thing through three channels is
how small problems become long ones.

**Q11. Who maintains master data after handover?**

Default: the client, through the admin screens.

Why we are asking. New items, new vendors, new staff and changed reorder levels are
ongoing work, not one-time setup. If nobody at Bob's Momo owns it, the item list goes
stale in a month and the reports quietly stop matching reality.

What we need. A named person, and thirty minutes of their time during the training session
specifically on the admin screens.

**Q12. Are there existing item, vendor or employee lists in Excel we can import?**

Default: we send blank CSV templates and the client fills them in.

Why we are asking. If a spreadsheet already exists in any shape, we would rather transform
it than ask someone to retype it. The importer validates and reports bad rows by line
number, so a messy sheet is fine.

What we need. Whatever exists, in whatever state, as early as possible. A partial list on
day two is more useful than a complete list on day ten.

## The written record

Answers to Group 1 should come back in writing, not in a call, because two of them change
the contract. Groups 2 and 3 can be confirmed in a call as long as someone writes them
into [chapter 04](04-decisions-register.md) the same day.

Anything that changes after it has been answered goes through the scope-change protocol in
[chapter 03](03-phase-1-scope.md). That is not bureaucracy on a three week project, it is
the only thing that keeps the last week from disappearing.
