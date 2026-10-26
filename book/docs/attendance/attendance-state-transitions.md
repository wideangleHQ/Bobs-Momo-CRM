# Attendance System — State Transitions

All states in the **Implemented** section are verified in `apps\api\prisma\schema.prisma`
and `apps\api\src\modules\workforce\attendance.service.ts`. States in the **PROPOSED**
section are from SRS Amendment v1.1 and do not exist in the current schema.

---

## Part 1: AttendanceDay status transitions (IMPLEMENTED)

These transitions are enforced by `recompute()` in `attendance.service.ts` and by the
nightly rollup job (documented in `book\src\18-employees-attendance-shifts.md`).

| Current State | Triggering Action | Actor | Validation | Resulting State | DB Write | Notification | Employee Can Retry | Manager Action Required |
|---|---|---|---|---|---|---|---|---|
| _(no row)_ | Employee punches IN | Employee | Employee is ACTIVE; Idempotency-Key; no prior IN today | `ABSENT` (upserted with default) then recomputed to `PRESENT` | AttendanceDay upserted; AttendancePunch inserted | None | N/A | No |
| `ABSENT` | Employee punches IN | Employee | Same as above | `PRESENT` (if any punches) | AttendanceDay updated via recompute | None | N/A | No |
| `PRESENT` | Employee punches OUT | Employee | Last punch is IN | `PRESENT` (recomputed with lastOutAt) | AttendanceDay updated | None | N/A | No |
| `PRESENT` | Employee punches IN again (after OUT) | Employee | Last punch is OUT | `PRESENT` (additional segment) | New AttendancePunch; recompute | None | Yes | No |
| `PRESENT` | Nightly rollup closes the day | System (03:45 IST) | Day still open | `PRESENT` (workedMins updated) | AttendancePunch SYSTEM_ROLLUP; recompute | None | N/A | No |
| `ABSENT` | Nightly rollup — no punches, shift scheduled | System | Employee has SCHEDULED shift, no punches | `ABSENT` (unchanged/confirmed) | AttendanceDay upserted | None | No | No |
| `ABSENT` | Leave approved covering this date | Store Manager | LeaveRequest transitions to APPROVED | `ON_LEAVE` | AttendanceDay.status = ON_LEAVE | LEAVE_DECIDED to employee | No | Manager decision |
| `ON_LEAVE` | Future approved leave cancelled | Store Manager | fromDate > today; manager holds `workforce.leave.decide` | `ABSENT` | AttendanceDay.status = ABSENT | LEAVE_DECIDED to employee | No | Manager decision |
| _(no row / ABSENT)_ | Nightly rollup — no shift, no punches, no leave | System | Employee is ACTIVE, no SCHEDULED shift | `WEEKLY_OFF` | AttendanceDay upserted | None | No | No |
| `PRESENT` | Punch worked on a weekly-off day | Employee | Any punches exist | `PRESENT` (rollup does NOT overwrite) | No change | None | N/A | No |
| `PRESENT` (with open break) | Break ended | Employee | Open BreakLog exists | `PRESENT` (workedMins recalculated) | BreakLog.endedAt set; recompute | None | N/A | No |
| `HALF_DAY` | Employee punches additional segment | Employee | Last punch is OUT; workedMins was < 360 | `PRESENT` if new total >= 360 | New punches; recompute | None | Yes | No |
| Any non-EXITED | Manager corrects a punch | Manager with `workforce.attendance.edit` | Punch stays within same business date; no sequence reversal | Recomputed (any status) | AttendancePunch updated; AuditLog written | None | N/A | No |

### Business day boundary rule

`toBusinessDate()` (from `@bobs-momo/shared`) uses a 04:00 IST cutoff. A punch at
01:15 IST on Tuesday belongs to Monday's business date.

---

## Part 2: AttendancePunch source transitions (IMPLEMENTED)

| Source value | Set when | Effect on audit |
|---|---|---|
| `WEB` | Normal employee self-service punch | No audit row |
| `MANAGER_EDIT` | Manager supplied `employeeId` or `at` in request body | AuditLog row written with before/after |
| `SYSTEM_ROLLUP` | Nightly job inserted synthetic OUT | `AttendanceDay.note` flagged; `autoClosedDays` counter in summary |

