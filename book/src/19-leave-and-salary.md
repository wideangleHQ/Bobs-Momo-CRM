# Leave and salary

Two features that share a chapter because they share a permission boundary and a
compliance problem, and almost nothing else. Leave is a workflow with a state
machine and a manager decision. Salary is a filing cabinet with a lock on it.

Requirements implemented: FR-EMP-003 (leave request and approval) and
FR-EMP-004 (leave and salary history).

> **Spec note:** every permission key this chapter uses is already in the
> chapter 14 matrix: `workforce.leave.request`, `workforce.leave.read`,
> `workforce.leave.decide`, `workforce.salary.read` and
> `workforce.salary.write`. Cancelling accepts either
> `workforce.leave.decide` or `workforce.leave.request` at SELF scope, which
> is how an employee can withdraw their own pending request without being able
> to touch anybody else's. This chapter introduces the error codes
> `LEAVE_PAST_DATE`, `LEAVE_OVERLAP`, `LEAVE_WINDOW_EXCEEDED`,
> `LEAVE_INVALID_RANGE`, `LEAVE_HALF_DAY_RANGE`, `LEAVE_NOT_PENDING`,
> `LEAVE_ALREADY_STARTED` and `SALARY_PERIOD_OVERLAP`.

## The leave state machine

```text
                  POST /leave-requests
                          │
                          ▼
                   ┌─────────────┐
                   │   PENDING   │
                   └──┬───┬───┬──┘
                      │   │   │
     approve ─────────┘   │   └───────── cancel
     workforce.leave      │              workforce.leave.request
     .decide              │              actor: the employee
     actor: Store Mgr     │              (own request only)
          │               │                        │
          ▼               │ reject                 ▼
   ┌─────────────┐        │ workforce.       ┌─────────────┐
   │  APPROVED   │        │ leave.decide     │  CANCELLED  │
   └──────┬──────┘        ▼                  └─────────────┘
          │        ┌─────────────┐                  ▲
          │        │  REJECTED   │                  │
          │        └─────────────┘                  │
          │                                         │
          └── cancel, future dates only ────────────┘
              workforce.leave.decide
              actor: Store Manager
```

Four states, and every transition table entry below is enforced in
`LeaveService`, not in the controller and not in the UI.

| From | To | Endpoint | Permission | Actor | Event emitted |
|---|---|---|---|---|---|
| (none) | PENDING | `POST /leave-requests` | `workforce.leave.request` | Employee, or manager filing for staff | `LEAVE_REQUESTED` |
| PENDING | APPROVED | `POST /leave-requests/:id/approve` | `workforce.leave.decide` | Store Manager of the employee's outlet | `LEAVE_DECIDED` |
| PENDING | REJECTED | `POST /leave-requests/:id/reject` | `workforce.leave.decide` | Store Manager | `LEAVE_DECIDED` |
| PENDING | CANCELLED | `POST /leave-requests/:id/cancel` | `workforce.leave.request` at SELF, or `workforce.leave.decide` | The requesting employee, or a manager | none |
| APPROVED | CANCELLED | `POST /leave-requests/:id/cancel` | `workforce.leave.decide` | Store Manager, future dates only | `LEAVE_DECIDED` |

There is one manager decision and no second approval layer. The SRS is explicit
about this and it is worth quoting: "No further approval layer beyond the single
manager decision." A cook asks for Thursday off, the store manager says yes, and
that is the end of the process. No HR counter-signature, no owner escalation, no
department head in the middle. If somebody asks for a two-stage approval during
UAT, the answer is that it was scoped out on purpose, and the cost of adding it
is a new status, a second decider column, a second notification and a second
place for a request to sit forgotten.

## Submitting a request

The employee opens the leave form, picks a type, a date range and writes a
reason. The server computes everything else.

```ts
export const createLeaveBody = z.object({
  employeeId: z.string().uuid().optional(),      // manager filing for staff
  type:       z.nativeEnum(LeaveType),      // CASUAL SICK UNPAID COMP_OFF
  fromDate:   z.string().date(),                 // YYYY-MM-DD, IST
  toDate:     z.string().date(),
  halfDay:    z.boolean().default(false),
  reason:     z.string().trim().min(5).max(300),
})
  .refine(v => v.fromDate <= v.toDate,
    { path: ['toDate'], message: 'toDate must be on or after fromDate' })
  .refine(v => !v.halfDay || v.fromDate === v.toDate,
    { path: ['halfDay'], message: 'a half day must be a single date' });
```

