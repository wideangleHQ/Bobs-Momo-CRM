# Employees, attendance and shifts

At 11:40 on a Tuesday the owner wants to know who is on the floor at Patia.
Today that means opening WhatsApp, scrolling the outlet group past a photo of a
delivery challan and two voice notes, and finding the message where the store
manager typed out the morning shift at 06:30. If a cook went home sick at 10:00,
that message is still wrong and nobody edited it. WhatsApp has no concept of a
correction.

This chapter replaces that message with a table that is correct at the moment it
is read. It covers the employee master record, the attendance ledger, the shift
roster, and the nightly job that closes the day.

Requirements implemented: FR-EMP-001 (employee profile management) and
FR-EMP-002 (attendance, shift and break logging).

> **Spec note:** this chapter introduces the permission keys
> `workforce.employee.read`, `workforce.employee.write`,
> `workforce.attendance.punch`, `workforce.attendance.read`,
> `workforce.attendance.edit`, `workforce.shift.read` and
> `workforce.shift.write`; the error codes `ALREADY_PUNCHED_IN`,
> `NOT_PUNCHED_IN`, `BREAK_ALREADY_OPEN`, `BREAK_NOT_OPEN`,
> `OVERLAPPING_SHIFT`, `EMPLOYEE_HAS_OPEN_TASKS` and `EMPLOYEE_ALREADY_EXITED`;
> and the value `SYSTEM_ROLLUP` for `AttendancePunch.source`.

## The employee record

`Employee` is the operational identity. Every shift, punch, leave request,
salary row and task assignment points at it. `User` is the login identity and
points at nothing operational except through the employee link.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key, database generated |
| `userId` | uuid, nullable, unique | Login account, if this person has one |
| `employeeCode` | string, unique | `BM-EMP-0007`, server generated |
| `fullName` | string | As the manager would say it out loud |
| `phone` | string | 10 digit Indian mobile, the WhatsApp target |
| `outletId` | uuid | Home outlet, drives every scope check |
| `departmentId` | uuid, nullable | Kitchen, Counter, Store, Admin |
| `designation` | string, nullable | Free text, "Head Cook", not a role |
| `joinedOn` | date | Business date, Asia/Kolkata |
| `exitedOn` | date, nullable | Set only by the exit endpoint |
| `status` | EmploymentStatus | ACTIVE, ON_NOTICE, EXITED |

`designation` and `roleKey` are different things and get confused constantly.
`designation` is a label printed on a roster. `roleKey` lives on `User` and
decides what the API will let this person do. A Head Cook and a Kitchen Helper
can both hold `roleKey = KITCHEN_STAFF`.

### The employeeCode convention

`employeeCode` is `BM-EMP-` plus a four digit zero padded number, drawn from a
Postgres sequence:

```sql
CREATE SEQUENCE employee_code_seq START 1;
-- inside the create transaction
SELECT 'BM-EMP-' || lpad(nextval('employee_code_seq')::text, 4, '0');
```

A sequence, not `MAX(employeeCode) + 1`. Two HR users creating employees at the
same second would collide on the max query and the unique index would reject
one of them. A sequence never collides and never blocks. Gaps appear when a
transaction rolls back. Gaps are fine. The code is an identifier, not a count.

Codes are never reused after an exit. If BM-EMP-0007 leaves and comes back, they
get a new code and a new `Employee` row, because their old attendance and leave
history belongs to the old row and mixing the two makes every historical report
wrong.

### Not every employee has a login

`Employee.userId` is nullable. This is deliberate and it is the field people get
wrong first.

A part-time kitchen helper who works three evenings a week does not need a
username, a password or a phone with the app installed. They exist as an
`Employee` row with `userId = null`. They can be rostered, they appear on the
attendance board, the store manager records their punches through the manager
edit path, and they show up in the monthly attendance report. What they cannot
do is log in.

The consequences of a null `userId` are worth stating in one place because they
surface in three modules:

| Capability | With a User | Without a User |
|---|---|---|
| Log in to the web app | Yes | No |
| Punch in and out personally | Yes | Manager records it |
| Be assigned a task | Yes | Yes |
| Receive TASK_ASSIGNED in app | Yes | Skipped, no recipient |
| Receive TASK_ASSIGNED on WhatsApp | Yes | Skipped |
| Appear on the roster | Yes | Yes |
| Have leave recorded | Yes, self service | Manager files it |

The notification dispatcher resolves a recipient by walking
`Task.assigneeId -> Employee.userId`. When that is null it drops the
notification rather than throwing. The task is still visible on the manager's
board, which is where an unconnected employee's work gets tracked.

The reverse case also exists and is a trap. A `User` with no `Employee` row
cannot create a task, because `Task.createdById` references `Employee`, not
`User`. Every human who touches this system gets an `Employee` row, the owner
included. Seed data creates one for the owner account on day one.

### Outlet and department

`outletId` is required. It is the anchor for every scope check in the workforce
module. A `STORE_MANAGER` scoped to `BM-PATIA` reads and writes employees whose
`outletId` is `BM-PATIA` and gets a 404 for anyone else, not a 403, per the API
conventions in chapter 15.

`departmentId` is nullable and is scoped to the outlet by the composite unique
on `Department(outletId, name)`. Assigning a Patia employee to a Saheed Nagar
department is a validation error, not a foreign key error, because both rows
exist and both ids are valid. The service checks
`department.outletId === employee.outletId` before writing.

Moving an employee between outlets is a `PATCH` of `outletId`, and it does not
rewrite history. Old `AttendanceDay` rows keep the old `outletId` because
attendance happened at the old outlet. The attendance board reads
`AttendanceDay.outletId`, not `Employee.outletId`, for exactly this reason.

### The employment lifecycle

```text
        POST /employees                 PATCH /employees/:id
              │                         { status: "ON_NOTICE" }
              ▼                                   │
        ┌───────────┐                             │
        │  ACTIVE   │─────────────────────────────┘
        └─────┬─────┘                             │
              │                                   ▼
              │  POST /employees/:id/exit   ┌────────────┐
              │  (immediate termination)    │ ON_NOTICE  │
              │                             └─────┬──────┘
              │                                   │
              │                                   │ POST
              ▼                                   │ /employees/:id/exit
        ┌───────────┐                             │
        │  EXITED   │◄────────────────────────────┘
        └───────────┘
         terminal, no path back
```

