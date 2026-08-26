# Screen inventory and route map

This chapter is the build checklist for the frontend. Every route the system
needs is listed once, with who can reach it, which endpoints it calls and what
the user came to do. The twelve screens that carry the most traffic get a full
spec. The last table maps every screen back to a functional requirement so
nothing in the contract is unbuilt and nothing built is uncontracted.

## Two shells, chosen by role

```text
                        role of the signed-in user
                                  │
            ┌─────────────────────┴────────────────────┐
            │                                          │
   KITCHEN_STAFF, COUNTER_CASHIER              everyone else
            │                                          │
            ▼                                          ▼
  ┌──────────────────────┐              ┌────────────────────────────┐
  │  StaffShell          │              │  ManagerShell              │
  │  bottom nav, 5 tabs  │              │  mobile: bottom nav 5 tabs │
  │  no outlet switcher  │              │  desktop: left sidebar     │
  │  (single outlet)     │              │  outlet switcher in header │
  └──────────────────────┘              └────────────────────────────┘

  StaffShell bottom nav (mobile, always)
  ┌────────┬────────┬──────────┬────────┬────────┐
  │  Home  │ Tasks  │Attendance│  Chat  │  More  │
  └────────┴────────┴──────────┴────────┴────────┘
     /      /tasks   /attendance  /chat   sheet

  ManagerShell sidebar (>= 1024px)
  ┌──────────────────┐
  │ Dashboard        │  /
  │ Inventory        │  /inventory
  │ Purchase         │  /purchase/requests
  │ Workforce        │  /employees
  │ Tasks            │  /tasks
  │ Sales            │  /sales
  │ Reports          │  /reports
  │ Chat             │  /chat
  │ Admin            │  /admin/users
  └──────────────────┘

  ManagerShell bottom nav (< 1024px)
  ┌────────┬───────────┬────────┬────────┬────────┐
  │  Home  │ Inventory │ Tasks  │  Team  │  More  │
  └────────┴───────────┴────────┴────────┴────────┘
```

The "More" tab opens a sheet, not a page. It lists every nav destination the
role can reach, plus notifications, notification settings and sign out. The
sheet is the mobile answer to a sidebar: one tap, full list, no nested menus.

Sidebar items are filtered by permission, not hardcoded per role. `Inventory`
renders when the user holds `inventory.transaction.read`. `Admin` renders when
the user holds any `admin.*` key. A role that gains a permission gains the nav
entry with no code change.

## Route table

Role abbreviations: OWN OWNER, OPS OPERATIONS_MANAGER, STM STORE_MANAGER,
KTM KITCHEN_MANAGER, INV INVENTORY_MANAGER, PUR PURCHASE_MANAGER,
HRA HR_ACCOUNTS, KST KITCHEN_STAFF, CCA COUNTER_CASHIER. "All" means every
authenticated role. "SELF" means the route shows only the caller's own rows.

> **Spec note:** the endpoint paths below follow the module names in
> the layout in chapter 08 and the `/api/v1` base in section 7.
> Chapter 15 owns the canonical endpoint list. Where a path here and chapter 15
> disagree, chapter 15 wins.

