# Attendance System — Acceptance Tests

> **Status note:** All tests below are **Not Run** as of 26 October 2026. This file
> documents the required test scenarios. No test execution has been performed in
> this phase.
>
> Tests marked `[PROPOSED]` depend on features from SRS Amendment v1.1 that are not
> yet implemented. They cannot be run until the corresponding implementation work is
> complete.
>
> Tests marked `[EXISTING]` reference test files already described in the documentation
> (`book\src\18-employees-attendance-shifts.md`, `book\src\19-leave-and-salary.md`).
> Their existence in the codebase was not independently verified in this phase.

---

## Section 1: Employee check-in and check-out

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| ATT-001 | FR-EMP-002, Feature List 5.3 | Employee punches IN successfully | Employee is ACTIVE, has login, is SELF-scoped | POST /attendance/punch { direction: "IN" } with Idempotency-Key | 201; AttendanceDay created with firstInAt set; status PRESENT | — | Not Run |
| ATT-002 | FR-EMP-002 | Employee punches OUT after IN | AttendanceDay exists with last punch IN | POST /attendance/punch { direction: "OUT" } | 201; lastOutAt set; workedMins > 0 | — | Not Run |
| ATT-003 | FR-EMP-002, book ch.18 | Second IN after first IN rejected | Last punch is IN | POST /punch { direction: "IN" } | 409 ATTENDANCE_ALREADY_PUNCHED_IN | — | Not Run [EXISTING] |
| ATT-004 | FR-EMP-002, book ch.18 | OUT without IN rejected | No punches for the day | POST /punch { direction: "OUT" } | 409 ATTENDANCE_NOT_PUNCHED_IN | — | Not Run [EXISTING] |
| ATT-005 | FR-EMP-002 | Missing Idempotency-Key rejected | Any employee | POST /punch without Idempotency-Key header | 400 (idempotency key required) | — | Not Run |
| ATT-006 | FR-EMP-002, book ch.18 | Repeat punch with same Idempotency-Key replays stored response | First punch succeeded | Retry same request with same key | 201 with identical body; only one punch row in DB | — | Not Run [EXISTING] |
| ATT-007 | SRS 16.5, book ch.18 | Punch at 01:15 IST belongs to previous business date | Time is 01:15 IST | POST /punch | attendanceDay.businessDate is D-1 | — | Not Run [EXISTING] |
| ATT-008 | SRS 16.5, book ch.18 | Punch at 04:30 IST belongs to current business date | Time is 04:30 IST | POST /punch | attendanceDay.businessDate is D | — | Not Run [EXISTING] |
| ATT-009 | FR-EMP-002 | Multiple IN/OUT pairs in one day (split shift) | First pair completed | Second IN then OUT | Both pairs recorded; workedMins is sum of both segments | — | Not Run |
| ATT-010 | FR-EMP-002 | EXITED employee cannot punch | Employee status = EXITED | POST /punch | 422 EMPLOYEE_NOT_ACTIVE | — | Not Run |

---

## Section 2: Business day boundary and business date logic

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| ATT-020 | SRS Amendment A5 | Server clock used; client timestamp ignored | Employee submits with a fake timestamp | POST /punch (no `at` field) | punchedAt is the server time, not client-provided time | — | Not Run |
| ATT-021 | book ch.18 | Manager backdates a punch | Manager holds workforce.attendance.edit | POST /punch { employeeId, at, reason } | 201; source = MANAGER_EDIT; AuditLog written | — | Not Run |
| ATT-022 | book ch.18 | Manager backdating without reason is rejected | Manager holds the key | POST /punch { at } without reason | 400 VALIDATION_FAILED | — | Not Run |
| ATT-023 | book ch.18 | Manager backdating more than 7 days rejected | | POST /punch { at: 8 days ago } | 422 (date too far in past) | — | Not Run |

---

## Section 3: Break logging

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| ATT-030 | FR-EMP-002, Feature List 5.7 | Break started and ended correctly | Employee is punched IN | POST /break/start then POST /break/end | BreakLog closed; durationMins calculated; workedMins reduced | — | Not Run |
| ATT-031 | book ch.18 | Break start while not punched in rejected | No IN punch | POST /break/start | 409 ATTENDANCE_NOT_PUNCHED_IN | — | Not Run [EXISTING] |
| ATT-032 | book ch.18 | Second break start while one is open rejected | One open BreakLog | POST /break/start | 409 ATTENDANCE_BREAK_ALREADY_OPEN | — | Not Run [EXISTING] |
| ATT-033 | book ch.18 | Break end with no open break rejected | No open BreakLog | POST /break/end | 409 ATTENDANCE_BREAK_NOT_OPEN | — | Not Run [EXISTING] |
| ATT-034 | book ch.18 | Open break closed by nightly rollup | Employee punches out without ending break | Rollup runs | endedAt = lastOutAt; durationMins calculated | — | Not Run [EXISTING] |
| ATT-035 | FR-EMP-002 | Break minutes correctly subtracted from workedMins | 9-hour shift with 45min break | Complete shift with break | workedMins = grossMins - 45 | — | Not Run |