`ON_NOTICE` disables nothing. The employee still punches, still gets rostered,
still owns tasks. The status is a signal, and the roster grid uses it: when a
manager drags a shift onto an `ON_NOTICE` employee more than 30 days out, the
UI warns. That is the whole feature. Adding operational restrictions to
`ON_NOTICE` would mean a person serving notice cannot do their job for two
weeks, which is not what any restaurant wants.

`EXITED` is terminal and the exit endpoint does five things in one transaction:

1. Sets `status = EXITED` and `exitedOn` to the supplied date.
2. Sets the linked `User.status = DISABLED` and deletes every `RefreshToken`
   in that user's rows, so an open session dies at the next refresh.
3. Sets every `Shift` with `shiftDate > exitedOn` and `status = SCHEDULED` to
   `CANCELLED`.
4. Sets every `PENDING` `LeaveRequest` for that employee to `CANCELLED`.
5. Writes an `AuditLog` row with the before and after employee state.

It refuses, with `EMPLOYEE_HAS_OPEN_TASKS`, when the employee still owns tasks
in `OPEN` or `IN_PROGRESS`, unless the caller supplies `reassignTo`. Silently
orphaning tasks is how work disappears.

## The attendance data model

Three tables, and they have three different jobs.

```text
  ┌──────────────────────────────────────────────────────┐
  │ AttendanceDay        one row per employee per         │
  │                      business date                    │
  │  status  firstInAt  lastOutAt                         │
  │  workedMins  breakMins  lateMins                      │
  │  @@unique([employeeId, businessDate])                 │
  └───────────┬─────────────────────────┬────────────────┘
              │ 1:N                     │ 1:N
              ▼                         ▼
  ┌───────────────────────┐  ┌──────────────────────────┐
  │ AttendancePunch       │  │ BreakLog                 │
  │  direction IN | OUT   │  │  startedAt  endedAt      │
  │  punchedAt            │  │  durationMins            │
  │  source  editedById   │  │  reason                  │
  │  raw, append mostly   │  │  one open row at a time  │
  └───────────────────────┘  └──────────────────────────┘
```

`AttendancePunch` is the truth. `AttendanceDay` is a derived aggregate. Every
number on the day row can be recomputed from the punches, the breaks and the
shift, and the code that does it is a pure function.

The aggregate exists for two reasons.

The first is read cost. The live attendance board asks "who is at Patia right
now", which against the aggregate is a single index scan on
`(outletId, businessDate)` returning about 15 rows. Against raw punches it is a
scan of every punch for every employee for the day, grouped and folded in
application code, and the monthly report across 30 staff for 31 days is 3,700
punch rows folded on every page load. The aggregate turns both into cheap reads,
and it stays cheap when the client opens a third outlet.

The second reason is that some attendance states have no punch to derive them
from. `ON_LEAVE`, `WEEKLY_OFF` and `ABSENT` are the absence of punches. You
cannot store an absence in an append-only punch table. It has to live somewhere,
and the day row is that somewhere.

The rule that keeps the aggregate honest: it is never incremented. Every write
path recomputes the whole row from the full punch set inside the same
transaction. No `workedMins += 30` anywhere in the codebase. That makes the
recompute re-runnable, which is what makes the nightly rollup safe.

## The punch flow

```text
  POST /api/v1/attendance/punch  { "direction": "IN" }
  Idempotency-Key: 7c2f1a90-...
        │
        ▼
  ┌────────────────────────┐  key seen in last 24h?  ──yes──►  replay
  │ IdempotencyInterceptor │                                   stored
  └───────────┬────────────┘                                   200
              │ no
              ▼
  ┌────────────────────────┐  businessDate = toBusinessDate(now)
  │ resolve business date  │  04:00 IST boundary, chapter 12
  └───────────┬────────────┘
              ▼
  ═══════════ BEGIN TRANSACTION ═══════════════════════════
   1. upsert AttendanceDay on (employeeId, businessDate)
   2. SELECT punches ... ORDER BY punchedAt FOR UPDATE
   3. guard  IN after IN   -> ALREADY_PUNCHED_IN  409
             OUT with no IN-> NOT_PUNCHED_IN      409
   4. INSERT AttendancePunch
   5. load open BreakLogs + today's SCHEDULED Shift
   6. recompute(punches, breaks, shift)
        firstInAt lastOutAt workedMins breakMins lateMins status
   7. UPDATE AttendanceDay with the recomputed row
  ═══════════ COMMIT ══════════════════════════════════════
              │
              ▼
   201 { "attendanceDay": {...}, "punch": {...} }
```

The service, with the noise removed:

```ts
async punch(actor: Actor, dto: PunchDto) {
  const employee = await this.repo.resolveEmployee(actor, dto.employeeId);
  const businessDate = toBusinessDate(new Date());   // 04:00 IST rule

  return this.prisma.$transaction(async (tx) => {
    const day = await tx.attendanceDay.upsert({
      where:  { employeeId_businessDate:
                  { employeeId: employee.id, businessDate } },
      create: {
        employeeId: employee.id,
        outletId: employee.outletId,
        businessDate,
        status: 'ABSENT',
      },
      update: {},
    });

    // FOR UPDATE serialises two taps that arrive 80ms apart
    const punches = await tx.$queryRaw<PunchRow[]>`
      SELECT id, direction, "punchedAt"
      FROM "AttendancePunch"
      WHERE "attendanceDayId" = ${day.id}::uuid
      ORDER BY "punchedAt" ASC
      FOR UPDATE`;

    const last = punches.at(-1);
    if (dto.direction === 'IN' && last?.direction === 'IN') {
      throw new ConflictError('ALREADY_PUNCHED_IN',
        `Already punched in at ${fmtIst(last.punchedAt)}.`);
    }
    if (dto.direction === 'OUT' && last?.direction !== 'IN') {
      throw new ConflictError('NOT_PUNCHED_IN',
        'You are not punched in. Punch in before punching out.');
    }

    const punch = await tx.attendancePunch.create({
      data: {
        attendanceDayId: day.id,
        direction: dto.direction,
        punchedAt: dto.at ?? new Date(),
        source: dto.at ? 'MANAGER_EDIT' : 'WEB',
        editedById: dto.at ? actor.userId : null,
        editReason: dto.reason ?? null,
      },
    });
    punches.push(punch);

    const breaks = await tx.breakLog.findMany({
      where: { attendanceDayId: day.id },
    });
    const shift = await tx.shift.findFirst({
      where: { employeeId: employee.id, shiftDate: businessDate,
               status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
    });

    const updated = await tx.attendanceDay.update({
      where: { id: day.id },
      data: recompute(punches, breaks, shift, day.status),
    });

    return { attendanceDay: updated, punch };
  });
}
```