| Route | Screen | Roles | Endpoints | Primary action |
|---|---|---|---|---|
| `/login` | Sign in | public | `POST /auth/login` | Get into the app |
| `/change-password` | Forced password change | All with `mustReset` | `POST /auth/change-password` | Replace the provisioned password |
| `/` | Home, role variant | All | `GET /auth/me`, variant endpoints below | Start the shift |
| `/tasks` | My tasks / all tasks | All | `GET /tasks`, `GET /outlets` | Find the next job |
| `/tasks/[id]` | Task detail | All (assignee or manager) | `GET /tasks/:id`, `PATCH /tasks/:id/status`, `POST /tasks/:id/comments`, `POST /tasks/:id/attachments` | Complete a task |
| `/tasks/new` | Create task | OWN OPS STM KTM | `POST /tasks`, `GET /employees`, `GET /checklist-templates` | Assign work |
| `/checklists/[templateCode]/run` | Checklist run | KST CCA STM KTM | `GET /checklist-templates/:code`, `POST /tasks/:id/checklist-results`, `PATCH /tasks/:id/status` | Complete opening or closing |
| `/attendance` | My attendance and punch | All | `GET /attendance/me/today`, `POST /attendance/punch`, `POST /attendance/breaks`, `PATCH /attendance/breaks/:id/end` | Punch in, punch out, take a break |
| `/attendance/board` | Live attendance board | OWN OPS STM HRA | `GET /attendance/board` | See who is on the floor now |
| `/attendance/history` | Attendance history | OWN OPS STM HRA, SELF for others | `GET /attendance`, `PATCH /attendance/:dayId/punches/:id` | Review and correct a day |
| `/shifts` | My shifts | All | `GET /shifts/me` | Check when I work next |
| `/shifts/roster` | Roster editor | OWN OPS STM HRA | `GET /shifts`, `POST /shifts`, `PATCH /shifts/:id`, `DELETE /shifts/:id` | Build next week's roster |
| `/leave` | My leave | All | `GET /leave/me` | See leave status and history |
| `/leave/new` | Request leave | All | `POST /leave`, `GET /leave/me/balance` | Ask for days off |
| `/leave/[id]` | Leave detail | Requester, STM OWN OPS HRA | `GET /leave/:id`, `PATCH /leave/:id/cancel` | Read the decision, cancel a pending request |
| `/leave/approvals` | Leave approvals queue | OWN OPS STM HRA | `GET /leave?status=PENDING`, `POST /leave/:id/decision` | Approve or reject |
| `/inventory` | Inventory home | OWN OPS STM KTM INV | `GET /inventory/summary`, `GET /inventory/stock?belowReorder=true` | Jump to the right inventory screen |
| `/inventory/items` | Item master list | OWN OPS INV PUR | `GET /inventory/items`, `GET /inventory/categories` | Find an item |
| `/inventory/items/[id]` | Item detail | OWN OPS INV PUR | `GET /inventory/items/:id`, `GET /inventory/stock?itemId=`, `GET /inventory/transactions?itemId=`, `PATCH /inventory/items/:id` | Edit an item, set reorder level |
| `/inventory/items/new` | Create item | OWN OPS INV | `POST /inventory/items`, `GET /inventory/units`, `GET /inventory/categories` | Add an item to the master |
| `/inventory/stock` | Current stock | OWN OPS STM KTM INV | `GET /inventory/stock`, `GET /inventory/categories` | See what is on hand |
| `/inventory/entry` | Stock entry | OWN OPS INV KTM | `POST /inventory/transactions`, `GET /inventory/items`, `GET /inventory/stock?itemId=` | Record received, issued, wastage, adjustment |
| `/inventory/transfer` | Outlet transfer | OWN OPS INV | `POST /inventory/transfers`, `GET /outlets`, `GET /inventory/stock` | Move stock between outlets |
| `/inventory/closing` | Closing stock count | OWN OPS STM KTM INV | `GET /inventory/stock`, `POST /inventory/transactions` (CLOSING) | Record end-of-day counts |
| `/inventory/history` | Stock ledger | OWN OPS STM KTM INV | `GET /inventory/transactions` | Trace a quantity back |
| `/purchase/requests` | Purchase requests | OWN OPS STM KTM PUR | `GET /purchase/requests` | Track what was asked for |
| `/purchase/requests/new` | New purchase request | OWN OPS STM KTM | `POST /purchase/requests`, `GET /inventory/items` | Ask for stock |
| `/purchase/requests/[id]` | Request detail and decision | OWN OPS PUR, requester read | `GET /purchase/requests/:id`, `POST /purchase/requests/:id/decision` | Approve or reject |
| `/purchase/records` | Purchase records | OWN OPS PUR INV | `GET /purchases` | Find a past purchase |
| `/purchase/records/new` | Record a purchase | OWN OPS PUR | `POST /purchases`, `GET /vendors`, `GET /inventory/items` | Enter the vendor bill |
| `/purchase/records/[id]` | Purchase detail | OWN OPS PUR INV | `GET /purchases/:id`, `POST /purchases/:id/void` | Read or void a purchase |
| `/purchase/price-trends` | Price trends | OWN OPS PUR | `GET /purchase/price-history` | See how a price moved |
| `/vendors` | Vendor list | OWN OPS PUR | `GET /vendors` | Find a vendor |
| `/vendors/[id]` | Vendor detail | OWN OPS PUR | `GET /vendors/:id`, `PATCH /vendors/:id`, `GET /purchases?vendorId=` | Edit vendor, see supply history |
| `/vendors/new` | Create vendor | OWN OPS PUR | `POST /vendors` | Add a supplier |
| `/employees` | Employee list | OWN OPS STM HRA | `GET /employees` | Find a person |
| `/employees/[id]` | Employee profile | OWN OPS STM HRA | `GET /employees/:id`, `PATCH /employees/:id`, `GET /analytics/performance?employeeId=` | Read and edit a profile |
| `/employees/new` | Create employee | OWN OPS HRA | `POST /employees`, `GET /outlets`, `GET /departments` | Onboard a person |
| `/employees/[id]/salary` | Salary records | OWN HRA | `GET /employees/:id/salary`, `POST /employees/:id/salary` | Store the salary structure |
| `/sales` | Sales list | OWN OPS STM CCA | `GET /sales` | See recent days |
| `/sales/entry` | Daily sales entry | OWN OPS STM CCA | `GET /sales?businessDate=`, `POST /sales`, `PATCH /sales/:id` | Close the day's takings |
| `/reports` | Report index | OWN OPS STM HRA PUR INV | none | Pick a report |
| `/reports/sales` | Sales report | OWN OPS STM | `GET /analytics/sales` | Compare days and outlets |
| `/reports/consumption` | Consumption report | OWN OPS INV KTM | `GET /analytics/consumption` | See what got used |
| `/reports/wastage` | Wastage report | OWN OPS INV KTM STM | `GET /analytics/wastage` | Find where stock is lost |
| `/reports/performance` | Employee performance | OWN OPS STM HRA | `GET /analytics/performance` | Compare task and attendance records |
| `/reports/price-history` | Price history report | OWN OPS PUR | `GET /purchase/price-history` | Export price movement |
| `/chat` | Conversation list | All | `GET /messages/conversations` | Find a thread |
| `/chat/[conversationId]` | Conversation | All (members) | `GET /messages`, `POST /messages`, `POST /messages/read` | Send a message |
| `/broadcast` | Compose broadcast | OWN OPS STM KTM | `POST /messages` (scope OUTLET, DEPARTMENT, ALL) | Tell everyone something |
| `/notifications` | Notification inbox | All | `GET /notifications`, `POST /notifications/:id/read` | Catch up on alerts |
| `/settings/notifications` | Notification preferences | All | `GET /notifications/preferences`, `PUT /notifications/preferences` | Turn a channel off |
| `/admin/users` | User accounts | OWN OPS | `GET /users`, `PATCH /users/:id`, `POST /users/:id/reset-password` | Manage logins |
| `/admin/users/new` | Create user | OWN OPS | `POST /users`, `GET /employees`, `GET /outlets` | Provision an account |
| `/admin/outlets` | Outlets and departments | OWN | `GET /outlets`, `POST /outlets`, `POST /outlets/:id/departments` | Maintain org data |
| `/admin/checklist-templates` | Checklist templates | OWN OPS | `GET /checklist-templates`, `POST /checklist-templates`, `PATCH /checklist-templates/:id` | Edit the opening checklist |
| `/admin/recurrences` | Task recurrences | OWN OPS | `GET /task-recurrences`, `POST /task-recurrences`, `PATCH /task-recurrences/:id` | Schedule a daily checklist |
| `/admin/audit-log` | Audit log | OWN | `GET /audit-log` | Answer "who changed this" |
| `/admin/game` | Game configuration | OWN OPS | `GET /crm/games`, `PATCH /crm/games/:id`, `POST /crm/games/:id/publish` | Publish game rules |
| `/game/[slug]` | Customer game | public | `GET /public/games/:slug`, `POST /public/games/:slug/plays` | Play and earn coins |
| `/rewards` | Rewards and redemption | public | `GET /public/rewards`, `POST /public/rewards/redeem` | Turn coins into a coupon |

