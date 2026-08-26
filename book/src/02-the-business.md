# The business and the problem

Bob's Momo sells momo, thukpa, laphing, spring rolls and Pan-Asian plates from two quick
service outlets in Bhubaneswar, Odisha. The two outlets carry the codes `BM-SAHEED` and
`BM-PATIA` in the system. Between them they employ roughly 20 to 30 people. Nobody in the
business has a title like "systems administrator". The owner does the books, the store
managers run the floor, and everything that is not cooking currently happens on paper,
in Excel, or in WhatsApp.

That last part is the problem, and it is worth being precise about why. WhatsApp is not a
bad tool. It is a very good tool for a business with two outlets and thirty staff, which
is exactly why it has survived this long. It fails at one specific thing: it is not
queryable. A message saying "chicken mince 4 kg left" is perfect at 15:00 on the day it is
sent and worthless on the last day of the month when the owner wants to know what a kilo
of chicken cost across nine deliveries.

## The shape of the staff

Nine roles exist in the system. They map onto real people, and in a business this size one
person often holds two of them.

| Role key | Who this is in practice | Sees |
|---|---|---|
| `OWNER` | The proprietor | Everything, both outlets, including money |
| `OPERATIONS_MANAGER` | Runs both outlets day to day | Both outlets, operations and workforce |
| `STORE_MANAGER` | One per outlet, runs the floor | One outlet, everything operational in it |
| `KITCHEN_MANAGER` | Senior cook, owns the kitchen | Kitchen operations, stock issue and consumption |
| `INVENTORY_MANAGER` | Owns the store room and counts | Items, stock transactions, low stock alerts |
| `PURCHASE_MANAGER` | Deals with vendors and prices | Vendors, purchase requests, purchases, price history |
| `HR_ACCOUNTS` | Attendance, leave, salary records | Employee profiles, attendance, leave, salary |
| `KITCHEN_STAFF` | Cooks and preppers | Own tasks, own checklists, own attendance and breaks |
| `COUNTER_CASHIER` | Front counter | Sales entry, own tasks, own attendance |

Each outlet is divided into departments: Kitchen, Counter, Store and Admin. Departments
matter because tasks and broadcasts are addressed to them.

Most of these people will use the system on a personal Android phone, on a mobile browser,
standing up, with flour on their hands, in a kitchen with poor signal. That constraint
drives more frontend decisions than anything else in this book.

## A trading day at one outlet

The system exists to serve this timeline. Every row on the right is a module in this book.

```text
 TIME    WHAT HAPPENS ON THE FLOOR              MODULE THAT SERVES IT
 ─────   ──────────────────────────────────     ─────────────────────────
 06:45   Store manager unlocks, lights on       Attendance punch
 07:00   Opening checklist run, 14 items        Task engine, CHECKLIST_RUN
         (gas, fridge temp, hygiene, stock
         board, till float)
 07:15   Kitchen staff arrive and punch in      Attendance, AttendanceDay
 07:30   Store room count, item by item         Inventory, OPENING txns
 08:00   Vegetable and chicken van arrives      Purchase recorded, RECEIVED
         Weighed, priced, invoice noted         txns, ItemPriceHistory row
 08:30   Store issues stock to the kitchen      Inventory, ISSUED txns
 09:00   Prep: filling, wrappers, sauces        Tasks assigned to Kitchen
 11:00   Counter opens, first orders            (no POS in Phase 1)
 12:00   Lunch peak, 2 hours                    Nothing is entered, on purpose
 14:00   Lull, staggered breaks                 BreakLog start and end
 15:00   Mince crosses its reorder level        LOW_STOCK fires to Inventory
                                                and Store Manager
 15:20   Store manager raises a request         PurchaseRequest, PENDING
 15:35   Purchase manager approves on phone     PURCHASE_DECIDED, APPROVED
 17:00   Shift change, evening staff punch in   Shift roster, attendance
 18:00   Evening peak, 3 hours                  Nothing is entered, on purpose
 20:30   Two trays of dumplings dropped         WASTAGE txn with a reason
 22:30   Counter closes, cash counted           DailySalesEntry drafted
 22:45   Closing stock count                    Inventory, CLOSING txns
 23:00   Closing checklist run, 11 items        Task engine, CHECKLIST_RUN
         One item fails: freezer seal           AUDIT_ITEM_FAILED, follow-up
                                                task created automatically
 23:15   Sales figure entered and saved         DailySalesEntry, locked +48h
 23:30   Cutoff: if no sales entry exists       SALES_ENTRY_MISSING to the
         the system chases the manager          Store Manager
 ─────   ──────────────────────────────────     ─────────────────────────
 00:30   Late closing checklist submitted       Still counts as the previous
         after a busy Saturday                  business day, see chapter 12
```

Two things in that timeline are design constraints rather than features.

The first is the two peaks, 12:00 to 14:00 and 18:00 to 21:00. During those five hours
nobody enters anything. Any workflow that requires data entry during peak will not be
used, and the system will quietly become wrong. Every write in Phase 1 is designed to
happen in the calm hours at either end of the day.

The second is the 00:30 line. A closing checklist finished after midnight belongs to the
day that just ended, not the one that just started. That is the reason the business day
boundary is 04:00 IST and not midnight.

## Where the current method actually costs money

The SRS lists the AS-IS position. The third column below is what each row costs in
practice, which is the part that justifies the build.