And the pure function everything shares:

```ts
export const HALF_DAY_CUTOFF_MINS = 240;   // config, client tunes in week 1
export const LATE_GRACE_MINS      = 10;

export function recompute(
  punches: PunchRow[],
  breaks: BreakRow[],
  shift: Shift | null,
  currentStatus: AttendanceStatus,
) {
  const firstInAt =
    punches.find(p => p.direction === 'IN')?.punchedAt ?? null;
  const lastOutAt = [...punches].reverse()
                      .find(p => p.direction === 'OUT')?.punchedAt ?? null;

  // only closed IN/OUT pairs count
  let grossMins = 0;
  for (let i = 0; i < punches.length - 1; i++) {
    if (punches[i].direction === 'IN' && punches[i + 1].direction === 'OUT') {
      grossMins += diffMins(punches[i].punchedAt, punches[i + 1].punchedAt);
    }
  }

  const breakMins  = breaks.reduce((s, b) => s + (b.durationMins ?? 0), 0);
  const workedMins = Math.max(0, grossMins - breakMins);

  const lateMins = shift && firstInAt
    ? Math.max(0, diffMins(shift.startsAt, firstInAt) - LATE_GRACE_MINS)
    : 0;

  const status: AttendanceStatus =
      workedMins >= HALF_DAY_CUTOFF_MINS ? 'PRESENT'
    : workedMins > 0                     ? 'HALF_DAY'
    : firstInAt                          ? 'HALF_DAY'
    : currentStatus;   // preserves ABSENT / ON_LEAVE / WEEKLY_OFF

  return { firstInAt, lastOutAt, workedMins, breakMins, lateMins, status };
}
```

Two properties of `recompute` matter downstream. It preserves `currentStatus`
when there are no punches, which is how an `ON_LEAVE` day set by a leave
approval survives a stray write. And `workedMins` counts only closed pairs, so
a person currently on the floor shows `workedMins = 0` until they punch out.
The board does not display that number for a working employee. It displays
elapsed time computed in the browser from `firstInAt`, and it displays
`workedMins` only after `lastOutAt` exists.

### The guards

`ALREADY_PUNCHED_IN` fires when the last punch of the day is `IN` and another
`IN` arrives. `NOT_PUNCHED_IN` fires when an `OUT` arrives with no punches at
all, or with `OUT` as the last punch. Both return 409, because they are state
machine violations rather than bad input.

`Idempotency-Key` is required on this endpoint, not optional. A cook standing in
a kitchen doorway on a 3G connection taps the punch button, sees nothing happen
for two seconds, and taps again. Without the key the second tap becomes a second
`IN` punch and hits `ALREADY_PUNCHED_IN`, which looks like a bug to the user
even though the guard worked. With the key, the interceptor returns the stored
201 from the first tap and the user sees the success they expected. The key is
stored in Redis for 24 hours against the serialised response body, per the API
conventions in chapter 15.

Requests without the header get 400 `IDEMPOTENCY_KEY_REQUIRED`. The web client
generates a UUID v4 per punch attempt and reuses it across retries of that
attempt.

### How lateMins is computed

`lateMins` compares `firstInAt` against the `startsAt` of the employee's
`SCHEDULED` shift for that business date, minus a 10 minute grace:

```text
  shift.startsAt   09:00
  grace            10 min  ──►  free until 09:10
  firstInAt        09:24
  lateMins = (09:24 - 09:00) - 10 = 14
```

If no shift is scheduled for that employee on that date, `lateMins` is zero and
the day is still a valid, fully counted attendance day. Say that out loud
because it is the rule people guess wrong: an unrostered employee who turns up
and works is not late, and is not absent, and their day counts toward
`PRESENT`. Lateness is only meaningful against a commitment, and an empty
roster cell is not a commitment.

If more than one `SCHEDULED` shift exists for the date, the earliest by
`startsAt` is used. Split shifts are rostered as two rows and lateness is judged
against the first.

## Breaks

`BreakLog` hangs off the day, not off a punch. One break may be open at a time.

```text
  POST /attendance/break/start
        │  guard: day has an IN as its last punch  else NOT_PUNCHED_IN
        │  guard: no BreakLog with endedAt = null  else BREAK_ALREADY_OPEN
        ▼
   INSERT BreakLog { startedAt: now, reason }

  POST /attendance/break/end
        │  guard: exactly one open BreakLog        else BREAK_NOT_OPEN
        ▼
   UPDATE BreakLog SET endedAt = now,
          durationMins = diffMins(startedAt, now)
        │
        ▼
   recompute(day)   ──►  breakMins rises, workedMins falls
```

`breakMins` is subtracted from gross worked time inside `recompute`. A shift
from 09:00 to 18:00 with a 45 minute break records `grossMins = 540`,
`breakMins = 45`, `workedMins = 495`.

A break left open at end of day is closed by the nightly rollup at the last
`OUT` punch of that day. If there is no `OUT` punch either, the rollup closes
the break at the synthetic punch-out it creates in the previous step, so the two
repairs compose. A break can never end after the day ends.

Starting a break while not punched in returns `NOT_PUNCHED_IN`. Ending a break
that was never started returns `BREAK_NOT_OPEN`. Both are 409.

## Manager correction