Home has four variants behind one route. The page reads `roleKey` from the
session and renders one of `StaffHome`, `KitchenManagerHome`, `StoreManagerHome`
or `OwnerHome`. HR_ACCOUNTS gets `StoreManagerHome` with the workforce tiles
promoted and the inventory tiles removed. This keeps the URL stable so a deep
link in a WhatsApp notification always resolves.

## Twelve screen specs

### 1. Staff home

The first screen a kitchen or counter worker sees. It answers three questions
without a tap: am I punched in, what do I owe right now, and has anyone told me
something. Used by KITCHEN_STAFF and COUNTER_CASHIER.

```text
┌────────────────────────────────────┐
│ Bob's Momo            Saheed Nagar │
│ Good morning, Rakesh               │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │  Not punched in                │ │
│ │  Shift 09:00 - 18:00           │ │
│ │  ┌──────────────────────────┐  │ │
│ │  │       Punch in           │  │ │
│ │  └──────────────────────────┘  │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ Due today                        3 │
│ ┌────────────────────────────────┐ │
│ │ ! Kitchen opening checklist    │ │
│ │   Due 09:30        URGENT      │ │
│ ├────────────────────────────────┤ │
│ │   Clean the steamer trays      │ │
│ │   Due 14:00        NORMAL      │ │
│ ├────────────────────────────────┤ │
│ │   Restock sauce station        │ │
│ │   Due 17:00        NORMAL      │ │
│ └────────────────────────────────┘ │
│                    See all tasks > │
├────────────────────────────────────┤
│ Messages                         2 │
│ ┌────────────────────────────────┐ │
│ │ Sunita: Momo sheets are in the │ │
│ │ lower fridge today             │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│  Home  Tasks  Attend  Chat   More  │
└────────────────────────────────────┘
```

At desktop width the three cards sit in a single 720 px column, centred. There
is no three-across grid, because a staff member on a laptop is rare and a
familiar layout beats a denser one.

Data: `GET /auth/me` (cached at session level), `GET /attendance/me/today`,
`GET /shifts/me?date=today`, `GET /tasks?assigneeId=me&status=OPEN,IN_PROGRESS&
dueBefore=endOfBusinessDay&pageSize=3`, `GET /notifications?unread=true&
pageSize=3`.

Interactive elements: the punch button posts to `/attendance/punch` with an
idempotency key and flips to "Punch out" on success. Each task row navigates to
`/tasks/[id]`. "See all tasks" navigates to `/tasks`. A message card navigates
to `/chat/[conversationId]`. The outlet name in the header is text, not a
control, because staff belong to one outlet.

Validation: none, this screen has no form.

Empty states: no tasks due renders "Nothing due right now" with a "See all
tasks" link. No unread messages hides the messages block entirely rather than
showing an empty card.

Error states: if the attendance query fails, the punch card shows an inline
"Could not load your attendance" with a retry link and the rest of the page
still renders. Each block owns its own error, so one failing query never blanks
the screen.

Loading: the punch card renders a fixed-height skeleton, the task list renders
three skeleton rows, and the messages block renders nothing until it resolves.

### 2. Task detail

Where a task is actually completed. Used by every role; the assignee sees action
buttons, a manager sees the same page plus verify controls.

```text
┌────────────────────────────────────┐
│ <  Task                        ... │
├────────────────────────────────────┤
│ Clean the steamer trays            │
│ [ IN PROGRESS ]  [ NORMAL ]        │
│ Due today 14:00                    │
│ Assigned to Rakesh Behera          │
│ Kitchen, Saheed Nagar              │
├────────────────────────────────────┤
│ Description                        │
│ Pull all four trays, soak in hot   │
│ water and soda for 10 minutes,     │
│ scrub, dry before racking.         │
├────────────────────────────────────┤
│ Photo proof (optional)             │
│ ┌──────────┐ ┌──────────┐          │
│ │ [photo]  │ │    +     │          │
│ └──────────┘ └──────────┘          │
├────────────────────────────────────┤
│ Comments                         2 │
│ Sunita 11:04                       │
│ Use the new brush, old one is out. │
│ ┌────────────────────────────────┐ │
│ │ Write a comment...             │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │        Mark complete           │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

The action bar is sticky at the bottom above the nav. On desktop the page splits
into a 2:1 grid, detail left, comments right, with the action button in the
header.

Data: `GET /tasks/:id` (task, template if any, attachments, assignee),
`GET /tasks/:id/comments`.

Interactive elements: "Start" appears when status is `OPEN` and sets
`IN_PROGRESS`. "Mark complete" sets `COMPLETED` and is disabled until every
required photo is uploaded. The `+` tile opens the camera through
`<input type="file" accept="image/*" capture="environment">`. The overflow menu
holds "Reassign" and "Cancel task" for managers. When
`requiresVerification` is true and status is `COMPLETED`, a manager with
`task.task.verify` sees "Verify" and "Send back".

Validation: a comment body is 1 to 1000 characters. Completing a task whose
template item sets `requiresPhoto` is blocked client side with the message
"Add a photo before completing" and blocked server side with
`PHOTO_REQUIRED`. A cancel requires a reason of at least 5 characters.

Empty state: no comments renders the composer alone with placeholder text. No
attachments renders only the `+` tile.

Error states: a status change that hits `409 TASK_ALREADY_COMPLETED` refetches
the task and shows "This task was already completed by Sunita at 13:52". A
failed photo upload leaves the tile in an error style with a "Retry" affordance
and does not block the other photos.

Loading: header, badges and description render as skeletons; the action bar is
present but disabled.

### 3. Checklist run

The opening and closing checklist, the screen that replaces a WhatsApp message
saying "kitchen open done". Used by KITCHEN_STAFF, COUNTER_CASHIER,
STORE_MANAGER and KITCHEN_MANAGER.

```text
┌────────────────────────────────────┐
│ <  Kitchen opening        4 of 11  │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░ │
├────────────────────────────────────┤
│ 1. Fridge temperature below 5 C    │
│    ( PASS )  ( FAIL )  ( N/A )     │
│    [x] recorded 09:04              │
├────────────────────────────────────┤
│ 2. Gas line and burners checked    │
│    ( PASS )  ( FAIL )  ( N/A )     │
│    [x] recorded 09:05              │
├────────────────────────────────────┤
│ 3. Steamer cleaned and filled      │
│    [ PASS ]  ( FAIL )  ( N/A )     │
│    Photo required                  │
│    ┌──────────┐                    │
│    │    +     │                    │
│    └──────────┘                    │
├────────────────────────────────────┤
│ 4. Floor mopped, mats down         │
│    ( PASS )  [ FAIL ]  ( N/A )     │
│    Note required                   │
│    ┌────────────────────────────┐  │
│    │ Mop head torn, needs new   │  │
│    └────────────────────────────┘  │
│    Will create a follow-up task    │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │   Submit checklist  (7 left)   │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