---

## Section 4: Manager attendance correction

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| ATT-040 | FR-EMP-002, book ch.18 | Manager edits an existing punch timestamp | Punch exists; manager has workforce.attendance.edit | PATCH /attendance/punches/:id { punchedAt, reason } | Punch updated; AuditLog written with before/after | — | Not Run [EXISTING] |
| ATT-041 | book ch.18 | Punch edit without reason rejected | Any punch | PATCH /attendance/punches/:id without reason | 400 VALIDATION_FAILED | — | Not Run [EXISTING] |
| ATT-042 | book ch.18 | Punch edit that reorders IN/OUT sequence rejected | Existing IN then OUT | Edit IN to be after OUT | 422 INVALID_PUNCH_SEQUENCE | — | Not Run [EXISTING] |
| ATT-043 | book ch.18 | KITCHEN_STAFF cannot edit another employee's punch | KITCHEN_STAFF token | POST /punch { employeeId: other } | 403 FORBIDDEN | — | Not Run [EXISTING] |
| ATT-044 | book ch.18 | Manager creates a punch for an employee who never punched in | Manager with edit permission | POST /punch { employeeId, direction: "IN", at, reason } | 201; source = MANAGER_EDIT; AuditLog written | — | Not Run |

---

## Section 5: Nightly rollup

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| ATT-050 | FR-EMP-002, book ch.18 | Rollup closes missing punch-out at shift end | Employee punched IN, shift scheduled, no OUT | Run rollup for that date | Synthetic OUT inserted with source SYSTEM_ROLLUP; day note flagged | — | Not Run [EXISTING] |
| ATT-051 | book ch.18 | Rollup closes missing punch-out at firstInAt+8h when no shift | Employee punched IN, no shift | Run rollup | Synthetic OUT at firstInAt + 8h | — | Not Run [EXISTING] |
| ATT-052 | book ch.18 | Rollup marks scheduled no-shows ABSENT | Employee has SCHEDULED shift, no punches | Run rollup | status = ABSENT | — | Not Run [EXISTING] |
| ATT-053 | book ch.18 | Rollup marks approved leave ON_LEAVE over ABSENT | Approved leave covers the date | Run rollup | status = ON_LEAVE | — | Not Run [EXISTING] |
| ATT-054 | book ch.18 | Rollup marks unrostered employees WEEKLY_OFF | No shift, no punches, no approved leave | Run rollup | status = WEEKLY_OFF | — | Not Run [EXISTING] |
| ATT-055 | book ch.18 | Rollup does not overwrite a day the employee worked | Employee punched in on day off | Run rollup | status = PRESENT (unchanged) | — | Not Run [EXISTING] |
| ATT-056 | book ch.18 | Rollup is idempotent | Run rollup once | Run rollup again for same date | All AttendanceDay, AttendancePunch, BreakLog rows identical | — | Not Run [EXISTING] |

---

## Section 6: Attendance history and live board

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| ATT-060 | FR-EMP-002, Feature List 5.8 | Employee views own attendance history | Employee has attendance records | GET /attendance?from=...&to=... | Returns only own rows; other employees' rows excluded | — | Not Run [EXISTING] |
| ATT-061 | FR-EMP-002, book ch.18 | Reading another employee's history is blocked | KITCHEN_STAFF token | GET /attendance?employeeId=<other> | Returns own rows only (employeeId forced) | — | Not Run [EXISTING] |
| ATT-062 | FR-EMP-002 | STORE_MANAGER views live attendance board | Manager holds workforce.attendance.read | GET /attendance/today | Returns all ACTIVE employees of the outlet with current state | — | Not Run |
| ATT-063 | book ch.18 | History request for another outlet returns 404 | STORE_MANAGER scoped to Patia | GET /attendance?outletId=<Saheed Nagar id> | 404 (not 403) | — | Not Run [EXISTING] |
| ATT-064 | Feature List 5.8 | Pending, rejected, and verified records are visually distinguishable | — | GET /attendance | Different status values for each state | — | Not Run [PROPOSED] |

---