`dayCount` is `Decimal(4, 1)` and is never accepted from the client:

```ts
function computeDayCount(fromDate: string, toDate: string, halfDay: boolean) {
  if (halfDay) return new Decimal('0.5');
  return new Decimal(daysBetween(fromDate, toDate) + 1);   // inclusive
}
```

A half day is expressed as `fromDate === toDate` with `halfDay: true`, giving
`dayCount = 0.5`. Multi-day requests are always whole days. There is no
"half day at the start and half at the end" option, because the one decimal
place on `Decimal(4, 1)` exists for the 0.5 case and nothing more. Someone who
wants Thursday afternoon and Friday morning files two requests.

The count is calendar days, inclusive, weekly offs included. Bob's Momo trades
seven days a week and the client has not supplied a holiday calendar, so there
is no working-day calculation to do. A three day leave over a weekly off counts
as three. The manager sees the roster next to the request and decides
accordingly. This is a known simplification and it is written on the request
screen so nobody is surprised.

### Guards

```text
  POST /leave-requests
        │
        ├─► fromDate < today AND actor lacks workforce.leave.decide
        │        ──► 422 LEAVE_PAST_DATE
        │
        ├─► fromDate > today + 180 days
        │        ──► 422 LEAVE_WINDOW_EXCEEDED
        │
        ├─► toDate < fromDate
        │        ──► 400 LEAVE_INVALID_RANGE
        │
        ├─► halfDay AND fromDate != toDate
        │        ──► 400 LEAVE_HALF_DAY_RANGE
        │
        ├─► any PENDING or APPROVED request for this employee
        │   where fromDate <= existing.toDate
        │     AND toDate   >= existing.fromDate
        │        ──► 409 LEAVE_OVERLAP
        │
        ▼
   INSERT LeaveRequest (PENDING)  +  OutboxEvent LEAVE_REQUESTED
```

`LEAVE_PAST_DATE` has an exception on purpose. An employee cannot backdate their
own leave, because that turns an absence into approved leave after the fact. A
manager holding `workforce.leave.decide` can, because sick leave is genuinely
filed the day after: the cook was vomiting on Tuesday and nobody was filling in
forms. The manager files it Wednesday, approves it, and the attendance record
corrects itself.

`LEAVE_OVERLAP` checks `PENDING` and `APPROVED` requests only. `REJECTED` and
`CANCELLED` rows do not block a resubmission, which is what you want after a
rejected request gets reworked. The overlap test is the same half-open interval
comparison used for shifts, adapted for inclusive dates.

The 180 day forward window stops a typo like `2036-09-01` from creating a
request that sits in the pending list for ten years.

On success the service writes the `LeaveRequest` row and an `OutboxEvent` with
`eventKey = LEAVE_REQUESTED` in the same transaction. The dispatcher resolves the
recipient as the Store Manager of the employee's outlet and sends in-app plus
WhatsApp, per the event table in chapter 21.

## The decision

Approval is where leave stops being a form and starts changing what the rest of
the system believes.

```text
  POST /leave-requests/:id/approve   { note?: string }
        │
  ═════ BEGIN TRANSACTION ═══════════════════════════════════
   1. SELECT LeaveRequest ... FOR UPDATE
   2. assert status = PENDING          else 409 LEAVE_NOT_PENDING
   3. UPDATE status = APPROVED, decidedById, decidedAt, decisionNote
   4. FOR each date in [fromDate .. toDate]:
        upsert AttendanceDay (employeeId, date)
          where the row has no punches
          set status = ON_LEAVE, note = 'leave <type> #<id>'
   5. INSERT OutboxEvent LEAVE_DECIDED
  ═════ COMMIT ══════════════════════════════════════════════
        │
        ▼
   200 { leaveRequest, attendanceDaysWritten: 3 }
```

Step 4 is the step that matters and it is the one an engineer would skip.

