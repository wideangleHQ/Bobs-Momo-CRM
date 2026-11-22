# Attendance System — Workflows

All workflows reference the codebase state on the `preview` branch as of 26 October
2026. Unimplemented flows are labelled clearly.

---

## Workflow 1: Employee attendance submission (check-in)

**Endpoint:** `POST /api/v1/attendance/punch`
**Source:** `apps\api\src\modules\workforce\attendance.service.ts` — `punch()`

### Happy path

```mermaid
sequenceDiagram
    participant E as Employee (browser)
    participant API as NestJS API
    participant DB as Postgres

    E->>API: POST /attendance/punch { direction: "IN" }
    Note over E,API: Header: Idempotency-Key: <uuid>
    API->>API: Check Idempotency-Key in Redis (24h window)
    alt Key seen before
        API-->>E: 201 (replay stored response)
    else Key is new
        API->>API: Resolve employee from session token
        API->>API: toBusinessDate(now) — 04:00 IST boundary
        API->>DB: BEGIN TRANSACTION
        API->>DB: UPSERT AttendanceDay (employeeId, businessDate)
        API->>DB: SELECT AttendancePunch FOR UPDATE
        API->>API: Guard: last punch is not IN (ALREADY_PUNCHED_IN)
        API->>DB: INSERT AttendancePunch { direction: IN, source: WEB }
        API->>DB: SELECT BreakLog, Shift
        API->>API: recompute(punches, breaks, shift)
        API->>DB: UPDATE AttendanceDay (firstInAt, lateMins, status)
        API->>DB: COMMIT
        API-->>E: 201 { attendanceDay, punch }
    end
```

### Alternative paths

- **Manager punching on behalf of staff**: supply `employeeId` and optionally `at` in
  the request body. Requires `workforce.attendance.edit`. Sets `source = MANAGER_EDIT`,
  `editedById = user.sub`. Writes an `AuditLog` row.
- **Second IN with same Idempotency-Key**: interceptor replays the stored 201 —
  employee sees success without creating a second punch.

### Failure cases

| Condition | Response |
|---|---|
| No `Idempotency-Key` header | 400 `ATTENDANCE_IDEMPOTENCY_KEY_REQUIRED` (per book ch.18; code constant is `ERROR_CODES.ATTENDANCE_*`) |
| `direction = IN` and last punch is also `IN` | 409 `ATTENDANCE_ALREADY_PUNCHED_IN` |
| Employee not found or outside scope | 404 `EMPLOYEE_NOT_FOUND` |
| Employee status is `EXITED` | 422 `EMPLOYEE_NOT_ACTIVE` |

---

## Workflow 2: Location and selfie validation

> ⚠️ PROPOSED — not yet implemented in source code. Required by SRS Amendment v1.1,
> sections A5 and A9. No geofence fields exist on the `Outlet` model in
> `schema.prisma`; no selfie upload logic exists anywhere in the codebase.

### Proposed flow (SRS Amendment v1.1, section A5)

```mermaid
sequenceDiagram
    participant E as Employee (browser)
    participant GPS as Browser Geolocation API
    participant CAM as Device Camera
    participant API as NestJS API
    participant STG as Supabase Storage

    E->>GPS: navigator.geolocation.getCurrentPosition()
    GPS-->>E: { coords: { latitude, longitude, accuracy } }
    Note over E,GPS: accuracy must be within acceptable threshold
    E->>CAM: Capture fresh selfie (not gallery upload)
    CAM-->>E: photo blob
    E->>API: POST /attendance/punch {<br/>  direction: "IN",<br/>  location: { lat, lng, accuracy },<br/>  selfie: <multipart file><br/>}
    API->>API: Validate lat/lng against outlet coords + 150m radius
    alt Outside radius
        API-->>E: 422 LOCATION_OUTSIDE_RADIUS (PROPOSED error code)
    else Inside radius
        API->>STG: Upload selfie to private bucket
        STG-->>API: { privateRef }
        API->>DB: INSERT AttendancePunch { locationResult, selfieRef }
        Note over API,DB: PROPOSED new fields on AttendancePunch
    end
```

### Required schema changes (PROPOSED — not approved for implementation)

The following fields do not exist and must be designed and approved before development:

- `Outlet.latitude`, `Outlet.longitude` — outlet coordinates for server-side validation
- `AttendancePunch.latitude`, `AttendancePunch.longitude`, `AttendancePunch.locationAccuracy` — submitted location evidence
- `AttendancePunch.locationResult` — enum: `INSIDE_RADIUS | OUTSIDE_RADIUS | LOW_ACCURACY | UNAVAILABLE`
- `AttendancePunch.selfieRef` — private storage reference or URL
- `AttendancePunch.verificationStatus` — or a separate `AttendanceSubmission` table