## Section 7: Leave request workflow

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| LVE-001 | FR-EMP-003, Feature List 6.1 | Employee submits leave request | Employee is ACTIVE | POST /leave-requests { type, fromDate, toDate, reason } | 201; status = PENDING; LEAVE_REQUESTED OutboxEvent created | — | Not Run |
| LVE-002 | FR-EMP-003, book ch.19 | dayCount is inclusive | fromDate: Sep 2, toDate: Sep 4 | POST /leave-requests | dayCount = "3.0" | — | Not Run [EXISTING] |
| LVE-003 | FR-EMP-003, book ch.19 | Half day yields 0.5 | fromDate = toDate, halfDay: true | POST /leave-requests | dayCount = "0.5" | — | Not Run [EXISTING] |
| LVE-004 | FR-EMP-003 | Staff cannot backdate leave | fromDate = yesterday, staff token | POST /leave-requests | 422 LEAVE_PAST_DATE | — | Not Run [EXISTING] |
| LVE-005 | FR-EMP-003 | Manager can backdate leave for staff | Manager token | POST /leave-requests { fromDate: yesterday } | 201 | — | Not Run [EXISTING] |
| LVE-006 | FR-EMP-003 | Overlapping leave request rejected | PENDING leave exists | POST /leave-requests for overlapping dates | 409 LEAVE_OVERLAP | — | Not Run [EXISTING] |
| LVE-007 | FR-EMP-003 | Manager approves leave | Leave is PENDING | POST /leave-requests/:id/approve | 200; status = APPROVED; ON_LEAVE rows written; LEAVE_DECIDED emitted | — | Not Run [EXISTING] |
| LVE-008 | FR-EMP-003 | Approval writes ON_LEAVE for every covered date | Leave covers 3 days | POST /approve | 3 AttendanceDay rows with status ON_LEAVE | — | Not Run [EXISTING] |
| LVE-009 | FR-EMP-003, book ch.19 | Approval does not overwrite worked days | Employee worked on leave dates | POST /approve | Days with punches stay PRESENT; conflictDates in response | — | Not Run [EXISTING] |
| LVE-010 | FR-EMP-003, book ch.19 | Self-approval rejected | Manager who is also the requester | POST /approve own leave | 403 FORBIDDEN | — | Not Run [EXISTING] |
| LVE-011 | FR-EMP-003 | Manager rejects leave | Leave is PENDING | POST /leave-requests/:id/reject | 200; status = REJECTED; no attendance rows written | — | Not Run |
| LVE-012 | FR-EMP-003, book ch.19 | Employee cancels own pending request | Leave is PENDING, same employee | POST /leave-requests/:id/cancel | 200; status = CANCELLED; no notification | — | Not Run [EXISTING] |
| LVE-013 | FR-EMP-003 | Manager cancels future approved leave | Leave is APPROVED, fromDate > today | POST /cancel with manager token | 200; ON_LEAVE rows removed; LEAVE_DECIDED emitted | — | Not Run [EXISTING] |
| LVE-014 | FR-EMP-003, book ch.19 | Past approved leave cannot be cancelled | fromDate <= today | POST /cancel | 409 LEAVE_ALREADY_STARTED | — | Not Run [EXISTING] |
| LVE-015 | FR-EMP-003 | Leave history visible to employee | Employee has leave records | GET /leave-requests (self-scoped) | Own requests only; no other employee's requests | — | Not Run [EXISTING] |

---

## Section 8: RBAC and outlet scope

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| RBAC-001 | FR-AUTH-002, Feature List 2.2 | KITCHEN_STAFF cannot access another employee's attendance | KITCHEN_STAFF token | GET /attendance?employeeId=<other> | Only own rows returned | — | Not Run |
| RBAC-002 | FR-AUTH-002 | STORE_MANAGER cannot access other outlet | STM at Patia | GET /attendance?outletId=<Saheed Nagar> | 404 | — | Not Run |
| RBAC-003 | FR-AUTH-002 | STORE_MANAGER can edit punches at own outlet | STM token | PATCH /attendance/punches/:id with reason | 200; AuditLog written | — | Not Run |
| RBAC-004 | FR-AUTH-002, book ch.14 | KITCHEN_MANAGER cannot edit punches | KITCHEN_MANAGER token | PATCH /attendance/punches/:id | 403 FORBIDDEN | — | Not Run |
| RBAC-005 | FR-AUTH-002 | HR_ACCOUNTS can read salary | HR token | GET /employees/:id/salary | 200 with salary records | — | Not Run |
| RBAC-006 | FR-AUTH-002 | STORE_MANAGER cannot read salary | STM token | GET /employees/:id/salary | 403 FORBIDDEN | — | Not Run |

---

## Section 9: Location and selfie validation (PROPOSED)