Without it, the leave table says Raju is on approved leave from the 24th to the
26th, and the attendance board says he is absent on all three days, and the
monthly attendance summary counts three absences against him. Two screens, both
reading real data, both disagreeing. HR then reconciles by hand, which is the
Excel workflow this system exists to delete.

Writing `ON_LEAVE` onto the `AttendanceDay` rows at approval time is what keeps
the two views consistent, and it has to happen in the same transaction as the
status change. If the status write commits and the attendance write fails, the
system is in the inconsistent state permanently, and nothing will ever notice
because nobody re-reads an approved leave request. One transaction, both writes,
or neither.

Two details in step 4:

The upsert only writes days that have no punches. If the employee actually
turned up and worked on a day they later got approved leave for, the worked day
wins and the service records a `conflictDates` array in the response so the
manager can see it. Approved leave never erases evidence of work.

Half day approvals do not write `ON_LEAVE` at all. A half day means the employee
worked the other half, so the day's status has to come from the punch recompute,
which will land on `HALF_DAY`. The service writes only the `note` on that day,
tagging it with the leave id. Overwriting a half worked day with `ON_LEAVE`
would lose the worked minutes.

Rejection is simpler: set `REJECTED`, `decidedById`, `decidedAt`,
`decisionNote`, emit `LEAVE_DECIDED`. No attendance writes. The nightly rollup
will mark those dates `ABSENT` or `WEEKLY_OFF` on its own.

## Cancellation

Three cases, three different actors.

An employee cancels their own `PENDING` request. No manager involved, no
notification, no attendance side effects. The request has not changed anything
yet.

A manager cancels an `APPROVED` request whose `fromDate` is in the future. The
transaction reverses step 4: for every date the leave covered, if the
`AttendanceDay` row has status `ON_LEAVE` and no punches and no note from
another source, the row is deleted. Deleted, not reset to `ABSENT`, because a
future date with no row is the correct representation of "nothing known yet" and
the nightly rollup will fill it in when the day arrives. A `LEAVE_DECIDED` event
tells the employee.

A past approved leave cannot be cancelled by anybody. The response is
409 `LEAVE_ALREADY_STARTED`. The days have happened, the attendance record
reflects them, and rewriting history two weeks later is how payroll disputes
start. If the record is genuinely wrong, the correction path is a manager
attendance edit on the specific day, which is attributed and audited. A leave
that has started but not finished is also blocked, for the same reason: half of
it is already history.

## Leave balance, and why there is none

Phase 1 does not track leave entitlement, accrual or balance. There is no
"12 casual leaves per year" figure anywhere in the schema. There is no balance
check at request time. `LeaveType` exists so the history and the monthly report
can group by type, and for nothing else.

This is a deliberate scope decision, not an oversight, and the reasoning is
short. Bob's Momo has around 25 staff across two outlets. The client has not
documented a leave policy, has never had one in a system, and does not have one
written down on paper either. Building an accrual engine against an undefined
policy inside a three week window produces a feature that is confidently wrong,
and a wrong balance is worse than no balance: staff argue with it, HR overrides
it, and within a month everyone ignores the number on the screen.

What the manager does instead is look at `GET /employees/:id/leave-history`,
which shows days taken by type for the current financial year with a running
total, next to the current request. That is the same information a balance would
give them, minus a policy the business has not decided yet. It takes the manager
about four seconds.

What accrual would require, when the client asks for it in Phase 2:

1. A `LeaveEntitlement` table, one row per employee per leave year per type,
   with opening balance, credited, taken and closing.
2. An accrual rule set: monthly credit or annual grant, proration for joiners
   and leavers, a carry forward cap, an encashment path or an explicit lapse.
3. A year-end job that closes balances, applies the carry forward cap and opens
   the next year's rows.
4. A projected balance at request time, which has to account for other pending
   requests, not just approved ones.
5. A correction path, because a retroactive attendance edit or a cancelled leave
   has to move the balance back.

That is roughly a week of work and half of it is negotiation with the client
about the rules. It is a Phase 2 conversation, and the schema does not block it:
`LeaveRequest` already carries type, dates and a decimal day count, which is
everything an entitlement ledger needs to consume.

## Salary