---

## Part 3: LeaveRequest status transitions (IMPLEMENTED)

Source: `apps\api\src\modules\workforce\leave.service.ts`

| Current State | Triggering Action | Actor | Validation | Resulting State | DB Write | Notification | Attendance Side Effect |
|---|---|---|---|---|---|---|---|
| _(none)_ | Employee submits | Employee (or manager filing for staff) | fromDate >= today (unless manager); no overlap with PENDING/APPROVED; within 180 days | `PENDING` | LeaveRequest created; OutboxEvent LEAVE_REQUESTED | Manager receives LEAVE_REQUESTED | None |
| `PENDING` | Manager approves | Manager with `workforce.leave.decide` | Request is PENDING; manager is not the requester | `APPROVED` | LeaveRequest updated; ON_LEAVE days written; OutboxEvent LEAVE_DECIDED | Employee receives LEAVE_DECIDED | AttendanceDay rows set to ON_LEAVE for each date |
| `PENDING` | Manager rejects | Manager with `workforce.leave.decide` | Request is PENDING | `REJECTED` | LeaveRequest updated; OutboxEvent LEAVE_DECIDED | Employee receives LEAVE_DECIDED | None |
| `PENDING` | Employee cancels own request | Employee (own only, via `workforce.leave.request` SELF) | Any day — can cancel pending at any time | `CANCELLED` | LeaveRequest updated | None | None |
| `APPROVED` | Manager cancels future leave | Manager with `workforce.leave.decide` | fromDate > today | `CANCELLED` | LeaveRequest updated; ON_LEAVE rows set to ABSENT; OutboxEvent LEAVE_DECIDED | Employee receives LEAVE_DECIDED | ON_LEAVE attendance rows removed |
| `APPROVED` | Cancel attempt for past/in-progress leave | Anyone | fromDate <= today | Error 409 `LEAVE_ALREADY_STARTED` | No change | None | None |
| `REJECTED` | Any cancel/transition attempt | Anyone | Terminal state | Error 409 `LEAVE_NOT_PENDING` | No change | None | None |
| `CANCELLED` | Any cancel/transition attempt | Anyone | Terminal state | Error 409 `LEAVE_NOT_PENDING` | No change | None | None |

---

## Part 4: PROPOSED state transitions (SRS Amendment v1.1 — NOT YET IMPLEMENTED)

> ⚠️ PROPOSED — These states and transitions are required by SRS Amendment v1.1
> (sections A5–A6) but do not exist in the current schema or service code.
> Implementation requires new schema fields and a new verification service.

| Current State | Triggering Action | Actor | Validation | Resulting State | DB Write | Notification | Employee Can Retry | Manager Action Required |
|---|---|---|---|---|---|---|---|---|
| _(no submission)_ | Employee submits with location + selfie | Employee | Within 150m of outlet; fresh selfie captured; not a duplicate for this workday | `PENDING_VERIFICATION` | New submission record; selfie stored privately; location evidence stored | Manager receives notification of pending submission | N/A | Yes |
| `PENDING_VERIFICATION` | Manager verifies | Store Manager (own outlet) | Submission is pending; manager reviews photo, timestamp, location | `VERIFIED` | Submission marked VERIFIED; AttendanceDay updated | Employee notified of verification | No | Manager decision |
| `PENDING_VERIFICATION` | Manager rejects | Store Manager | Submission is pending; reason provided | `REJECTED` | Submission marked REJECTED (kept for audit; NOT deleted) | Employee notified of rejection and reason | Yes (requires new submission) | Manager decision |
| `REJECTED` | Employee resubmits | Employee | Manager-controlled; employee cannot self-reinstate | New `PENDING_VERIFICATION` | New submission record | Manager notified again | Yes | Yes |
| `PENDING_VERIFICATION` | Location was outside radius | System (server-side) | Distance > 150m | `OUTSIDE_RADIUS` (or validation error) | Submission blocked or flagged | Employee sees clear recoverable message | Yes (must move closer) | No |

**Note:** The amendment states (A6): "A failed GPS reading should allow retry/review
rather than silently creating verified attendance. Any manual exception must be
restricted to an authorized manager action and logged with a reason. Do not silently
delete or overwrite rejected records."