Each item is a row with three large radio buttons. The three buttons together
fill the row width, so each is roughly 100 px wide and well over the 44 px
minimum. Desktop is the same layout in a 720 px column. No table, no grid.

Data: `GET /tasks/:id` where the task carries `templateId`, and
`GET /checklist-templates/:code` for the item labels, sort order and the
`requiresPhoto`, `requiresNote`, `failCreatesTask` flags.

Interactive elements: tapping PASS, FAIL or N/A immediately posts a single
result to `POST /tasks/:id/checklist-results`. The screen saves per item, not
per submit, because a phone that dies at item 9 of 11 must not lose items 1 to
8. The progress bar and counter update from the mutation result. The submit
button sets the task to `COMPLETED`.

Validation: `requiresNote` items block on an empty note. `requiresPhoto` items
block until an attachment id exists. Submit is disabled until every item has a
result. A FAIL on an item with `failCreatesTask` shows the "Will create a
follow-up task" line so the user is not surprised by a new task appearing.

Empty state: a template with no items shows an ErrorState reading "This
checklist has no items yet" with a link to `/admin/checklist-templates` for
managers and a "Tell your manager" line for staff.

Error states: a failed per-item save reverts that row to unset, shows an inline
"Not saved, tap again" and keeps the note text. A submit that returns
`422 CHECKLIST_INCOMPLETE` scrolls to the first unanswered item.

Loading: the progress bar renders at 0 and six skeleton rows fill the list.

### 4. Attendance punch

One button, one job. Used by every role.

```text
┌────────────────────────────────────┐
│ Attendance             26 Aug 2026 │
├────────────────────────────────────┤
│           09:04 am                 │
│         Punched in                 │
│      Worked 3h 26m today           │
│                                    │
│   ┌─────────────────────────────┐  │
│   │        Punch out            │  │
│   └─────────────────────────────┘  │
│   ┌─────────────────────────────┐  │
│   │        Start break          │  │
│   └─────────────────────────────┘  │
├────────────────────────────────────┤
│ Today                              │
│  IN   09:04 am                     │
│  BRK  11:30 am - 11:52 am   22 min │
│  IN   11:52 am                     │
├────────────────────────────────────┤
│ Shift 09:00 - 18:00                │
│ Late by 4 min                      │
└────────────────────────────────────┘
```

Desktop shows the same card at 480 px with the punch log beside it instead of
below.

Data: `GET /attendance/me/today` returns the `AttendanceDay` with punches,
breaks, `workedMins`, `breakMins`, `lateMins` and the day's `Shift` if one
exists.

Interactive elements: one primary button whose label is "Punch in" or "Punch
out" depending on the last punch direction. A secondary button toggles between
"Start break" and "End break". Both send an `Idempotency-Key`. Both disable
while pending. The clock in the card is the device clock rendered in
Asia/Kolkata and refreshes every 30 seconds; the punch timestamp is the
server's, not the device's.

Validation: nothing to type. The server rejects a second `IN` without an
intervening `OUT` with `409 PUNCH_SEQUENCE_INVALID`, and the client copy for
that code is "You are already punched in. Refresh to see your latest status."

Empty state: no punches yet shows "Not punched in" and hides the worked-time
line.

Error states: a network failure shows a toast and leaves the button enabled so
the user can tap again. Because the idempotency key is unchanged, a retry after
a lost response replays the original punch rather than creating a second one.

Loading: the card renders at fixed height with a skeleton in place of the time
and the status line, and the button disabled.

### 5. Attendance board

The screen that answers "who is on the floor right now" without a WhatsApp
roll call. Used by OWNER, OPERATIONS_MANAGER, STORE_MANAGER and HR_ACCOUNTS.