---

## Workflow 3: Manager verification and rejection

> ⚠️ PROPOSED — the verification queue and decision endpoints do not exist in the
> current codebase. The `AttendanceDay` model has no `verificationStatus` field.

### Proposed flow (SRS Amendment v1.1, section A5, steps 8–11)

```mermaid
sequenceDiagram
    participant MGR as Store Manager
    participant API as NestJS API
    participant DB as Postgres
    participant E as Employee

    Note over DB: AttendancePunch.status = PENDING_VERIFICATION (PROPOSED)
    MGR->>API: GET /attendance/verify-queue?outletId=X
    API-->>MGR: [{ employee, photo, timestamp, locationResult }]
    MGR->>API: POST /attendance/verify/:submissionId { decision: "VERIFY" }
    API->>DB: UPDATE submission status = VERIFIED
    API->>DB: UPDATE AttendanceDay status = PRESENT (or HALF_DAY)
    API->>DB: INSERT OutboxEvent ATTENDANCE_VERIFIED (PROPOSED)
    API-->>MGR: 200 { submission, attendanceDay }
    Note over E: Employee receives in-app notification

    alt Manager rejects
        MGR->>API: POST /attendance/verify/:submissionId { decision: "REJECT", reason: "..." }
        API->>DB: UPDATE submission status = REJECTED
        Note over DB: Rejected record is KEPT for audit per SRS Amendment A6
        API->>DB: AttendanceDay.status stays ABSENT (nightly rollup handles this)
        API->>DB: INSERT OutboxEvent ATTENDANCE_REJECTED (PROPOSED)
        API-->>MGR: 200
        Note over E: Employee sees rejection reason
    end
```

---

## Workflow 4: Check-in / Check-out lifecycle

**Source:** `attendance.service.ts` — `punch()`, `recompute()`

```mermaid
stateDiagram-v2
    [*] --> NOT_PRESENT: Business day starts (04:00 IST)
    NOT_PRESENT --> PUNCHED_IN: POST /punch { direction: "IN" }
    PUNCHED_IN --> ON_BREAK: POST /break/start
    ON_BREAK --> PUNCHED_IN: POST /break/end
    PUNCHED_IN --> PUNCHED_OUT: POST /punch { direction: "OUT" }
    PUNCHED_OUT --> PUNCHED_IN: POST /punch { direction: "IN" } (second segment)
    PUNCHED_OUT --> DAY_CLOSED: Nightly rollup at 03:45 IST

    note right of NOT_PRESENT
        AttendanceDay.status = ABSENT
    end note
    note right of PUNCHED_IN
        AttendanceDay.status = PRESENT or HALF_DAY
        (from recompute)
    end note
    note right of DAY_CLOSED
        Rollup closes open breaks,
        inserts synthetic OUT if needed,
        marks ABSENT/ON_LEAVE/WEEKLY_OFF
    end note
```

### Rules verified in code

- An `IN` after an `IN` is rejected: 409 `ATTENDANCE_ALREADY_PUNCHED_IN`
- An `OUT` without a preceding `IN` is rejected: 409 `ATTENDANCE_NOT_PUNCHED_IN`
- Multiple IN/OUT pairs per day are allowed (split shifts)
- Business day boundary: 04:00 IST (`toBusinessDate()` in `@bobs-momo/shared`)
- Server clock is always used for `punchedAt`; client-supplied timestamps are only
  accepted from managers with `workforce.attendance.edit` and require a `reason`

---

## Workflow 5: Break logging

**Source:** `attendance.service.ts` — `startBreak()`, `endBreak()`

### Happy path

```mermaid
sequenceDiagram
    participant E as Employee
    participant API as NestJS API
    participant DB as Postgres

    E->>API: POST /attendance/break/start { reason?: "..." }
    API->>DB: Find AttendanceDay for today
    API->>API: Guard: last punch is IN (employee is in)
    API->>API: Guard: no open BreakLog
    API->>DB: INSERT BreakLog { startedAt: now, endedAt: null }
    API->>API: recompute(day) — no change to workedMins yet
    API-->>E: 200 { attendanceDay }

    E->>API: POST /attendance/break/end
    API->>DB: Find open BreakLog
    API->>DB: UPDATE BreakLog { endedAt: now, durationMins: diffMins }
    API->>API: recompute(day) — breakMins rises, workedMins falls
    API-->>E: 200 { attendanceDay }
```

### Failure cases