| Area | Current method | What it actually costs |
|---|---|---|
| Inventory | Paper registers | No opening, issued, restocked or closing trail. A register page torn or soaked in the store room takes a week of counts with it. Nobody can answer "how much mince did we consume last week" without adding up by hand. |
| Sales reporting | WhatsApp messages | The daily figure lives in a chat thread. Month end means scrolling. No per-outlet comparison, no payment split between cash and UPI, no way to reconcile against purchases. |
| Duty roster | WhatsApp messages | The roster is a forwarded image. Staff argue about which version is current. A no-show is discovered when the shift starts, not the night before. |
| Kitchen open and close | WhatsApp messages | "Done bhai" is the entire audit trail. Nobody can prove the fridge temperature was checked on the day a batch went bad. |
| Stock updates | WhatsApp messages | Stock status is spread across three chats. The store manager walks to the store room to answer a question the owner asked from home. |
| Purchase pricing | Manual or verbal | The vendor quotes a price on the phone, it is remembered, not recorded. Nobody can see that chicken moved from Rs 210 to Rs 265 a kilo across five weeks until the margin has already gone. |
| Attendance, leave, break | Manual or WhatsApp | The manager asks the kitchen who is in. Late arrivals are forgiven because nothing records them. Leave is approved verbally and disputed at salary time. |
| Salary and leave history | Manual records | A leave balance argument has no evidence on either side. Salary structure lives in one notebook held by one person. |
| Task assignment and audits | Manual or verbal | Assignment and completion are the same event: someone was told, and someone said yes. No overdue signal, so a missed deep clean surfaces only when it is visible. |
| Internal communication | WhatsApp only | Announcements scroll away. New staff have no history. Nothing is addressable to "Kitchen at Patia" specifically. |
| Customer engagement | Website games, isolated | Scores, coins and rewards sit in a system management cannot see. A coupon is honoured at the counter with no record that it was ever issued. |

Read down the third column and one pattern repeats: the information exists, it is just not
addressable. Somebody always knows. Getting it out requires a phone call to that person.
The build replaces the phone call with a query.

## What the system does instead

The SRS organises the TO-BE system into five pillars. Note that the SRS executive summary
names five (Operations, Workforce, Customer Experience, Management Analytics, Internal
Communication) but the pillar list in the TO-BE section only enumerates four, dropping
Customer Experience. That omission is one of the documented gaps and is covered in
[chapter 03](03-phase-1-scope.md).

| Pillar | Contents | Chapters |
|---|---|---|
| Operations management | Inventory, purchase, vendors, kitchen operations, tasks, SOPs, checklists, audits | 16, 17, 20 |
| Workforce management | Employees, attendance, shifts, breaks, leave, salary records, performance visibility, RBAC | 14, 18, 19 |
| Customer experience | Customers, website game configuration, coins, rewards, coupon redemption | 32 |
| Management and analytics | Dashboards, daily sales, inventory consumption, employee performance, reward trends, P and L, waste analysis | 30, 31 |
| Internal communication | Chat, alerts, broadcasts, task and operational notifications, WhatsApp delivery | 21 to 25 |

## The workflow philosophy

Every module in this book follows the same loop. It comes from the SRS and it is the
single design rule that survives contact with all five pillars.

```text
   ┌──────────────┐
   │ USER ACTION  │  a human does one thing: counts, issues, punches,
   └──────┬───────┘  submits, approves
          │
          ▼
   ┌──────────────┐  a row is written. append-only where it is a fact
   │ SYSTEM       │  about the past: StockTransaction, AttendancePunch,
   │ RECORDS      │  AuditLog, OutboxEvent
   │ EVENT        │
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐  the service applies the rule: recompute qtyOnHand,
   │ BUSINESS     │  compare against reorderLevel, check the state
   │ RULE         │  machine, reject if it does not hold
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐  the system does the next step by itself: create the
   │ AUTOMATION   │  follow-up task, roll up the attendance day, generate
   └──────┬───────┘  tomorrow's recurring checklist
          │
          ▼
   ┌──────────────┐  only if a human genuinely needs to know or decide.
   │ NOTIFICATION │  leave approval yes. purchase approval yes.
   │ IF REQUIRED  │  "task completed successfully" no.
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐  the dashboard and reports read what was written.
   │ MANAGEMENT   │  no separate reporting entry, ever.
   │ VISIBILITY   │
   └──────────────┘
```

The test for whether a notification belongs in the system: would the recipient have to
make a decision or take an action on receiving it? If the honest answer is "they would
glance at it and carry on", it is not a notification, it is a dashboard row. A QSR with
thirty staff will mute an app that pings for routine completion, and once it is muted the
approval notifications stop working too.

The same logic keeps approval chains out. The SRS explicitly excludes multi-level approval
beyond a single manager decision. Purchase requests take one decision. Leave takes one
decision. Routine task completion takes none.

## The three outcomes the owner is buying

Strip away the module list and the owner wants three things. Every design argument in this
book should be settled by asking which of these it serves.

Know stock without walking to the store room. `ItemStock.qtyOnHand` per item per outlet,
kept correct by an append-only ledger, readable from a phone at home. If the number on the
screen is not trusted, the store manager walks to the store room anyway and the project
has failed regardless of what else works.

Know who is working without asking. `AttendanceDay` plus `AttendancePunch` plus `Shift`
gives a live answer to "who is in, who is on break, who is on leave" for either outlet.
This is the one feature that gets used every single day by every single manager.

Know what a kilo of chicken cost last Tuesday. `ItemPriceHistory`, one row per item per
vendor per purchase, is the whole answer. It is a small table and it carries most of the
commercial value in the build, because it is the only place the business can see its input
costs move before the margin does.