`PATCH /attendance/punches/:id` lets a Store Manager move a punch timestamp. It
requires `workforce.attendance.edit`, requires a non-empty `reason`, sets
`source = MANAGER_EDIT` and `editedById`, recomputes the day, and writes an
`AuditLog` row carrying the before and after punch. All of that in one
transaction. There is no path that edits a punch without an audit row.

Edits are allowed because the alternative is worse. Staff forget to punch out.
They punch in on a colleague's phone. They arrive to find the wifi down and
punch in twenty minutes late. If the system has no correction path, the manager
fixes the record the only way they can, which is a WhatsApp message to the owner
saying "Raju actually left at 6, ignore the system", and now there are two
systems of record again and the one on paper wins. An edit that is attributed,
reasoned and audited is a feature. An unattributed edit is fraud.

The same `workforce.attendance.edit` permission lets a manager create a punch on
behalf of an employee, through the ordinary punch endpoint with `employeeId` and
`at` supplied. That covers a shift where somebody never punched in at all, which
`PATCH` cannot fix because there is no row to patch.

## Shifts and the roster

```prisma
model Shift {
  employeeId String
  outletId   String
  shiftDate  DateTime    @db.Date
  startsAt   DateTime
  endsAt     DateTime
  status     ShiftStatus @default(SCHEDULED)
  @@unique([employeeId, shiftDate, startsAt])
  @@index([outletId, shiftDate])
}
```

`shiftDate` is the business date the shift belongs to. `startsAt` and `endsAt`
are full UTC timestamps, so a shift that runs from 18:00 to 01:30 has an
`endsAt` on the following calendar day while keeping the earlier `shiftDate`.
This is the same reasoning as the 04:00 business day boundary in chapter 12: the
closing shift belongs to the day it opened on.

The unique constraint on `(employeeId, shiftDate, startsAt)` stops exact
duplicates. It does not stop overlaps, so the service checks:

```ts
const clash = await tx.shift.findFirst({
  where: {
    employeeId: dto.employeeId,
    shiftDate:  dto.shiftDate,
    status:     'SCHEDULED',
    id:         { not: dto.excludeId },     // set when editing
    AND: [
      { startsAt: { lt: dto.endsAt } },
      { endsAt:   { gt: dto.startsAt } },
    ],
  },
});
if (clash) throw new ConflictError('OVERLAPPING_SHIFT',
  `${employee.fullName} already has a shift from ${fmtIst(clash.startsAt)} ` +
  `to ${fmtIst(clash.endsAt)} on this date.`);
```

The half-open interval comparison (`start < otherEnd && end > otherStart`) is
the correct overlap test. A shift ending at 14:00 and another starting at 14:00
do not overlap, which is what a manager expects when they split a day.

The roster is a week grid: employees down the left, seven dates across the top,
one cell per employee per date. `POST /shifts/bulk` writes a whole week in one
transaction, which is how a manager actually works. They do not create 105
shifts one at a time. The bulk endpoint validates every row first, then writes
all or nothing, and returns per-row errors with the array index so the UI can
highlight the offending cells.

`ShiftStatus` has three values. `SCHEDULED` is a live roster entry and is the
only status the overlap check and the lateness calculation look at. `CANCELLED`
means the shift will not happen and the row survives for history.
`SWAPPED` means the manager replaced this shift with a different one, usually
because two staff arranged a swap between themselves.

There is no shift swap approval workflow in Phase 1. Staff cannot request a
swap, there is no pending swap state, and there is no counterparty acceptance
step. Two cooks agree a swap in person, tell the manager, and the manager edits
the roster. The `SWAPPED` status records that this is what happened rather than
a cancellation. Building a request-and-accept flow for a two outlet business
where everyone is in the same room is exactly the kind of approval layer the SRS
tells us not to add.

## The nightly attendance rollup

`apps/api/src/jobs/attendance-rollup.job.ts`, cron `45 3 * * *` in
`Asia/Kolkata`.

03:45 is not arbitrary. The business day flips at 04:00, so at 03:45 the current
business date is still yesterday's calendar date. The job asks
`toBusinessDate(now)` and gets exactly the day it is meant to close, with 15
minutes of headroom before the boundary moves. A job at 00:15 would close a day
that is still receiving closing checklists and punch-outs from the late shift.

Ordered steps, all against `targetDate = toBusinessDate(now)`:

1. Close open breaks. For every `BreakLog` with `endedAt IS NULL` on a day with
   `businessDate = targetDate`, set `endedAt` to the day's `lastOutAt`, or the
   scheduled shift `endsAt` if there is no punch-out yet, or `startedAt` if
   neither exists. Compute `durationMins`.
2. Close missing punch-outs. For every `AttendanceDay` whose punch sequence ends
   with an `IN`, insert a synthetic `OUT` at the scheduled shift's `endsAt`, or
   at `firstInAt + 8h` when no shift was scheduled, whichever is earlier than
   the business day end. Set `source = SYSTEM_ROLLUP` and
   `editReason = 'auto-closed by nightly rollup'`, and append a marker to
   `AttendanceDay.note` so the monthly report can flag it.
3. Recompute every day touched by steps 1 and 2.
4. Mark absences. For every `ACTIVE` or `ON_NOTICE` employee with a `SCHEDULED`
   shift on `targetDate` and either no `AttendanceDay` row or a row with
   `firstInAt IS NULL`, upsert the row with `status = ABSENT`.
5. Mark leave. For every employee with an `APPROVED` `LeaveRequest` covering
   `targetDate`, upsert the day with `status = ON_LEAVE`. This runs after step 4
   so leave beats absent.
6. Mark weekly off. For every `ACTIVE` employee with no shift, no punches and no
   approved leave on `targetDate`, upsert the day with `status = WEEKLY_OFF`.

Steps 4 to 6 only write rows where `firstInAt IS NULL`. Somebody who came in on
their day off is `PRESENT` from step 3 and no later step overwrites that.

The job is idempotent. Run it twice and nothing changes. Step 1 finds no open
breaks the second time. Step 2's precondition (the sequence ends with `IN`) is
false after the first run inserted an `OUT`. Step 3 is a pure recompute from
unchanged inputs. Steps 4 to 6 are upserts that write the same value they
already wrote, and all three skip rows with punches. Safe to re-run by hand
after an outage, and the runbook in chapter 36 tells the on-call engineer to do
exactly that:

```bash
bun run job:attendance-rollup --date 2026-08-25
```

## Endpoint reference

All paths are relative to `/api/v1`. All requests carry
`Authorization: Bearer <accessJwt>`. Scope column: `SELF` means the caller may
only act on their own employee record, `OWN_OUTLET` means outlets listed in
`UserOutlet`, `ALL_OUTLETS` means every outlet. See the
[RBAC matrix](14-rbac-and-permissions.md) for which roles hold which key.

### GET /employees

| | |
|---|---|
| Permission | `workforce.employee.read` |
| Scope | OWN_OUTLET, ALL_OUTLETS for OWNER and OPERATIONS_MANAGER |
| Success | 200 |

```ts
export const listEmployeesQuery = z.object({
  outletId:     z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  status:       z.enum(['ACTIVE', 'ON_NOTICE', 'EXITED']).optional(),
  q:            z.string().trim().min(1).max(60).optional(),  // name or code
  page:         z.coerce.number().int().min(1).default(1),
  pageSize:     z.coerce.number().int().min(1).max(100).default(25),
});
```

```json
{
  "data": [
    {
      "id": "8f1c...", "employeeCode": "BM-EMP-0007",
      "fullName": "Raju Behera", "phone": "9438011223",
      "outlet": { "id": "a1...", "code": "BM-PATIA", "name": "Patia" },
      "department": { "id": "d2...", "name": "Kitchen" },
      "designation": "Head Cook", "status": "ACTIVE",
      "joinedOn": "2024-11-04", "hasLogin": true
    }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 31 }
}
```

Rules: `q` matches `fullName` case-insensitively or `employeeCode` exactly.
Default `status` filter is `ACTIVE` plus `ON_NOTICE`; `EXITED` employees are
returned only when asked for explicitly. No salary field appears here or
anywhere in the employee payload, for any role. See chapter 19.

Errors: 400 `VALIDATION_FAILED`, 403 `FORBIDDEN`.

### POST /employees

| | |
|---|---|
| Permission | `workforce.employee.write` |
| Scope | OWN_OUTLET |
| Success | 201 |

```ts
export const createEmployeeBody = z.object({
  fullName:     z.string().trim().min(2).max(80),
  phone:        z.string().regex(/^[6-9]\d{9}$/),
  outletId:     z.string().uuid(),
  departmentId: z.string().uuid().nullish(),
  designation:  z.string().trim().max(60).nullish(),
  joinedOn:     z.string().date(),                 // YYYY-MM-DD, IST
  createLogin:  z.object({
    username: z.string().trim().min(3).max(32).regex(/^[a-z0-9._-]+$/),
    email:    z.string().email().nullish(),
    roleKey:  z.nativeEnum(RoleKey),
  }).nullish(),
});
```

Rules: `employeeCode` is server generated and ignored if supplied. When
`createLogin` is present the service creates the `User` with `mustReset = true`
and a random temporary password returned once in the response body, creates the
`UserOutlet` row for `outletId`, and links it. When absent, `userId` stays null.
`departmentId` must belong to `outletId`. `joinedOn` may not be more than
30 days in the future.

Errors: 400 `VALIDATION_FAILED`, 409 `DUPLICATE_USERNAME`,
422 `DEPARTMENT_OUTLET_MISMATCH`.

### GET /employees/:id

Permission `workforce.employee.read`, scope OWN_OUTLET, 200. Returns the single
object with the same shape as a list row plus `joinedOn`, `exitedOn`,
`user: { username, roleKey, status, lastLoginAt } | null`, and counters for open
tasks and leave taken this financial year. 404 `NOT_FOUND` when the employee
sits outside the caller's outlet scope.

### PATCH /employees/:id

| | |
|---|---|
| Permission | `workforce.employee.write` |
| Scope | OWN_OUTLET |
| Success | 200 |

```ts
export const updateEmployeeBody = createEmployeeBody
  .omit({ createLogin: true, joinedOn: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ON_NOTICE']).optional() });
```

Rules: `status` cannot be set to `EXITED` here. Use the exit endpoint.
`joinedOn` is immutable after creation; a wrong join date is a data fix, not a
user action. Changing `outletId` does not rewrite historical attendance rows.
Every field change writes an `AuditLog` row with before and after.

Errors: 400 `VALIDATION_FAILED`, 404 `NOT_FOUND`,
422 `DEPARTMENT_OUTLET_MISMATCH`, 422 `EMPLOYEE_ALREADY_EXITED`.

### POST /employees/:id/exit

| | |
|---|---|
| Permission | `workforce.employee.write` |
| Scope | OWN_OUTLET |
| Success | 200 |

```ts
export const exitEmployeeBody = z.object({
  exitedOn:   z.string().date(),
  reason:     z.string().trim().min(3).max(200),
  reassignTo: z.string().uuid().nullish(),   // employee id for open tasks
});
```

Response returns the updated employee plus `{ shiftsCancelled: 4,
leaveRequestsCancelled: 1, tasksReassigned: 3 }` so the manager sees the blast
radius.

Errors: 409 `EMPLOYEE_ALREADY_EXITED`, 422 `EMPLOYEE_HAS_OPEN_TASKS` when open
tasks exist and `reassignTo` is null, 404 `NOT_FOUND`.

### POST /attendance/punch

| | |
|---|---|
| Permission | `workforce.attendance.punch`, or `workforce.attendance.edit` when acting for another employee |
| Scope | SELF, or OWN_OUTLET with the edit key |
| Success | 201 |
| Headers | `Idempotency-Key` required |

```ts
export const punchBody = z.object({
  direction:  z.enum(['IN', 'OUT']),
  employeeId: z.string().uuid().optional(),   // manager acting for staff
  at:         z.string().datetime().optional(), // manager backdating
  reason:     z.string().trim().min(3).max(200).optional(),
});
```