```text
┌────────────────────────────────────┐
│ Attendance board      Saheed Nagar │
│ 26 Aug 2026            12:41 pm    │
├────────────────────────────────────┤
│  Present 7   Break 2   Absent 1    │
│  Leave 1     Off 2                 │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ Rakesh Behera                  │ │
│ │ Kitchen        [ PRESENT ]     │ │
│ │ In 09:04  ·  3h 37m            │ │
│ ├────────────────────────────────┤ │
│ │ Sunita Sahoo                   │ │
│ │ Counter        [ ON BREAK ]    │ │
│ │ In 08:58  ·  break 12m         │ │
│ ├────────────────────────────────┤ │
│ │ Manoj Das                      │ │
│ │ Kitchen        [ ABSENT ]      │ │
│ │ Shift 09:00 - 18:00            │ │
│ ├────────────────────────────────┤ │
│ │ Priya Nayak                    │ │
│ │ Counter        [ ON LEAVE ]    │ │
│ │ Casual, 25 - 27 Aug            │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

At desktop width this becomes a `DataTable` with columns for name, department,
status, first in, worked, break and a manual-correction action. The summary
pills stay above it.

Data: `GET /attendance/board?outletId=&businessDate=` returns one row per
rostered or present employee with `AttendanceStatus`, `firstInAt`, `workedMins`,
`breakMins`, active break start, and the leave type where status is `ON_LEAVE`.

Interactive elements: the outlet switcher in the header for OWNER and
OPERATIONS_MANAGER. Status filter pills. A row opens
`/attendance/history?employeeId=`. On desktop a manager with the correction
permission gets a row action opening a dialog to edit a punch with a mandatory
reason.

Validation: a punch correction requires `editReason` of at least 5 characters
and a time within the business date.

Empty state: no employees rostered shows "Nobody is rostered at Saheed Nagar
today" with a link to `/shifts/roster`.

Error states: a failed poll leaves the last good data on screen and shows a
small "Last updated 12:39, retrying" line under the header rather than blanking
the board.

Loading: five skeleton rows and skeleton pills. This screen polls every 30
seconds with `refetchOnWindowFocus` on, so a manager who switches back to the
tab sees current data immediately.

### 6. Stock entry

The screen that replaces the paper register. Used by INVENTORY_MANAGER and
KITCHEN_MANAGER most often, OWNER and OPERATIONS_MANAGER occasionally.

```text
┌────────────────────────────────────┐
│ <  Record stock                    │
├────────────────────────────────────┤
│ Outlet                             │
│ ┌────────────────────────────────┐ │
│ │ Saheed Nagar                 v │ │
│ └────────────────────────────────┘ │
│ Transaction type                   │
│ ┌────────────────────────────────┐ │
│ │ Issued to kitchen            v │ │
│ └────────────────────────────────┘ │
│ Item                               │
│ ┌────────────────────────────────┐ │
│ │ chick|                       Q │ │
│ ├────────────────────────────────┤ │
│ │ Chicken mince           KG     │ │
│ │ Chicken sausage         PKT    │ │
│ │ Chicken stock cube      PCS    │ │
│ └────────────────────────────────┘ │
│ On hand: 12.400 KG                 │
│ Quantity                           │
│ ┌──────────────────────────┬─────┐ │
│ │ 5.000                    │ KG  │ │
│ └──────────────────────────┴─────┘ │
│ Reason (required for wastage)      │
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ └────────────────────────────────┘ │
│ Note (optional)                    │
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ After this: 7.400 KG               │
│ ┌────────────────────────────────┐ │
│ │           Record               │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

The bottom bar is sticky. It shows the projected balance and the submit button.
Desktop keeps the same single column at 560 px. There is no multi-line grid
entry on this screen; the multi-line case is `/inventory/closing`.

Data: `GET /inventory/items?isActive=true` cached 5 minutes, and
`GET /inventory/stock?itemId=&outletId=` refetched whenever the item changes so
the "On hand" line is current.

Interactive elements: `OutletSelector` (hidden and fixed when the user has one
outlet), a type select bound to `StockTxnType` minus `TRANSFER_IN` and
`TRANSFER_OUT` which live on the transfer screen, `ItemPicker`,
`QuantityInput` with `inputMode="decimal"`, a reason field that appears and
becomes required for `WASTAGE` and `ADJUSTMENT`, and an optional note.

Validation: quantity is greater than 0, at most 3 decimal places, at most
99999999999.999. Reason is 5 to 200 characters when the type is `WASTAGE` or
`ADJUSTMENT`. An `ISSUED` or `WASTAGE` quantity above `qtyOnHand` is warned
client side ("This is more than the 12.400 KG on hand") but not blocked, because
the ledger is the truth and the server decides. The server returns
`422 INSUFFICIENT_STOCK` with `details[0].field = "quantity"`, and the wrapper
maps it onto the quantity field.

Empty state: no items in the master shows "No items yet" and, for a user with
`inventory.item.create`, a link to `/inventory/items/new`.

Error states: `INSUFFICIENT_STOCK` and `ITEM_NOT_IN_OUTLET` land on fields.
`409 IDEMPOTENT_REPLAY` is not an error; the wrapper treats the replayed 200 as
success. A 500 shows the generic toast with the request id and leaves every
typed value in place.

Loading: the item picker shows a spinner in its dropdown while searching. The
form itself renders immediately with the outlet and type prefilled.

### 7. Current stock list

The at-a-glance answer to "what do we have". Used by OWNER,
OPERATIONS_MANAGER, STORE_MANAGER, KITCHEN_MANAGER and INVENTORY_MANAGER.

```text
┌────────────────────────────────────┐
│ Current stock         Saheed Nagar │
│ ┌────────────────────────────────┐ │
│ │ Search items                 Q │ │
│ └────────────────────────────────┘ │
│ (All) (Low) (Vegetables) (Meat) >  │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ ! Chicken mince                │ │
│ │   2.400 KG   reorder 5.000 KG  │ │
│ ├────────────────────────────────┤ │
│ │   Refined flour                │ │
│ │   48.000 KG  reorder 20.000 KG │ │
│ ├────────────────────────────────┤ │
│ │   Cabbage                      │ │
│ │   11.500 KG  reorder 8.000 KG  │ │
│ ├────────────────────────────────┤ │
│ │   Momo sheets                  │ │
│ │   34 PKT     no reorder level  │ │
│ └────────────────────────────────┘ │
│                                    │
│         Load more (48 of 137)      │
└────────────────────────────────────┘
```