| Condition | Response |
|---|---|
| Break start while not punched in | 409 `ATTENDANCE_NOT_PUNCHED_IN` |
| Second break start while one is open | 409 `ATTENDANCE_BREAK_ALREADY_OPEN` |
| Break end with no open break | 409 `ATTENDANCE_BREAK_NOT_OPEN` |

### Nightly rollup behaviour

If a break is still open at 03:45 IST, the rollup closes it:
- `endedAt = day.lastOutAt` (if there is a punch-out)
- `endedAt = shift.endsAt` (if no punch-out but a shift exists)
- `endedAt = startedAt` (if neither exists — zero duration)

---

## Workflow 6: Attendance history and percentage calculation

**Endpoints:** `GET /attendance`, `GET /attendance/summary`
**Source:** `attendance.service.ts` — `list()`

### History query

```
GET /attendance?from=2026-10-01&to=2026-10-26&outletId=X&employeeId=Y
```

- Self-scoped users have `employeeId` forced to their own id
- Date range limited to 92 days per query (see `attendanceHistoryQuery` in book ch.18)
- Returns `AttendanceDay` rows with employee info, but NOT the raw punches

### Attendance percentage calculation (from SRS Amendment v1.1, section A7)

```
Eligible Days = Scheduled Working Days − Approved Leave Days − Other Non-working Days
Attendance % = (Verified Present Days ÷ Eligible Days) × 100
```

> ⚠️ PROPOSED — The 365-day rolling analytics endpoint described in Amendment v1.1
> (section A7) is NOT YET IMPLEMENTED. There is no endpoint returning:
> - Rolling 365-day window
> - Eligible days calculation
> - Monthly trend
> - Pending/rejected submission counts
>
> The current `GET /attendance/summary` returns monthly figures per employee (per
> book ch.18) but does not implement the amendment's analytics requirements.

**Key rules (from Amendment v1.1):**
- Only verified present days count as present (pending does not)
- Approved leave reduces eligible days only on scheduled working days
- Pending/rejected leave does NOT reduce eligible days
- Future scheduled days are NOT absences
- If eligible days = 0, display "N/A" not 0%
- Prevent duplicate submissions from inflating present-day totals

---

## Workflow 7: Leave and attendance interaction

**Source:** `leave.service.ts` — `decide()`, `writeLeaveDays()`, `cancel()`

### Leave approval → attendance update (one transaction)

```mermaid
sequenceDiagram
    participant MGR as Store Manager
    participant API as NestJS API
    participant DB as Postgres
    participant E as Employee

    MGR->>API: POST /leave-requests/:id/approve
    API->>DB: BEGIN TRANSACTION
    API->>DB: SELECT LeaveRequest FOR UPDATE
    API->>API: Assert status = PENDING
    API->>DB: UPDATE LeaveRequest { status: APPROVED, decidedById, decidedAt }
    loop For each date in [fromDate..toDate]
        API->>DB: UPDATE AttendanceDay { status: ON_LEAVE } WHERE status = ABSENT
        alt Day has no ABSENT row yet
            API->>DB: UPSERT AttendanceDay { status: ON_LEAVE }
        end
        Note over API,DB: Days with punches (PRESENT/HALF_DAY) are NOT overwritten
    end
    API->>DB: INSERT OutboxEvent LEAVE_DECIDED
    API->>DB: COMMIT
    API-->>MGR: 200 { leaveRequest, attendanceDaysWritten }
    Note over E: Employee receives LEAVE_DECIDED notification
```

### Leave cancellation → attendance rollback

When a manager cancels a future APPROVED leave:
- `AttendanceDay` rows with `status = ON_LEAVE` for that employee in the date range
  are set back to `ABSENT`
- If dates are in the future, the nightly rollup will re-evaluate them correctly

**Half-day approval** does NOT write `ON_LEAVE`. The day's status comes from the
punch recompute. Only a note referencing the leave ID is written to the day row.

---

## Workflow 8: Error and retry handling

| Scenario | Current handling |
|---|---|
| Network timeout on punch | Idempotency-Key: client retries with same key, interceptor replays stored 201 |
| Double-tap on the punch button | Same Idempotency-Key from the same attempt; replay wins |
| Staff member never punches out | Rollup at 03:45 inserts a `SYSTEM_ROLLUP` OUT; day is flagged in `AttendanceDay.note` |
| Break left open overnight | Rollup closes it at `lastOutAt` or shift end |
| Location permission denied | PROPOSED: clear recoverable error shown; employee cannot submit without location |
| Camera permission denied | PROPOSED: clear recoverable error shown; employee cannot submit without selfie |
| Selfie upload failure | PROPOSED: must not show false success; retry the upload only, not create a duplicate record |
| Manager verifies a record employee has already had verified | PROPOSED: idempotency check on verification |