```json
{
  "attendanceDay": {
    "id": "3d9e...", "businessDate": "2026-08-26", "status": "PRESENT",
    "firstInAt": "2026-08-26T03:42:00.000Z", "lastOutAt": null,
    "workedMins": 0, "breakMins": 0, "lateMins": 14
  },
  "punch": {
    "id": "7b21...", "direction": "IN",
    "punchedAt": "2026-08-26T03:42:00.000Z", "source": "WEB"
  }
}
```

Rules: `employeeId` and `at` both require `workforce.attendance.edit`; supplying
either without the key is 403. `at` requires `reason`. `at` may not be in the
future and may not be more than 7 days in the past. Business date comes from the
04:00 IST rule and is never supplied by the client.

Errors: 400 `IDEMPOTENCY_KEY_REQUIRED`, 400 `VALIDATION_FAILED`,
403 `FORBIDDEN`, 409 `ALREADY_PUNCHED_IN`, 409 `NOT_PUNCHED_IN`,
422 `EMPLOYEE_NOT_ACTIVE`.

### POST /attendance/break/start

Permission `workforce.attendance.punch`, scope SELF, 201.

```ts
export const breakStartBody = z.object({
  employeeId: z.string().uuid().optional(),
  reason:     z.string().trim().max(120).optional(),
});
```

Errors: 409 `NOT_PUNCHED_IN`, 409 `BREAK_ALREADY_OPEN`.

### POST /attendance/break/end

Permission `workforce.attendance.punch`, scope SELF, 200. Body is the same
optional `employeeId`. Returns the closed `BreakLog` and the recomputed day.

Errors: 409 `BREAK_NOT_OPEN`.

### GET /attendance/today

| | |
|---|---|
| Permission | `workforce.attendance.read` |
| Scope | OWN_OUTLET |
| Success | 200 |

```ts
export const todayQuery = z.object({
  outletId:     z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
```

```json
{
  "businessDate": "2026-08-26",
  "outlet": { "id": "a1...", "code": "BM-PATIA" },
  "summary": { "working": 9, "onBreak": 2, "done": 3,
               "absent": 1, "onLeave": 1 },
  "data": [
    {
      "employeeId": "8f1c...", "fullName": "Raju Behera",
      "designation": "Head Cook", "department": "Kitchen",
      "state": "ON_BREAK", "status": "PRESENT",
      "firstInAt": "2026-08-26T03:42:00.000Z", "lastOutAt": null,
      "openBreakStartedAt": "2026-08-26T08:05:00.000Z",
      "lateMins": 14, "workedMins": 0, "breakMins": 30,
      "shift": { "startsAt": "2026-08-26T03:30:00.000Z",
                 "endsAt": "2026-08-26T12:30:00.000Z" }
    }
  ]
}
```

Rules: returns one row per `ACTIVE` or `ON_NOTICE` employee of the outlet,
including those with no attendance row yet. `state` is derived server-side, not
stored. No pagination: 30 staff fit in one response.

### GET /attendance

Permission `workforce.attendance.read`, scope OWN_OUTLET, 200. Paged history.

```ts
export const attendanceHistoryQuery = z.object({
  outletId:   z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  from:       z.string().date(),
  to:         z.string().date(),
  status:     z.nativeEnum(AttendanceStatus).optional(),
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(25),
}).refine(v => v.from <= v.to, { message: 'from must be on or before to' })
  .refine(v => daysBetween(v.from, v.to) <= 92,
          { message: 'range may not exceed 92 days' });
```

Rules: a `KITCHEN_STAFF` caller holding only the `SELF` scope has `employeeId`
forced to their own id, whatever they send. Ordered by `businessDate` desc then
`fullName`.

Errors: 400 `VALIDATION_FAILED`, 403 `FORBIDDEN`.

### PATCH /attendance/punches/:id

| | |
|---|---|
| Permission | `workforce.attendance.edit` |
| Scope | OWN_OUTLET |
| Success | 200 |

```ts
export const editPunchBody = z.object({
  punchedAt: z.string().datetime(),
  reason:    z.string().trim().min(3).max(200),
});
```

Rules: `reason` is required, not optional. The new `punchedAt` must stay inside
the punch's own business date. Moving a punch may not reorder the IN/OUT
sequence; if it would, the request is rejected with `INVALID_PUNCH_SEQUENCE`.
Writes `source = MANAGER_EDIT`, `editedById`, `editReason`, recomputes the day
and writes an `AuditLog` row, all in one transaction.

Errors: 400 `VALIDATION_FAILED`, 404 `NOT_FOUND`, 422 `INVALID_PUNCH_SEQUENCE`,
422 `PUNCH_DATE_MISMATCH`.

### GET /attendance/summary

Permission `workforce.attendance.read`, scope OWN_OUTLET, 200. Monthly figures
per employee, the report HR pulls on the 1st.

```ts
export const attendanceSummaryQuery = z.object({
  outletId: z.string().uuid().optional(),
  month:    z.string().regex(/^\d{4}-\d{2}$/),    // 2026-08, IST
});
```

```json
{
  "month": "2026-08",
  "data": [
    {
      "employeeId": "8f1c...", "employeeCode": "BM-EMP-0007",
      "fullName": "Raju Behera",
      "present": 22, "halfDay": 2, "absent": 1,
      "onLeave": 3, "weeklyOff": 4,
      "workedHours": 178.5, "breakHours": 12.0,
      "lateDays": 6, "totalLateMins": 94, "autoClosedDays": 2
    }
  ]
}
```

Rules: `workedHours` is `sum(workedMins) / 60` rounded to one decimal.
`autoClosedDays` counts days the rollup had to close, which is the number HR
uses to nag a specific person about punching out.

### GET /shifts

Permission `workforce.shift.read`, scope OWN_OUTLET, 200. Flat list for a date
range, used by the employee's own "my shifts" view.

```ts
export const listShiftsQuery = z.object({
  outletId:   z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  from:       z.string().date(),
  to:         z.string().date(),
  status:     z.nativeEnum(ShiftStatus).optional(),
});
```

### POST /shifts

| | |
|---|---|
| Permission | `workforce.shift.write` |
| Scope | OWN_OUTLET |
| Success | 201 |