Rows below the reorder level carry a danger-tinted left border and a warning
icon. Colour is never the only signal; the icon and the word "Low" in the
accessible label carry it too. Desktop renders a `DataTable` with sortable
columns and a CSV export button.

Data: `GET /inventory/stock?outletId=&categoryId=&search=&belowReorder=&page=`,
`GET /inventory/categories` cached 5 minutes.

Interactive elements: search with a 300 ms debounce, category filter chips that
scroll horizontally inside their own container, a "Low" toggle that sets
`belowReorder=true`, and a row that opens `/inventory/items/[id]`.

Validation: none.

Empty state: no items match the filters shows "No items match this filter" with
a "Clear filters" button. A genuinely empty master shows the create-item empty
state instead.

Error states: a failed load shows the ErrorState with retry, replacing the list
but keeping the search bar and filters so the user does not lose their query.

Loading: eight skeleton rows at the same height as a real row. Subsequent
filter changes keep the old rows visible at 60 percent opacity rather than
replacing them with skeletons, so the screen does not flash on every keystroke.

### 8. Purchase record entry

Where the vendor's bill becomes data. Used by PURCHASE_MANAGER, OWNER and
OPERATIONS_MANAGER.

```text
┌────────────────────────────────────┐
│ <  Record purchase                 │
├────────────────────────────────────┤
│ Vendor                             │
│ ┌────────────────────────────────┐ │
│ │ Sahoo Vegetables             v │ │
│ └────────────────────────────────┘ │
│ Outlet          Purchase date      │
│ ┌──────────────┐┌────────────────┐ │
│ │Saheed Nagar v││ 26 Aug 2026    │ │
│ └──────────────┘└────────────────┘ │
│ Invoice number (optional)          │
│ ┌────────────────────────────────┐ │
│ │ INV-8842                       │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ Items                              │
│ ┌────────────────────────────────┐ │
│ │ Cabbage                      x │ │
│ │ Qty  12.000 KG                 │ │
│ │ Rate Rs 24.50   Line Rs 294.00 │ │
│ │ Last paid Rs 22.00 on 21 Aug   │ │
│ ├────────────────────────────────┤ │
│ │ Onion                        x │ │
│ │ Qty   8.000 KG                 │ │
│ │ Rate Rs 31.00   Line Rs 248.00 │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │        + Add item              │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ Subtotal            Rs 542.00      │
│ Tax                 Rs   0.00      │
│ Total               Rs 542.00      │
│ ┌────────────────────────────────┐ │
│ │        Save purchase           │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

Desktop turns the item list into a table with inline qty and rate cells and a
running total in a sticky right rail. Mobile keeps the stacked card per line,
because a four-column table at 360 px is unusable with a thumb.

Data: `GET /vendors?isActive=true` cached 5 minutes,
`GET /inventory/items?isActive=true` cached 5 minutes, and
`GET /purchase/price-history?itemId=&vendorId=&limit=1` per line to render the
"Last paid" hint.

Interactive elements: `ItemPicker` inside "Add item", `QuantityInput` and a
money input per line, a per-line remove button, and a tax field that is hidden
behind "Add tax" because most vendor bills here have none.

Validation: at least one line. Quantity greater than 0 with 3 decimals. Unit
price 0 or greater with 2 decimals. `lineTotal` is computed with the decimal
helper from chapter 29, never with `parseFloat`. Purchase date cannot be in the
future and cannot be more than 60 days back. The server recomputes every total
and rejects a mismatch with `422 TOTAL_MISMATCH`.

Empty state: an empty item list shows a single "Add the first item" row rather
than a full empty-state block, because the form around it is not empty.

Error states: `VENDOR_INACTIVE` and `ITEM_INACTIVE` map onto the relevant
control. A duplicate `invoiceNo` for the same vendor returns
`409 DUPLICATE_INVOICE` and shows an inline field error offering a link to the
existing purchase.

Loading: vendor and item selects render disabled with a skeleton label until
their master data resolves. Save shows an inline spinner and disables the whole
form, because this mutation writes a purchase, purchase items, price history
rows and stock transactions in one transaction.

### 9. Leave request

```text
┌────────────────────────────────────┐
│ <  Request leave                   │
├────────────────────────────────────┤
│ Leave type                         │
│ ( Casual ) ( Sick )                │
│ ( Unpaid ) ( Comp off )            │
│ From                To             │
│ ┌──────────────┐ ┌───────────────┐ │
│ │ 02 Sep 2026  │ │ 03 Sep 2026   │ │
│ └──────────────┘ └───────────────┘ │
│ Half day                    ( )    │
│ 2 days                             │
│ Reason                             │
│ ┌────────────────────────────────┐ │
│ │ Family function at home        │ │
│ └────────────────────────────────┘ │
│ 24 / 300                           │
├────────────────────────────────────┤
│ Sunita Sahoo is also on leave      │
│ on 02 Sep.                         │
│ ┌────────────────────────────────┐ │
│ │        Submit request          │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

Used by every role for themselves. Desktop is the same column at 560 px.

Data: `GET /leave/me/balance` for taken counts by type this year, and
`GET /leave/overlap?from=&to=` for the clash warning.

Interactive elements: type chips bound to `LeaveType`, two native date inputs
(`<input type="date">`, which gives the platform picker on Android for free),
a half-day switch that only enables when from and to are the same date, and a
reason textarea.

Validation: `toDate` on or after `fromDate`. `fromDate` not more than 90 days
ahead. Reason 5 to 300 characters. `dayCount` is computed on the client for
display and recomputed by the server. A request overlapping an existing
`PENDING` or `APPROVED` leave is rejected with `409 LEAVE_OVERLAP`.