ADR-006, restated because it gets re-litigated: salary is storage only. No
payroll computation. No payslips. No deductions, no PF, no ESI, no TDS, no
attendance-linked proration. The system stores what an employee is paid and when
that figure took effect. Nothing computes anything from it.

The SRS listed this as an open question and Phase 1 answers it with storage
only, matching decision 4 in chapter 04. Payroll is in Future Scope.

### Effective-dated history

`SalaryRecord` is a history, not a current value. One employee has many rows and
exactly one of them is current.

```text
  employeeId  effectiveFrom  effectiveTo   monthlyCtc
  ──────────  ─────────────  ───────────   ──────────
  BM-EMP-0007  2024-11-04    2025-03-31       12000
  BM-EMP-0007  2025-04-01    2025-09-30       14000
  BM-EMP-0007  2025-10-01    null             16500   ◄── current
                                  ▲
                    exactly one row per employee has
                    effectiveTo IS NULL at any time
```

Writing a new record closes the previous one, in one transaction:

```ts
async create(actor: Actor, employeeId: string, dto: CreateSalaryDto) {
  return this.prisma.$transaction(async (tx) => {
    const current = await tx.salaryRecord.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (current && dto.effectiveFrom <= current.effectiveFrom) {
      throw new ConflictError('SALARY_PERIOD_OVERLAP',
        `A salary record already starts on or after ` +
        `${fmt(current.effectiveFrom)}.`);
    }

    const closed = await tx.salaryRecord.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lte: dto.effectiveFrom },
        effectiveTo:   { gte: dto.effectiveFrom },
      },
    });
    if (closed) throw new ConflictError('SALARY_PERIOD_OVERLAP',
      'The effective date falls inside a closed salary period.');

    if (current) {
      await tx.salaryRecord.update({
        where: { id: current.id },
        data:  { effectiveTo: minusOneDay(dto.effectiveFrom) },
      });
    }

    const created = await tx.salaryRecord.create({
      data: { ...dto, employeeId, createdById: actor.userId },
    });

    await tx.auditLog.create({ data: auditRow(actor, 'workforce.salary.write',
      'SalaryRecord', created.id, null, redactAmounts(created)) });

    return created;
  });
}
```

`SALARY_PERIOD_OVERLAP` fires in two situations: a new record starting on or
before the current open record's start, and a new record starting inside an
already closed period. Both mean the timeline would have two answers for one
date, and a timeline with two answers is not a timeline.

The previous record is closed at `effectiveFrom - 1 day`, so periods are
contiguous with no gap and no overlap. Reading the salary in force on any date
is one query:

```sql
SELECT * FROM "SalaryRecord"
WHERE "employeeId" = $1
  AND "effectiveFrom" <= $2
  AND ("effectiveTo" IS NULL OR "effectiveTo" >= $2)
```

### Who can see it

`workforce.salary.read` and `workforce.salary.write` are granted to
`HR_ACCOUNTS` and `OWNER`. Nobody else. Not `OPERATIONS_MANAGER`, not
`STORE_MANAGER`, not the employee themselves.

The rule that matters more than the permission: salary never appears inside
another payload. It is not a field on the employee DTO. It is not an optional
expansion on `GET /employees/:id`. It is not conditionally included when the
caller happens to hold the key.

The DTO consequence is concrete. `EmployeeDto` has no salary field at all, so
there is no branch anywhere that decides whether to populate it, and therefore
no branch that can get the condition backwards during a refactor. Salary lives
behind its own endpoints under `/employees/:id/salary`, served by
`SalaryService`, and `SalaryService` is the only class in the codebase that
touches the `salaryRecord` Prisma delegate. A lint rule enforces that:

```json
{
  "no-restricted-syntax": [
    "error",
    {
      "selector": "MemberExpression[property.name='salaryRecord']",
      "message": "SalaryRecord is only reachable from SalaryService."
    }
  ]
}
```

with an override for `modules/salary/**`. It is three lines of config and it
turns "remember not to include salary" into a build failure.

## Endpoint reference

All paths relative to `/api/v1`. Bearer auth on every call.

### GET /leave-requests

| | |
|---|---|
| Permission | `workforce.leave.read` |
| Scope | SELF for staff, OWN_OUTLET for managers, ALL_OUTLETS for OWNER |
| Success | 200 |

