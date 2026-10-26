# Attendance System — Overview

## 1. Purpose

The attendance system replaces WhatsApp-based rosters, paper punch cards, and manual
absence tracking at Bob's Momo's two outlets (Patia and Saheed Nagar). It provides:

- A daily record of each employee's check-in, check-out, breaks, and worked time
- Real-time visibility for Store Managers of who is currently on the floor
- Leave management with a manager-decision workflow
- A rolling history used for HR reporting

**Functional requirement coverage:** FR-EMP-002 (attendance, shift and break logging),
FR-EMP-003 (leave request and approval), FR-EMP-004 (leave and salary history).

**SRS Amendment v1.1** (26 October 2026) extends the original scope to include
outlet geofencing, selfie evidence capture, and manager verification of individual
submissions. These are **PROPOSED** capabilities — they are specified in the amendment
but **not yet implemented** in the source code (see
[attendance-implementation-audit.md](attendance-implementation-audit.md)).

---

## 2. Roles involved

Source: `book\src\14-rbac-and-permissions.md`, verified against
`apps\api\prisma\schema.prisma`.

| Role | Key permissions | Scope | What they do in this module |
|---|---|---|---|
| **OWNER** | All workforce keys at ALL_OUTLETS | ALL_OUTLETS | Full visibility and edit access across both outlets; can edit punches, decide leave, view salary |
| **OPERATIONS_MANAGER** | `workforce.attendance.read`, `workforce.attendance.edit`, `workforce.leave.decide` | ALL_OUTLETS | Cross-outlet attendance corrections, leave decisions, HR reporting |
| **STORE_MANAGER** | `workforce.attendance.punch_self`, `workforce.attendance.read`, `workforce.attendance.edit`, `workforce.leave.decide`, `workforce.shift.create` | OWN_OUTLET | Day-to-day roster management; runs the live attendance board; corrects missed punches; approves/rejects leave; PROPOSED: reviews verification queue |
| **KITCHEN_MANAGER** | `workforce.attendance.punch_self`, `workforce.attendance.read`, `workforce.shift.create`, `workforce.leave.read` | OWN_OUTLET | Punches own attendance; reads team attendance and shifts; can create shifts; cannot edit other employees' punches or decide leave |
| **HR_ACCOUNTS** | `workforce.attendance.read`, `workforce.attendance.edit`, `workforce.leave.decide`, `workforce.leave.read`, `workforce.salary.read`, `workforce.salary.write` | ALL_OUTLETS | Monthly attendance reports; leave history; salary storage |
| **KITCHEN_STAFF** | `workforce.attendance.punch_self`, `workforce.break.log_self`, `workforce.attendance.read` (SELF), `workforce.leave.request` | SELF | Punch in/out on own record; log breaks; submit leave requests; view own history |
| **COUNTER_CASHIER** | Same as KITCHEN_STAFF | SELF | Same self-service block |
| **INVENTORY_MANAGER** | `workforce.attendance.punch_self`, `workforce.attendance.read` (SELF) | SELF | Self punch only |
| **PURCHASE_MANAGER** | `workforce.attendance.punch_self`, `workforce.attendance.read` (SELF) | SELF | Self punch only |

**Important:** A Store Manager holds `workforce.attendance.edit` at OWN_OUTLET scope,
meaning they can create or backdate punches on behalf of employees at their outlet, but
cannot touch records from the other outlet.

---

## 3. Status vocabulary

### 3.1 AttendanceDay status (current schema — verified in `schema.prisma`)

These are the values currently in the `AttendanceDay` model (the `status` field is a
string in Prisma, not an explicit enum, but the service enforces these values):

| Status | Set by | Meaning |
|---|---|---|
| `ABSENT` | Default on upsert; nightly rollup step 4 | Employee had a scheduled shift and no verified attendance |
| `PRESENT` | `recompute()` in `attendance.service.ts` | workedMins >= 360 (FULL_DAY_MINS) or any punches exist |
| `HALF_DAY` | `recompute()` | workedMins >= 240 (HALF_DAY_MINS) and < 360 |
| `ON_LEAVE` | `leave.service.ts writeLeaveDays()`; nightly rollup step 5 | Leave request was APPROVED covering this date |
| `WEEKLY_OFF` | Nightly rollup step 6 | No shift, no punches, no approved leave |