Empty state: none, this screen is a form.

Error states: `LEAVE_OVERLAP` maps to the from-date field with the copy "You
already have leave on these dates". A 403 (staff trying to file for someone
else) is not reachable through the UI and shows the generic toast.

Loading: the balance line renders as a skeleton and the form is usable
immediately. The clash warning appears when its query resolves and never
blocks submit.

### 10. Leave approvals

Used by STORE_MANAGER, OWNER, OPERATIONS_MANAGER and HR_ACCOUNTS.

```text
┌────────────────────────────────────┐
│ Leave approvals                  4 │
│ (Pending) (Approved) (Rejected)    │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ Manoj Das            [PENDING] │ │
│ │ Sick · 27 Aug - 28 Aug · 2 d   │ │
│ │ "Fever since last night"       │ │
│ │ Coverage: 6 of 8 rostered      │ │
│ │ ┌──────────┐  ┌──────────────┐ │ │
│ │ │  Reject  │  │   Approve    │ │ │
│ │ └──────────┘  └──────────────┘ │ │
│ ├────────────────────────────────┤ │
│ │ Priya Nayak          [PENDING] │ │
│ │ Casual · 02 Sep - 03 Sep · 2 d │ │
│ │ "Family function at home"      │ │
│ │ Coverage: 7 of 8 rostered      │ │
│ │ ┌──────────┐  ┌──────────────┐ │ │
│ │ │  Reject  │  │   Approve    │ │ │
│ │ └──────────┘  └──────────────┘ │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

Desktop renders a table with a row-expand for the reason and the same two
buttons in the last column.

Data: `GET /leave?status=PENDING&outletId=` plus a coverage count derived from
`GET /shifts?date=` for the requested range.

Interactive elements: Approve posts `{ decision: "APPROVED" }` directly.
Reject opens a `ConfirmDialog` with a required decision note, because a
rejection the employee cannot understand generates a conversation the system was
supposed to prevent. Both are single-manager decisions with no second approval
step, per the SRS.

Validation: decision note required on reject, 5 to 300 characters. Optional on
approve.

Empty state: "No leave requests waiting" with a line reading "Approved and
rejected requests are in the other tabs."

Error states: `409 LEAVE_ALREADY_DECIDED` refetches the list and shows "Priya's
request was already approved by Sunita". The row disappears rather than showing
stale buttons.

Loading: three skeleton cards. The list invalidates and refetches on every
decision.

### 11. Daily sales entry

One row per outlet per day, entered by hand because there is no POS API. Used
by COUNTER_CASHIER, STORE_MANAGER, OPERATIONS_MANAGER and OWNER.

```text
┌────────────────────────────────────┐
│ <  Daily sales      26 Aug 2026    │
│    Saheed Nagar                    │
├────────────────────────────────────┤
│ Gross sales                        │
│ ┌────────────────────────────────┐ │
│ │ Rs 48,250.00                   │ │
│ └────────────────────────────────┘ │
│ Discounts                          │
│ ┌────────────────────────────────┐ │
│ │ Rs  1,250.00                   │ │
│ └────────────────────────────────┘ │
│ Net sales           Rs 47,000.00   │
│ Order count                        │
│ ┌────────────────────────────────┐ │
│ │ 312                            │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ Payment split                      │
│ Cash    ┌────────────────────────┐ │
│         │ Rs 18,000.00           │ │
│         └────────────────────────┘ │
│ UPI     ┌────────────────────────┐ │
│         │ Rs 26,500.00           │ │
│         └────────────────────────┘ │
│ Card    ┌────────────────────────┐ │
│         │ Rs  2,500.00           │ │
│         └────────────────────────┘ │
│ Other   ┌────────────────────────┐ │
│         │ Rs      0.00           │ │
│         └────────────────────────┘ │
│ Split total Rs 47,000.00  matches  │
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │          Save                  │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

Desktop puts the totals block and the payment split side by side. The
reconciliation line stays directly above the submit button in both layouts.

Data: `GET /sales?outletId=&businessDate=` to load an existing entry for the
selected date, which turns the screen into an edit.

Interactive elements: a date field defaulting to the current business date
computed by the client helper in chapter 29, four money inputs with
`inputMode="decimal"`, and a save button. When `lockedAt` is set (48 hours after
the business date), every field renders read-only with a line reading "Locked on
28 Aug. Ask the owner to reopen."

Validation: gross greater than 0. Discounts between 0 and gross. Net is derived
and read-only. The four payment amounts must sum to net within 0.01, checked
with the decimal helper, and a mismatch shows "Split is Rs 200.00 short of net
sales" as an inline error above the save button rather than on any one field,
because no single field is wrong. Business date cannot be in the future. Order
count, when present, is a positive integer.

Empty state: no entry for the chosen date renders an empty form. A date with an
entry renders it prefilled with a "Last saved 22:40 by Sunita" line.

Error states: `409 SALES_ENTRY_LOCKED` switches the form to read-only and shows
the lock notice. `409 SALES_ENTRY_EXISTS` (a race between two cashiers)
refetches and shows "Someone saved this day while you were typing" with a
"Reload" button that keeps the typed values in a comparison panel.

Loading: skeleton fields. The screen is one of the few where
`refetchOnWindowFocus` is off, because a refetch mid-typing would blow away
uncommitted input.

### 12. Owner dashboard

The one screen the owner opens on a laptop every morning.