```ts
export const listLeaveQuery = z.object({
  employeeId: z.string().uuid().optional(),
  outletId:   z.string().uuid().optional(),
  status:     z.nativeEnum(LeaveStatus).optional(),
  type:       z.nativeEnum(LeaveType).optional(),
  from:       z.string().date().optional(),
  to:         z.string().date().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(25),
});
```

```json
{
  "data": [
    {
      "id": "b41e...",
      "employee": { "id": "8f1c...", "employeeCode": "BM-EMP-0007",
        "fullName": "Raju Behera", "outletCode": "BM-PATIA" },
      "type": "CASUAL", "fromDate": "2026-09-02", "toDate": "2026-09-04",
      "dayCount": "3.0", "reason": "Family function at Cuttack",
      "status": "PENDING", "decidedById": null, "decidedAt": null,
      "createdAt": "2026-08-26T05:11:00.000Z"
    }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 4 }
}
```

Rules: a caller with only the `SELF` scope has `employeeId` forced to their own
id regardless of the query string. `from` and `to` filter on overlap with the
request range, not on `createdAt`. Default ordering is `status = PENDING` first,
then `fromDate` ascending, so the manager's action list is at the top.

Errors: 400 `VALIDATION_FAILED`, 403 `FORBIDDEN`.

### POST /leave-requests

Permission `workforce.leave.request`, scope SELF or OWN_OUTLET, 201. Schema and
guards are in the sections above.

Errors: 400 `LEAVE_INVALID_RANGE`, 400 `LEAVE_HALF_DAY_RANGE`,
409 `LEAVE_OVERLAP`, 422 `LEAVE_PAST_DATE`, 422 `LEAVE_WINDOW_EXCEEDED`,
422 `EMPLOYEE_NOT_ACTIVE`.

```json
{
  "id": "b41e...", "status": "PENDING", "dayCount": "3.0",
  "type": "CASUAL", "fromDate": "2026-09-02", "toDate": "2026-09-04"
}
```

### GET /leave-requests/:id

Permission `workforce.leave.read`, scope SELF or OWN_OUTLET, 200. Returns the
full row plus the decider's name and the employee's leave taken this financial
year, which is what the manager wants on the decision screen. 404 `NOT_FOUND`
outside scope.

### POST /leave-requests/:id/approve

| | |
|---|---|
| Permission | `workforce.leave.decide` |
| Scope | OWN_OUTLET |
| Success | 200 |

```ts
export const decideLeaveBody = z.object({
  note: z.string().trim().max(300).optional(),
});
```

```json
{
  "leaveRequest": {
    "id": "b41e...", "status": "APPROVED",
    "decidedById": "c7a2...", "decidedAt": "2026-08-26T06:02:11.000Z",
    "decisionNote": "Covered by Sunita"
  },
  "attendanceDaysWritten": 3,
  "conflictDates": []
}
```

Rules: request must be `PENDING`. The decider may not be the requesting employee,
even if they hold the key, and the check is on `Employee.id` not `User.id`.
Writes `ON_LEAVE` attendance rows per the transaction above. Emits
`LEAVE_DECIDED`. `conflictDates` lists dates skipped because punches already
exist there.

Errors: 409 `LEAVE_NOT_PENDING`, 403 `FORBIDDEN` on self-approval,
404 `NOT_FOUND`.

### POST /leave-requests/:id/reject

Permission `workforce.leave.decide`, scope OWN_OUTLET, 200. Same body. Sets
`REJECTED`, emits `LEAVE_DECIDED`, writes no attendance rows.

Errors: 409 `LEAVE_NOT_PENDING`, 403 `FORBIDDEN`, 404 `NOT_FOUND`.

### POST /leave-requests/:id/cancel

| | |
|---|---|
| Permission | `workforce.leave.request` at SELF for own PENDING, `workforce.leave.decide` for APPROVED |
| Scope | SELF or OWN_OUTLET |
| Success | 200 |

Rules: `PENDING` cancels freely by the requester. `APPROVED` cancels only when
`fromDate > today` and only by a holder of `workforce.leave.decide`, and the
transaction removes the `ON_LEAVE` attendance rows it created. `REJECTED` and
`CANCELLED` are terminal.