**Note:** The documentation book (`18-employees-attendance-shifts.md`) defines
`HALF_DAY_CUTOFF_MINS = 240` and `FULL_DAY_MINS = 360`, but the actual implementation
in `attendance.service.ts` (line 358–367) reads:
```
workedMins >= FULL_DAY_MINS → PRESENT
workedMins >= HALF_DAY_MINS → HALF_DAY
punches.length > 0 → PRESENT   (any punch = present, regardless of minutes)
else → ABSENT
```
The "any punch = PRESENT" rule differs slightly from the book's description; the book
says "workedMins > 0 → HALF_DAY" but the code escalates to PRESENT for any punch.

### 3.2 PROPOSED statuses (SRS Amendment v1.1 — NOT in current schema)

> ⚠️ PROPOSED — these states are required by the amendment but do not exist in the
> current Prisma schema or any service code.

| Status | Proposed meaning |
|---|---|
| `PENDING_VERIFICATION` | Submission received, awaiting manager review |
| `VERIFIED` | Manager confirmed the submission |
| `REJECTED` | Manager rejected the submission with a reason |

### 3.3 AttendancePunch source values (verified in code)

| Source | Set when |
|---|---|
| `WEB` | Normal employee self-service punch |
| `MANAGER_EDIT` | Manager supplied `employeeId` or `at` on the punch endpoint |
| `SYSTEM_ROLLUP` | Nightly job inserted a synthetic punch-out |

### 3.4 Leave status (verified in Prisma schema and `leave.service.ts`)

| Status | Meaning |
|---|---|
| `PENDING` | Submitted, awaiting manager decision |
| `APPROVED` | Manager approved; ON_LEAVE days written to AttendanceDay |
| `REJECTED` | Manager rejected; no attendance side effect |
| `CANCELLED` | Employee withdrew PENDING; or manager cancelled future APPROVED |

### 3.5 Conceptual vocabulary (from SRS Amendment v1.1)

The amendment introduces these concepts to distinguish between:

- **Attendance attempt**: An employee initiates the attendance flow on the web
- **Submitted record**: The server has received and stored the attempt (with evidence, PROPOSED)
- **Pending verification**: Submission is awaiting manager review (PROPOSED)
- **Verified record**: Manager has confirmed the submission as genuine (PROPOSED)
- **Rejected submission**: Manager has rejected the submission; it is kept for audit (PROPOSED)
- **Check-in event**: An `AttendancePunch` row with `direction = 'IN'`
- **Check-out event**: An `AttendancePunch` row with `direction = 'OUT'`
- **Break event**: A `BreakLog` row with `startedAt` and optionally `endedAt`
- **Final attendance summary**: The `AttendanceDay` row after recompute, representing the day's aggregate

---

## 4. Module dependencies

```
Attendance module
    │
    ├── Workforce/Shifts module
    │       Shift model provides shift.startsAt for lateMins calculation
    │       Roster provides scheduled days for absence detection in rollup
    │
    ├── Leave module
    │       Approved leave sets ON_LEAVE on AttendanceDay rows
    │       Leave status affects eligible-day denominator for attendance %
    │       APPROVED leave is read inside recompute() to set day status
    │
    ├── Notifications module (OutboxEvent)
    │       LEAVE_REQUESTED emitted on leave submission
    │       LEAVE_DECIDED emitted on approve/reject/cancel
    │       PROPOSED: attendance submission notification to manager
    │       PROPOSED: verification decision notification to employee
    │
    └── Admin/Audit module
            AuditLog rows written on punch edits and salary access
            AttendanceDay.note carries SYSTEM_ROLLUP flag
```

**Outlet model** is referenced by `AttendanceDay.outletId` (frozen at write time).
When an employee moves outlets, historical records keep the old outletId. The live
board and history endpoints both read `AttendanceDay.outletId`, not
`Employee.outletId`.