```ts
export const createShiftBody = z.object({
  employeeId: z.string().uuid(),
  shiftDate:  z.string().date(),
  startsAt:   z.string().datetime(),
  endsAt:     z.string().datetime(),
  note:       z.string().trim().max(200).nullish(),
}).refine(v => v.endsAt > v.startsAt,
          { message: 'endsAt must follow startsAt' })
  .refine(v => diffMins(v.startsAt, v.endsAt) <= 16 * 60,
          { message: 'shift may not exceed 16 hours' });
```

Rules: `outletId` is taken from the employee, not the body. Overlap check
against `SCHEDULED` shifts for the same employee and date. `shiftDate` may not
be more than 60 days in the future. Employees with `status = EXITED` cannot be
rostered.

Errors: 409 `OVERLAPPING_SHIFT`, 422 `EMPLOYEE_NOT_ACTIVE`,
400 `VALIDATION_FAILED`.

### POST /shifts/bulk

Permission `workforce.shift.write`, scope OWN_OUTLET, 201.

```ts
export const bulkShiftBody = z.object({
  shifts: z.array(createShiftBody).min(1).max(200),
});
```

Rules: all or nothing in a single `$transaction`. Overlaps are checked against
existing rows and against the other rows in the same payload. On failure the
error `details` array carries `{ index, code, message }` per bad row so the grid
can highlight cells.

```json
{
  "error": {
    "code": "OVERLAPPING_SHIFT",
    "message": "3 shifts clash with the existing roster.",
    "details": [
      { "field": "shifts[4]", "issue": "overlaps_existing" },
      { "field": "shifts[9]", "issue": "overlaps_payload_row_7" }
    ],
    "requestId": "01JK8Y3M2QW9V0X4"
  }
}
```

### PATCH /shifts/:id

Permission `workforce.shift.write`, scope OWN_OUTLET, 200. Accepts `startsAt`,
`endsAt`, `note` and `status` (`SCHEDULED`, `SWAPPED`, `CANCELLED`). Re-runs the
overlap check excluding this row. A shift whose `shiftDate` is in the past
cannot change its times, only its status.

Errors: 409 `OVERLAPPING_SHIFT`, 404 `NOT_FOUND`, 422 `SHIFT_DATE_PAST`.

### DELETE /shifts/:id

Permission `workforce.shift.write`, scope OWN_OUTLET, 204. Hard delete, and the
only hard delete in this module. It is permitted only when `shiftDate` is in the
future and no `AttendanceDay` exists for that employee and date. Otherwise the
manager sets `status = CANCELLED` instead. Writes an `AuditLog` row with the
deleted row in `before`.

Errors: 404 `NOT_FOUND`, 422 `SHIFT_HAS_ATTENDANCE`.

### GET /shifts/roster

Permission `workforce.shift.read`, scope OWN_OUTLET, 200. The week grid.

```ts
export const rosterQuery = z.object({
  outletId: z.string().uuid(),
  weekOf:   z.string().date(),    // any date; server snaps to Monday IST
});
```

```json
{
  "outletId": "a1...", "weekStart": "2026-08-24", "weekEnd": "2026-08-30",
  "employees": [
    {
      "employeeId": "8f1c...", "fullName": "Raju Behera",
      "department": "Kitchen", "status": "ACTIVE",
      "days": {
        "2026-08-24": [ { "id": "s1...", "startsAt": "...", "endsAt": "...",
                          "status": "SCHEDULED" } ],
        "2026-08-25": []
      }
    }
  ]
}
```

Rules: every active employee of the outlet appears, including those with an
empty week, because an empty row is how a manager notices they forgot somebody.
Cancelled shifts are included so the grid can grey them.

## The live attendance board

This is the screen that replaces the WhatsApp scroll. A Store Manager opens it
and sees, for their outlet, one row per employee with the current state, when
they arrived, how late they were, and who has not shown up.

Refresh is TanStack Query with `refetchInterval: 30_000` and
`refetchOnWindowFocus: true`, against `GET /attendance/today`.

```ts
useQuery({
  queryKey: ['attendance', 'today', outletId],
  queryFn:  () => api.get('/attendance/today', { params: { outletId } }),
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
  staleTime: 15_000,
});
```

Not websockets. A websocket layer means a connection lifecycle, reconnect
backoff, an auth handshake on an upgrade request, sticky routing if the API ever
runs two Railway replicas, and a second failure mode to debug at 2am. What it
buys is attendance data that is fresh to the second instead of fresh to
30 seconds, for 15 people in a room the manager can see from where they are
standing. One indexed query returning 15 rows every 30 seconds is roughly 2,900
queries per outlet per shift, which is noise against the Supabase Pro connection
budget. The trade is not close.

Four states per row, derived server-side into the `state` field so the browser
never re-implements the rule:

| State | Condition | Colour | Row label |
|---|---|---|---|
| Working | punched in, no open break | Green | "In since 09:12" |
| On break | punched in, open BreakLog | Amber | "On break 14m" |
| Done for the day | last punch is OUT | Slate | "Out 18:04, 7h 52m" |
| Absent | no punches, shift scheduled | Red | "Absent" |

Two more statuses render as informational chips rather than states, because
nobody is waiting on them: `ON_LEAVE` shows a blue "On leave" chip with the
leave type, and `WEEKLY_OFF` shows a neutral "Weekly off" chip. Both sort to the
bottom of the list. Late arrivals carry a small amber "+14m late" badge next to
the working label, so a manager scanning the column sees the pattern without
opening a report.

The summary strip at the top of the board shows the five counts from the
`summary` object. That number, and not the list, is what the owner looks at when
they open the board from their phone.

## Failure modes