Errors: 409 `LEAVE_ALREADY_STARTED` when `fromDate <= today` on an approved
request, 409 `LEAVE_NOT_PENDING` when the state is terminal, 403 `FORBIDDEN`.

### GET /leave-requests/calendar

Permission `workforce.leave.read`, scope OWN_OUTLET, 200. Month view for the
roster screen, so a manager can see who is already off before approving another
request for the same week.

```ts
export const leaveCalendarQuery = z.object({
  outletId: z.string().uuid(),
  month:    z.string().regex(/^\d{4}-\d{2}$/),
  status:   z.array(z.nativeEnum(LeaveStatus))
              .default(['PENDING', 'APPROVED']),
});
```

```json
{
  "month": "2026-09",
  "days": {
    "2026-09-02": [
      { "leaveId": "b41e...", "employeeId": "8f1c...",
        "fullName": "Raju Behera", "type": "CASUAL", "status": "APPROVED" }
    ],
    "2026-09-03": []
  }
}
```

Rules: every date in the month is a key, including empty ones, so the frontend
does not fill gaps. A multi-day request appears under every date it covers.

### GET /employees/:id/leave-history

Permission `workforce.leave.read`, scope OWN_OUTLET, 200.

```ts
export const leaveHistoryQuery = z.object({
  financialYear: z.string().regex(/^\d{4}$/).optional(),   // 2026 = FY26-27
});
```

```json
{
  "financialYear": "2026",
  "totals": { "CASUAL": "6.5", "SICK": "3.0",
              "UNPAID": "1.0", "COMP_OFF": "0.0" },
  "totalDays": "10.5",
  "requests": [ { "id": "b41e...", "type": "CASUAL", "fromDate": "2026-09-02",
                  "toDate": "2026-09-04", "dayCount": "3.0",
                  "status": "APPROVED" } ]
}
```

Rules: the financial year runs 1 April to 31 March, which is what an Indian
business means by "this year". Totals count `APPROVED` requests only.

### GET /employees/:id/salary

| | |
|---|---|
| Permission | `workforce.salary.read` |
| Scope | OWN_OUTLET for HR_ACCOUNTS, ALL_OUTLETS for OWNER |
| Success | 200 |

```json
{
  "data": [
    { "id": "e9c1...", "effectiveFrom": "2025-10-01", "effectiveTo": null,
      "monthlyCtc": "16500.00", "basic": "10000.00", "allowances": "6500.00",
      "note": "Annual revision", "createdAt": "2025-09-28T09:00:00.000Z",
      "createdBy": { "id": "c7a2...", "fullName": "Anita Das" } }
  ]
}
```

Rules: full history, newest first. Every call writes an `AuditLog` row with
`action = 'workforce.salary.read'` and the employee id, and no amounts in the
`after` payload. Any role without the key gets 403, including a manager viewing
their own team.

### POST /employees/:id/salary

Permission `workforce.salary.write`, scope OWN_OUTLET, 201.

```ts
export const createSalaryBody = z.object({
  effectiveFrom: z.string().date(),
  // money arrives as a string, never a JS number
  monthlyCtc:    z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
  basic:         z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).nullish(),
  allowances:    z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).nullish(),
  note:          z.string().trim().max(200).nullish(),
});
```

Rules: money arrives as a string and is parsed into `Decimal`, never through a
JavaScript `number`, per the schema rules in chapter 10. `basic + allowances`,
when both are supplied, must equal `monthlyCtc`. `effectiveFrom` may not be more
than 90 days in the future. Closes the previous open record. Writes an
`AuditLog` row.

Errors: 409 `SALARY_PERIOD_OVERLAP`, 400 `VALIDATION_FAILED`,
422 `SALARY_COMPONENTS_MISMATCH`, 404 `NOT_FOUND`.

### GET /employees/:id/salary/current

Permission `workforce.salary.read`, scope OWN_OUTLET, 200. Returns the single
record with `effectiveTo IS NULL`, or 404 `NOT_FOUND` when the employee has no
salary on file. Audited the same way as the history read.

### PATCH /salary/:id

Permission `workforce.salary.write`, scope OWN_OUTLET, 200.