```text
┌──────────────────────────────────────────────────────────────┐
│ Dashboard        All outlets v      26 Aug 2026   Today v    │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────┐┌──────────────┐┌──────────────┐┌──────────┐ │
│ │ Net sales    ││ Orders       ││ Purchases    ││ Wastage  │ │
│ │ Rs 89,400.00 ││ 604          ││ Rs 21,340.00 ││Rs 1,180  │ │
│ │ +8.2% vs avg ││ +3.1%        ││ -4.0%        ││ +22.5%   │ │
│ └──────────────┘└──────────────┘└──────────────┘└──────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Sales, last 14 days                                          │
│  ▁▂▃▅▄▆▇▅▄▆█▇▆▅                                              │
├──────────────────────────────────────────┬───────────────────┤
│ Low stock                              6 │ Attendance        │
│  Chicken mince  2.400 / 5.000 KG         │  Saheed  7/10     │
│  Cabbage       11.500 / 8.000 KG         │  Patia   6/8      │
│  Momo sheets    4 / 20 PKT               │                   │
│                          View inventory >│  Open tasks    14 │
│                                          │  Overdue        3 │
├──────────────────────────────────────────┴───────────────────┤
│ Top wastage this week                        View report >   │
│  Cabbage        4.200 KG    Rs 420.00                        │
│  Chicken mince  1.100 KG    Rs 385.00                        │
│  Momo sheets    9 PKT       Rs 270.00                        │
└──────────────────────────────────────────────────────────────┘
```

On mobile the tiles stack two across, the chart drops to a 7 day range, and the
three panels stack in the order low stock, attendance, wastage.

Data: `GET /analytics/dashboard?outletId=all&from=&to=` returns every tile plus
the sparkline series in one response, cached 2 minutes server side in Redis.
Low stock, attendance and wastage panels come from the same payload, so the
dashboard is one request, not six.

Interactive elements: the outlet switcher including an "All outlets" option
available only to OWNER and OPERATIONS_MANAGER, a date range preset select
(Today, Last 7 days, Last 30 days, This month), and drill-through links: a
wastage row opens `/reports/wastage?itemId=`, a low-stock row opens
`/inventory/items/[id]`, the attendance panel opens `/attendance/board`.

Validation: the range picker is capped at 92 days.

Empty state: a brand new outlet with no data shows every tile at zero with the
line "No sales recorded for this range" under the chart rather than an
apologetic full-screen empty state, because a dashboard that disappears is
worse than a dashboard of zeroes.

Error states: the whole dashboard is one query, so a failure shows one
ErrorState with retry in the content area, with the header and outlet switcher
still usable.

Loading: four tile skeletons, a chart skeleton at fixed height, and three panel
skeletons. Fixed heights everywhere, because this screen loads the most data and
a jumping layout is most visible here.

## Screen to requirement traceability

Every screen maps to at least one FR, or is explicitly marked as covering a
gap in the SRS. The gaps are the ones listed in chapter 03: there is no FR block for sales entry, analytics or the dashboard, and
the CRM and game layer is committed in the timeline but never specified.

| Screen or route | FR coverage |
|---|---|
| `/login` | FR-AUTH-001, FR-AUTH-003 |
| `/change-password` | FR-AUTH-001 |
| Nav filtering, `usePermission`, every guarded route | FR-AUTH-002 |
| `/inventory/entry`, `/inventory/closing`, `/inventory/transfer` | FR-INV-001 |
| `/inventory/stock`, `/inventory/items/[id]` reorder level field | FR-INV-002 |
| `/inventory/history`, `/reports/consumption` | FR-INV-003 |
| `/inventory/items`, `/inventory/items/new` | FR-INV-001 (master data precondition) |
| `/purchase/requests/new`, `/purchase/requests` | FR-PUR-001 |
| `/purchase/requests/[id]` decision | FR-PUR-001 |
| `/purchase/records/new`, `/purchase/records/[id]` | FR-PUR-002 |
| `/purchase/price-trends`, `/reports/price-history` | FR-PUR-003 |
| `/vendors`, `/vendors/[id]`, `/vendors/new` | FR-PUR-002 (vendor precondition) |
| `/employees`, `/employees/[id]`, `/employees/new` | FR-EMP-001 |
| `/attendance`, `/attendance/board`, `/attendance/history` | FR-EMP-002 |
| `/shifts`, `/shifts/roster` | FR-EMP-002 |
| `/leave/new`, `/leave/[id]` | FR-EMP-003 |
| `/leave/approvals` | FR-EMP-003 |
| `/leave` history, `/employees/[id]/salary` | FR-EMP-004 |
| `/tasks/new`, `/admin/recurrences` | FR-TASK-001 |
| `/tasks`, `/tasks/[id]` | FR-TASK-002 |
| `/notifications` overdue entries, `/tasks?status=OVERDUE` | FR-TASK-003 |
| `/checklists/[templateCode]/run`, `/admin/checklist-templates` | FR-TASK-004 |
| `/notifications`, `/settings/notifications` | FR-NOTIF-001 |
| `/chat`, `/chat/[conversationId]`, `/broadcast` | FR-NOTIF-002 |
| `/sales`, `/sales/entry` | No FR. Gap 4 in chapter 03. Committed by the module list, the week 3 plan and decision 8 in chapter 04. |
| `/`, `/reports`, `/reports/sales`, `/reports/consumption`, `/reports/wastage`, `/reports/performance` | No FR. Gap 4 in chapter 03. Committed by SRS section 6.4 and the traceability matrix. |
| `/admin/game`, `/game/[slug]`, `/rewards` | No FR. Gap 2 in chapter 03. FR-CRM-001 is cited by open question 7 but does not exist in the SRS. Chapter 32 reconstructs the scope. |
| `/admin/users`, `/admin/users/new`, `/admin/outlets` | FR-AUTH-001 precondition ("user account provisioned by admin"), FR-EMP-001 |
| `/admin/audit-log` | Non-functional: auditability row in SRS section 16 |

Two routes exist with no requirement behind them at all: `/reports` (an index,
pure navigation) and `/notifications` settings beyond the FR-NOTIF-001 dispatch
rules. Neither is a scope risk. Everything else either cites an FR or names the
gap it fills.