> ⚠️ All tests in this section are PROPOSED per SRS Amendment v1.1. Cannot be run
> until geofence and selfie capture features are implemented.

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| GEO-001 | SRS Amendment A5 | Employee inside 150m radius can submit | Outlet has coordinates configured; employee is within 150m | POST /punch with location within radius + selfie | 201; submission accepted | — | Not Run [PROPOSED] |
| GEO-002 | SRS Amendment A5 | Employee outside 150m radius is rejected | Outlet has coordinates configured; employee is outside | POST /punch with location outside radius | 422 LOCATION_OUTSIDE_RADIUS | — | Not Run [PROPOSED] |
| GEO-003 | SRS Amendment A9 | Distance validated server-side | Client sends modified location | POST /punch with claimed location inside radius but actual location outside | Rejected — server uses submitted coordinates against outlet config | — | Not Run [PROPOSED] |
| GEO-004 | SRS Amendment A9 | Low GPS accuracy triggers recovery state | accuracy > threshold | POST /punch with low-accuracy location | Clear recoverable error; not silently accepted | — | Not Run [PROPOSED] |
| GEO-005 | SRS Amendment A5 | Selfie capture required | No selfie in request | POST /punch without selfie | 400 — selfie required | — | Not Run [PROPOSED] |
| GEO-006 | SRS Amendment A9 | Selfie stored in private bucket | Successful submission | Check storage reference | URL is not publicly accessible | — | Not Run [PROPOSED] |

---

## Section 10: Manager verification workflow (PROPOSED)

> ⚠️ All tests in this section are PROPOSED per SRS Amendment v1.1.

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| VER-001 | SRS Amendment A5 | Manager verifies a pending submission | Submission is PENDING_VERIFICATION | POST /attendance/verify/:id { decision: VERIFY } | 200; AttendanceDay updated; employee notified | — | Not Run [PROPOSED] |
| VER-002 | SRS Amendment A5 | Manager rejects with reason | Submission is PENDING_VERIFICATION | POST /verify/:id { decision: REJECT, reason } | 200; submission marked REJECTED; record kept; employee notified | — | Not Run [PROPOSED] |
| VER-003 | SRS Amendment A5 | Employee cannot verify own submission | Employee token | POST /verify own submission | 403 FORBIDDEN | — | Not Run [PROPOSED] |
| VER-004 | SRS Amendment A6 | Rejected submission not deleted | After rejection | GET /attendance | Rejected record visible in history | — | Not Run [PROPOSED] |
| VER-005 | SRS Amendment A3 | Manager cannot verify submissions from another outlet | STM at Patia | POST /verify submission from Saheed Nagar | 404 | — | Not Run [PROPOSED] |

---

## Section 11: 365-day history and percentage calculation (PROPOSED)

> ⚠️ All tests in this section are PROPOSED per SRS Amendment v1.1.

| Test ID | Requirement Reference | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status |
|---|---|---|---|---|---|---|---|
| ANL-001 | SRS Amendment A7 | Rolling 365-day history returns correct window | Employee has records for 400 days | GET /attendance/analytics?employeeId=X | Returns exactly 365 days window | — | Not Run [PROPOSED] |
| ANL-002 | SRS Amendment A7 | Zero eligible days shows N/A for percentage | Employee has no scheduled shifts | Request attendance percentage | Displays "N/A" not "0%" | — | Not Run [PROPOSED] |
| ANL-003 | SRS Amendment A7 | Approved leave reduces eligible days only on working days | Leave over a weekend | Calculate eligible days | Weekend leave days not subtracted from eligible count | — | Not Run [PROPOSED] |
| ANL-004 | SRS Amendment A7 | Pending attendance not counted as present | Submission in PENDING_VERIFICATION | Calculate percentage | Pending count does not increase present numerator | — | Not Run [PROPOSED] |
| ANL-005 | SRS Amendment A7 | Duplicate submissions do not inflate present count | Two submissions for same day | Calculate percentage | Only one present day counted | — | Not Run [PROPOSED] |

---

## Section 12: Regression — currently implemented behavior

These tests protect existing functionality during Phase 2 development.

| Test ID | Scope | Scenario | Assertion |
|---|---|---|---|
| REG-001 | `recompute()` | Closed IN/OUT pair gives correct workedMins | 09:00 to 17:00 = 480 mins |
| REG-002 | `recompute()` | Dangling IN gives workedMins = 0 | Single IN punch → workedMins = 0 |
| REG-003 | `recompute()` | Break minutes subtracted correctly | 540 gross - 45 break = 495 workedMins |
| REG-004 | `recompute()` | 10-minute grace on lateness | firstInAt 09:08 vs 09:00 shift → lateMins = 0 |
| REG-005 | `recompute()` | No shift means no lateMins | shift = null → lateMins = 0 |
| REG-006 | Leave | Approval and attendance write are atomic | Force attendance write to fail → request stays PENDING |
| REG-007 | Leave | Approval skips days with punches | Worked day stays PRESENT; conflictDates populated |
| REG-008 | Leave | Cancel removes ON_LEAVE rows | ON_LEAVE rows set to ABSENT after cancellation |
| REG-009 | RBAC | Salary not in employee payload | GET /employees/:id response has no salary field for any role |
| REG-010 | Rollup | Idempotency | Running rollup twice produces identical data |