```ts
export const updateSalaryBody = z.object({
  monthlyCtc: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
  basic:      z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).nullish(),
  allowances: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).nullish(),
  note:       z.string().trim().max(200).nullish(),
});
```

Rules: this endpoint fixes a typo in an amount. It cannot change
`effectiveFrom` or `effectiveTo`, because moving a period boundary is a timeline
change and the correct action is to create a new record. Only the record with
`effectiveTo IS NULL` may be patched; closed historical records are immutable.
Writes an `AuditLog` row with before and after.

Errors: 422 `SALARY_RECORD_CLOSED`, 400 `VALIDATION_FAILED`, 404 `NOT_FOUND`.

## Compliance note

Salary and leave records are personal information about identifiable people. A
leave reason often contains health information, because "hospital visit for my
mother" is what people actually type. Handle both accordingly.

The rules this system applies:

Access is restricted at the API, not in the UI. `workforce.salary.read` is held
by `HR_ACCOUNTS` and `OWNER` only, and hiding a menu item is not access control.
The permission guard runs before the controller method.

Every read of salary data writes an `AuditLog` row. Not just writes, reads.
`GET /employees/:id/salary` and `GET /employees/:id/salary/current` both log
`actorId`, `actorLabel`, the employee id and the timestamp. This is unusual for
a read endpoint and it is here because "who has been looking at everyone's pay"
is a question a business owner will eventually ask, and the answer has to exist
before the question does.

Amounts never reach the application log at info level. The audit row's `after`
column stores field names that changed, not values. The logger has a redaction
list covering `monthlyCtc`, `basic`, `allowances` and `passwordHash`, applied in
the Nest logger configuration, so an accidental `logger.log(record)` prints
`monthlyCtc: '[redacted]'`.

Leave reasons are excluded from every list payload. `GET /leave-requests`
returns `reason` only to the requesting employee and to holders of
`workforce.leave.decide` for that outlet. The calendar endpoint never returns it
at all, because a calendar is a screen other people look over your shoulder at.

No export a non-HR role can trigger contains salary. The employee CSV export
available to a Store Manager has name, code, outlet, department, designation,
join date and status. Adding a salary column to it is a code change that has to
pass the lint rule above, which means it cannot happen by accident.

Retention follows the employee record. An `EXITED` employee keeps their salary
and leave history, because statutory record keeping in India runs to years, not
months. Nothing in Phase 1 deletes either.

## Failure modes

| Failure | Symptom | Cause | Handling |
|---|---|---|---|
| Approval writes leave status but not attendance | Board says absent, leave list says approved, HR reconciles by hand | Two separate writes, no transaction | Both writes in one `$transaction`. Covered by a rollback test |
| Two managers approve the same request | Duplicate `LEAVE_DECIDED` notifications, second write clobbers the first decider | No row lock | `SELECT ... FOR UPDATE` on the request, then assert `PENDING` |
| Employee approves their own leave | Nobody notices for a month | Manager who is also an employee holds the decide key | Explicit self-approval check on `Employee.id`, 403 |
| Leave approved over days already worked | Worked minutes overwritten by `ON_LEAVE` | Blind upsert | Upsert skips days with punches, returns `conflictDates` |
| Half day approval erases the worked half | Day shows `ON_LEAVE`, worked minutes lost | Same blind upsert | Half day writes the note only, status comes from the punch recompute |
| Cancelled future leave leaves ON_LEAVE rows behind | Employee marked on leave on a day they worked | Cancel did not reverse the attendance write | Cancel transaction deletes the rows it created, guarded by "no punches, no other note" |
| Salary written with a `number` | Rounding drift on large CTC values | JSON number parsing | zod accepts a string, Prisma column is `Decimal(12, 2)`, a lint rule bans `parseFloat` in the salary module |
| Two open salary records | Ambiguous current salary | Previous record not closed | `SALARY_PERIOD_OVERLAP` guard plus a database check in the nightly integrity job |
| Salary appears in an employee payload | Every manager sees every wage | Field added to a shared DTO during a refactor | No salary field exists on `EmployeeDto`. Lint rule restricts the Prisma delegate to `SalaryService` |
| Salary amount in a log line | Wages in Railway log retention | Careless `logger.log(record)` | Redaction list in the logger config, plus a test that asserts the redaction |

## Test plan