| Failure | Symptom | Cause | Handling |
|---|---|---|---|
| Double tap on punch | Two IN punches, or a 409 shown to a user who did nothing wrong | Slow 3G, no client debounce | `Idempotency-Key` replays the first response. Key required, not optional |
| Two managers edit the same punch | Last write wins, one audit row misses | No row lock on the punch | `SELECT ... FOR UPDATE` on the day's punches inside the edit transaction |
| Staff never punch out | `workedMins` stays 0, day looks like a half day | Human forgetfulness, every single day | Rollup step 2 inserts a `SYSTEM_ROLLUP` OUT and flags the day; `autoClosedDays` surfaces the repeat offenders |
| Break left open overnight | `breakMins` grows without bound on the next recompute | End-of-shift rush | Rollup step 1 closes it at `lastOutAt` |
| Rollup job misses a night | A whole day has no ABSENT or WEEKLY_OFF rows | Railway restart, deploy during the window | Job is idempotent and takes a `--date` flag. Runbook re-runs it |
| Clock skew between phone and server | Punch time looks wrong by minutes | Client sent its own timestamp | Server always stamps `punchedAt = new Date()` unless a manager supplied `at` with the edit permission |
| Employee moved outlets mid-month | Monthly report double counts or drops days | Report joined on `Employee.outletId` | Report and board both read `AttendanceDay.outletId`, which is frozen at write time |
| Unrostered employee marked late | Complaint from staff, trust in the system drops | Lateness computed against a missing shift | `lateMins` is 0 with no shift. Covered by a named test |
| Manager backdates a punch to hide lateness | Attendance data quietly wrong | Edit path without accountability | Edit requires a reason, stamps `editedById`, and writes an `AuditLog` row with before and after |

## Test plan

Unit tests on the pure functions, `apps/api/src/modules/attendance/recompute.spec.ts`:

| Test | Assertion |
|---|---|
| `recompute closes a simple IN/OUT pair` | `workedMins === 480` for 09:00 to 17:00 |
| `recompute ignores a dangling IN` | Punches `[IN 09:00]` yield `workedMins === 0`, `lastOutAt === null` |
| `recompute sums two IN/OUT pairs` | Split shift 09:00-13:00, 17:00-21:00 gives `workedMins === 480` |
| `recompute subtracts break minutes` | 540 gross with a 45 min break gives `workedMins === 495` |
| `recompute applies the 10 minute grace` | `firstInAt` 09:08 against a 09:00 shift gives `lateMins === 0` |
| `recompute computes lateness past grace` | `firstInAt` 09:24 gives `lateMins === 14` |
| `recompute returns zero late with no shift` | `shift = null` gives `lateMins === 0` and `status === 'PRESENT'` |
| `recompute preserves ON_LEAVE with no punches` | Empty punch array keeps `currentStatus` |
| `recompute crosses the 240 minute cutoff` | 239 mins is `HALF_DAY`, 240 mins is `PRESENT` |

Service and integration tests, `attendance.e2e-spec.ts`, against a test database:

| Test | Assertion |
|---|---|
| `punch IN then IN rejects` | 409, `error.code === 'ALREADY_PUNCHED_IN'`, one punch row exists |
| `punch OUT before IN rejects` | 409, `error.code === 'NOT_PUNCHED_IN'` |
| `punch OUT after OUT rejects` | 409, `NOT_PUNCHED_IN` |
| `repeat punch with same Idempotency-Key replays` | Both calls return 201 with an identical body, one `AttendancePunch` row |
| `punch at 01:15 IST belongs to the previous business date` | `attendanceDay.businessDate` is D-1 |
| `punch at 04:30 IST belongs to today` | `businessDate` is D |
| `break start without punch in rejects` | 409 `NOT_PUNCHED_IN` |
| `second break start rejects` | 409 `BREAK_ALREADY_OPEN`, one open `BreakLog` |
| `break end without an open break rejects` | 409 `BREAK_NOT_OPEN` |
| `break end recomputes breakMins and workedMins` | `breakMins` rises by the break length, `workedMins` falls by the same |
| `staff cannot punch for another employee` | 403 `FORBIDDEN` when `employeeId` is set without `workforce.attendance.edit` |
| `manager punch for staff writes MANAGER_EDIT` | `source === 'MANAGER_EDIT'`, `editedById` set |
| `punch edit without reason rejects` | 400 `VALIDATION_FAILED` |
| `punch edit writes an AuditLog row` | One new `AuditLog` with `action === 'workforce.attendance.edit'`, `before` and `after` populated |
| `punch edit that reorders the sequence rejects` | 422 `INVALID_PUNCH_SEQUENCE` |
| `staff reading attendance sees only themselves` | `GET /attendance?employeeId=<other>` returns only the caller's rows |
| `attendance for another outlet returns 404` | Not 403, per the API conventions |

Shift tests, `shifts.e2e-spec.ts`:

| Test | Assertion |
|---|---|
| `overlapping shift rejects` | 409 `OVERLAPPING_SHIFT` |
| `adjacent shifts are allowed` | 09:00-14:00 and 14:00-19:00 both created |
| `cancelled shift does not block a new one` | Overlap check ignores `CANCELLED` |
| `bulk roster is all or nothing` | One bad row in 40 leaves zero rows written |
| `bulk reports the failing index` | `details[0].field === 'shifts[4]'` |
| `deleting a shift with attendance rejects` | 422 `SHIFT_HAS_ATTENDANCE` |
| `roster returns every active employee` | Employee with no shifts appears with empty `days` arrays |

Rollup job tests, `attendance-rollup.job.spec.ts`:

| Test | Assertion |
|---|---|
| `rollup closes an open break at lastOutAt` | `endedAt === day.lastOutAt`, `durationMins` correct |
| `rollup closes a missing punch out at shift end` | Synthetic punch has `source === 'SYSTEM_ROLLUP'`, day note flagged |
| `rollup closes a missing punch out with no shift` | Punch lands at `firstInAt + 8h` |
| `rollup marks scheduled no-shows ABSENT` | `status === 'ABSENT'` for a rostered employee with no punches |
| `rollup marks approved leave ON_LEAVE over ABSENT` | Leave wins, `status === 'ON_LEAVE'` |
| `rollup marks unrostered employees WEEKLY_OFF` | No shift, no punch, no leave gives `WEEKLY_OFF` |
| `rollup does not overwrite a worked day` | Employee who punched on a day off stays `PRESENT` |
| `rollup is idempotent` | Run twice on the same date, snapshot every `AttendanceDay`, `AttendancePunch` and `BreakLog` row before and after the second run and assert deep equality |
| `rollup at 03:45 targets the previous calendar day` | With the clock at 03:45 IST on the 27th, `targetDate === '2026-08-26'` |