Leave service and integration tests, `leave.e2e-spec.ts`:

| Test | Assertion |
|---|---|
| `dayCount is inclusive` | 2026-09-02 to 2026-09-04 gives `dayCount === '3.0'` |
| `half day yields 0.5` | Single date with `halfDay: true` gives `'0.5'` |
| `half day across a range rejects` | 400 `LEAVE_HALF_DAY_RANGE` |
| `client-supplied dayCount is ignored` | Body with `dayCount: 99` still stores the computed value |
| `staff cannot backdate leave` | `fromDate` yesterday, staff actor, 422 `LEAVE_PAST_DATE` |
| `manager can backdate leave` | Same request with `workforce.leave.decide`, 201 |
| `overlapping pending request rejects` | 409 `LEAVE_OVERLAP` |
| `overlapping approved request rejects` | 409 `LEAVE_OVERLAP` |
| `rejected request does not block resubmission` | 201 after a rejection on the same dates |
| `request beyond 180 days rejects` | 422 `LEAVE_WINDOW_EXCEEDED` |
| `submission emits LEAVE_REQUESTED` | One `OutboxEvent` with `eventKey === 'LEAVE_REQUESTED'`, `aggregateId` matching |
| `approval writes ON_LEAVE for every covered date` | Three `AttendanceDay` rows with `status === 'ON_LEAVE'` |
| `approval and attendance share a transaction` | Force the attendance write to throw, assert the request is still `PENDING` and no `OutboxEvent` exists |
| `approval skips days with punches` | Day with an IN punch keeps `PRESENT`, `conflictDates` contains that date |
| `half day approval does not write ON_LEAVE` | Day status unchanged, note contains the leave id |
| `approving a non-pending request rejects` | 409 `LEAVE_NOT_PENDING` |
| `self approval rejects` | 403 `FORBIDDEN` even with the decide permission |
| `approval emits LEAVE_DECIDED to the employee` | Outbox payload `recipientEmployeeId` matches |
| `employee cancels own pending request` | 200, status `CANCELLED`, no outbox event |
| `employee cannot cancel another's request` | 403 `FORBIDDEN` |
| `manager cancels future approved leave` | `ON_LEAVE` rows removed, status `CANCELLED` |
| `past approved leave cannot be cancelled` | 409 `LEAVE_ALREADY_STARTED` |
| `in-progress leave cannot be cancelled` | `fromDate` yesterday, `toDate` tomorrow, 409 `LEAVE_ALREADY_STARTED` |
| `staff list is scoped to self` | `GET /leave-requests?employeeId=<other>` returns only own rows |
| `calendar omits leave reasons` | No `reason` key in any calendar entry |

Salary tests, `salary.e2e-spec.ts`:

| Test | Assertion |
|---|---|
| `first record leaves effectiveTo null` | Single row, `effectiveTo === null` |
| `second record closes the first` | Previous `effectiveTo === newFrom - 1 day`, exactly one open row |
| `overlapping effectiveFrom rejects` | 409 `SALARY_PERIOD_OVERLAP` |
| `effectiveFrom inside a closed period rejects` | 409 `SALARY_PERIOD_OVERLAP` |
| `components must sum to CTC` | `basic + allowances != monthlyCtc` gives 422 |
| `amount parses as Decimal` | `'16500.005'` fails validation, `'16500.50'` stores exactly |
| `STORE_MANAGER cannot read salary` | 403 `FORBIDDEN` |
| `OPERATIONS_MANAGER cannot read salary` | 403 `FORBIDDEN` |
| `employee cannot read own salary` | 403 `FORBIDDEN` |
| `HR_ACCOUNTS reads salary` | 200 with the history array |
| `salary read writes an audit row` | One `AuditLog` with `action === 'workforce.salary.read'` and no amount in `after` |
| `employee payload has no salary field` | `GET /employees/:id` response keys asserted against an exact allow-list, for HR_ACCOUNTS and OWNER too |
| `closed record cannot be patched` | 422 `SALARY_RECORD_CLOSED` |
| `patch cannot move effectiveFrom` | Field rejected by the schema, 400 |
| `logger redacts amounts` | Capture the logger transport, assert `monthlyCtc` renders as `[redacted]` |
