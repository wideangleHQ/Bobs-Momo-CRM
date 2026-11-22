# Attendance System — Edge Cases

Each case identifies: **Current implementation behavior** (cite file+function),
**Intended SRS/Amendment behavior**, and **Gap** (if any).

Legend: IMPL = currently implemented; GAP = difference between SRS and code;
PROPOSED = from SRS Amendment v1.1, not yet in code.

---

## A. Location edge cases

1. **Employee inside the 150m radius**
   - Current: No geofence check exists in any service file.
   - SRS Amendment A5: Server must validate distance using outlet coordinates.
   - Gap: PROPOSED — geofence validation not implemented.

2. **Employee just outside the 150m radius (e.g., 160m)**
   - Current: No check — punch accepted without location.
   - SRS Amendment A5: Must be rejected with a clear, recoverable error.
   - Gap: PROPOSED.

3. **Employee claims to be inside radius but is actually outside (GPS spoofing)**
   - Current: Not addressed (no location capture at all).
   - SRS Amendment A9: "Browser GPS and selfie evidence reduce fraud but do not
     guarantee resistance to GPS spoofing." System must not claim biometric
     verification.
   - Gap: PROPOSED — server-side validation would catch basic spoofing but not
     sophisticated attacks. Amendment acknowledges this limitation.

4. **Location permission denied by employee**
   - Current: No frontend GPS capture exists.
   - SRS Amendment A5: Provide clear, recoverable message. Cannot silently proceed.
   - Gap: PROPOSED.

5. **GPS accuracy too low (reported accuracy > threshold, e.g., 500m circle)**
   - Current: No accuracy check.
   - SRS Amendment A9: "Provide clear recovery states for ... low accuracy."
   - Gap: PROPOSED — accuracy threshold value not defined in amendment.

6. **GPS signal unavailable (airplane mode, building interference)**
   - Current: Not applicable (no location capture).
   - SRS Amendment A5, A9: Must provide a recovery state. A failed GPS should
     allow retry, not silently create verified attendance.
   - Gap: PROPOSED.

7. **Employee is at the correct outlet building but geofence center is set incorrectly**
   - Current: No outlet coordinates in Outlet model (`schema.prisma` verified).
   - SRS Amendment A10: Outlet coordinates must be in the system.
   - Gap: PROPOSED — no `latitude`/`longitude` fields on `Outlet`.

8. **Outlet coordinates have not been configured**
   - Current: No coordinates field; no validation possible.
   - SRS Amendment: Server must validate against configured outlet coordinates.
   - Gap: PROPOSED — what happens if coordinates are null is not specified.

9. **Employee on a break near the outlet boundary goes outside to get food**
   - Current: Break logging does not check location.
   - SRS Amendment: Only the check-in/check-out events require location.
   - Gap: None — break logging has no location requirement per the amendment.

10. **Employee submits location from a different outlet's address**
    - Current: No check.
    - SRS Amendment A5: Server resolves the employee's assigned outlet from the
      session token; does not trust client-supplied outlet IDs.
    - Gap: PROPOSED.

11. **Employee works a shift covering two physical locations in one day**
    - Current: AttendanceDay is one row per employee per business date; not per location.
    - SRS: Not addressed in the amendment (single-outlet employee model assumed).
    - Gap: None identified for Phase 1 (2 fixed outlets, each employee has one outletId).

12. **New outlet opens with no configured coordinates**
    - Current: No coordinates field.
    - SRS Amendment: Geofence relies on configured coordinates.
    - Gap: PROPOSED — absence of coordinates must be handled gracefully.

13. **Location accuracy is reported as null by the browser**
    - Current: Not applicable.
    - SRS Amendment A9: Low accuracy must have a recovery state.
    - Gap: PROPOSED — null accuracy should be treated as low accuracy.

14. **Employee uses a VPN that reports a different location**
    - Current: Not applicable.
    - SRS Amendment A9: GPS spoofing acknowledged as a limitation.
    - Gap: None — amendment explicitly acknowledges this limitation.

15. **Employee switches to desktop browser (no GPS)**
    - Current: No GPS capture required.
    - SRS Amendment A5: Location is captured from device.
    - Gap: PROPOSED — desktop browsers may have no GPS; how to handle is unspecified.

---

## B. Selfie/evidence edge cases

1. **Employee submits a fresh selfie from device camera**
   - Current: No photo capture in any attendance endpoint.
   - SRS Amendment A5: Fresh capture is required; gallery upload is not equivalent.
   - Gap: PROPOSED.

2. **Employee uploads a photo from the gallery instead of taking a fresh selfie**
   - Current: No enforcement possible (no photo capture at all).
   - SRS Amendment A5: "Gallery upload is not equivalent to fresh capture unless
     separately approved."
   - Gap: PROPOSED — enforcement mechanism not specified.

3. **Camera permission denied**
   - Current: Not applicable.
   - SRS Amendment A5, A9: Must provide clear, recoverable error.
   - Gap: PROPOSED.

4. **Selfie upload fails mid-way (network error)**
   - Current: No upload logic exists.
   - SRS Amendment v1.1 general: Must not show false success.
   - Feature List ch.13.3: "If a request or file upload fails, the interface must
     not display a false success state."
   - Gap: PROPOSED.

5. **Selfie is too dark or blurry (low quality)**
   - Current: Not applicable.
   - SRS Amendment A9: Does not require automated quality check; this is for
     manager review.
   - Gap: None — manager decides quality during verification.

6. **Employee submits a photo of a different person**
   - Current: Not applicable.
   - SRS Amendment A9: "The selfie is evidence for review; this requirement does
     not itself mean that facial recognition or biometric identity verification is
     performed."
   - Gap: None — amendment explicitly excludes biometric verification.

7. **Selfie file is too large**
   - Current: No upload exists; no size limit defined.
   - Gap: PROPOSED — file size limit must be specified.

8. **Selfie is a screenshot of a photo rather than a live capture**
   - Current: Not applicable.
   - SRS Amendment A5: Browser camera capture is required; cannot guarantee
     liveness without separate implementation.
   - Gap: None — amendment acknowledges this limitation.

9. **Employee tries to reuse a previous selfie**
   - Current: No deduplication possible (no photos stored).
   - SRS Amendment A5: "Fresh capture" is required.
   - Gap: PROPOSED — technical enforcement of freshness is not specified.

10. **Selfie stored in a public bucket (privacy violation)**
    - Current: No photo storage.
    - SRS Amendment A9: "Store selfies privately or use protected file references;
      do not expose permanent public URLs."
    - Gap: PROPOSED — must use Supabase private bucket.

11. **Selfie reference URL expires**
    - Current: Not applicable.
    - SRS Amendment A9: Photo must be accessible to the manager during review.
    - Gap: PROPOSED — signed URL expiry strategy not defined.

12. **Employee deletes or overrides their selfie after submission**
    - Current: Not applicable.
    - SRS Amendment A9: "Keep rejected records for accountability; do not silently
      delete or overwrite historical decisions."
    - Gap: PROPOSED.

13. **Photo is uploaded but the attendance record fails to save**
    - Current: No upload exists.
    - Feature List ch.13.3: Must not show false success; retry must not create
      duplicate records.
    - Gap: PROPOSED — transaction design must handle this.

14. **Manager cannot view the selfie (link broken, storage error)**
    - Current: Not applicable.
    - SRS Amendment: Manager must be able to review evidence before verifying.
    - Gap: PROPOSED.

---

## C. Submission lifecycle edge cases

1. **Employee submits attendance twice on the same business day (duplicate)**
   - Current: The Idempotency-Key prevents duplicate API calls. However, if the
     employee submits a second IN after a valid OUT (second shift segment), that is
     allowed per `punch()` in `attendance.service.ts` (last punch must be OUT).
   - SRS Amendment A7: "Prevent duplicate submissions from inflating present-day
     totals."
   - Gap: For multi-segment shifts, the `AttendanceDay.uniqueOn(employeeId, businessDate)`
     constraint ensures one summary row. This is handled correctly.

2. **Employee submits an IN punch at 01:15 IST (should belong to previous business day)**
   - Current: `toBusinessDate()` correctly assigns to the previous date.
     Tested in `attendance.e2e-spec.ts`.
   - Gap: None — IMPL.

3. **Employee submits attendance with a client-supplied timestamp in the past**
   - Current: Server always uses `new Date()` unless a manager supplies `at`.
     Client-supplied timestamps are ignored.
   - Gap: None — IMPL.

4. **Two taps on the punch button arrive 80ms apart (race condition)**
   - Current: `SELECT ... FOR UPDATE` on punches within the transaction serialises
     concurrent writes. Idempotency-Key also protects at a higher level.
   - Gap: None — IMPL.

5. **Employee punches OUT before punching IN**
   - Current: 409 `ATTENDANCE_NOT_PUNCHED_IN`.
   - Gap: None — IMPL.

6. **Employee punches IN twice without an OUT**
   - Current: 409 `ATTENDANCE_ALREADY_PUNCHED_IN`.
   - Gap: None — IMPL.

7. **Employee with no Employee row tries to punch in (User without Employee link)**
   - Current: `resolveEmployee()` throws 403 `FORBIDDEN` ("This account is not
     linked to an employee record").
   - Gap: None — IMPL.

8. **Employee whose status is EXITED tries to punch in**
   - Current: 422 `EMPLOYEE_NOT_ACTIVE`.
   - Gap: None — IMPL.

9. **Employee moves to a different outlet mid-month**
   - Current: Old `AttendanceDay` rows keep the original `outletId`. The board and
     history read `AttendanceDay.outletId`, not `Employee.outletId`.
   - Gap: None — IMPL. Documented in book ch.18.

10. **Employee submits attendance for a business date with an existing ABSENT row (from rollup)**
    - Current: The upsert in `punch()` updates the existing row; `status` is
      recomputed to PRESENT.
    - Gap: None — IMPL.

11. **Rollup runs twice on the same date (idempotency)**
    - Current: All rollup steps are idempotent. Documented in book ch.18.
    - Gap: None — IMPL.

12. **Server clock and database clock are skewed**
    - Current: `punchedAt = new Date()` uses the application server clock.
      Supabase uses its own clock for `createdAt`. Minor skew is acceptable.
    - Gap: Minor — no NTP synchronisation check, but Railway containers should
      be well-synced.

13. **Employee submits attendance on a public holiday**
    - Current: No holiday calendar exists. An employee who punches in on any day
      gets a PRESENT day. Nightly rollup only marks WEEKLY_OFF if there is no
      shift AND no punches.
    - SRS: No holiday calendar defined for Phase 1.
    - Gap: None for Phase 1 — holiday calendar is out of scope.

14. **Idempotency-Key is missing from the punch request**
    - Current: Book ch.18 states 400 `ATTENDANCE_IDEMPOTENCY_KEY_REQUIRED`.
    - Gap: Need to verify this error code is actually in the controller code (not
      read in this phase — INFERRED NOT VERIFIED).

15. **Attendance submission arrives during a Railway deploy (container restart)**
    - Current: Transactional outbox pattern means the business row and notification
      intent are committed together. No data loss.
    - Gap: None for data integrity — IMPL.

---

## D. Manager verification edge cases (PROPOSED)

> All items in this section are PROPOSED per SRS Amendment v1.1. No verification
> endpoint or queue exists in the current codebase.

1. **Manager verifies a submission that has already been verified by another manager**
   - SRS Amendment A11: Idempotency protection required.
   - Gap: PROPOSED.

2. **Manager rejects a submission without providing a reason**
   - SRS Amendment A5: "Recording a reason for rejection."
   - Gap: PROPOSED — reason field must be required on rejection.

3. **Employee tries to self-verify their own submission**
   - SRS Amendment A5: "Employees cannot verify their own submissions."
   - Gap: PROPOSED — server must check actor is not the submitting employee.

4. **Manager at Outlet A tries to verify a submission from Outlet B**
   - SRS Amendment A3: "Store Managers must not access records outside their
     authorized outlet scope."
   - Gap: PROPOSED — outlet scope check on verification endpoint.

5. **Manager accidentally verifies the wrong submission**
   - SRS Amendment A6: "Do not silently delete or overwrite rejected records."
   - Gap: PROPOSED — no undo path defined; amendment does not specify one.

6. **Submission is in PENDING_VERIFICATION for 3 days with no manager action**
   - SRS: No escalation timeout defined in the amendment.
   - Gap: PROPOSED — whether a notification is resent after a timeout is undefined.

7. **Employee submits again after a rejection**
   - SRS Amendment A5, A11: "Any correction/resubmission requires manager-controlled
     review."
   - Gap: PROPOSED — the mechanism for resubmission is not designed.

8. **Manager queue shows 0 pending submissions but employee app shows PENDING**
   - Potential race condition on status update.
   - Gap: PROPOSED — state consistency between employee view and manager queue.

9. **Rejected submission is displayed in attendance history**
   - SRS Amendment A10: "Pending, rejected, and verified records must be visually
     distinguishable."
   - Gap: PROPOSED — UI differentiation not in current frontend.

10. **Verification is attempted after the business day has closed**
    - SRS Amendment: Does not prohibit late verification.
    - Gap: PROPOSED — decision whether same-day-only or retroactive verification.

11. **Manager verifies a submission where the selfie cannot be loaded**
    - SRS Amendment: Manager should review evidence before verifying.
    - Gap: PROPOSED — should verification be blocked or warned?

12. **Two managers are online simultaneously and both click Verify on the same record**
    - SRS Amendment A11: "Use duplicate/idempotency protection for attendance
      submission and decisions where supported by the architecture."
    - Gap: PROPOSED — `SELECT FOR UPDATE` pattern from leave service should be
      applied to verification decisions.

13. **Rejected submission is retrieved by a role with only `workforce.attendance.read`**
    - SRS Amendment A9: "Limit photo/location access to the employee and authorized
      management roles."
    - Gap: PROPOSED — privacy of selfie and location must be enforced at the API.

14. **Verification decision notification fails to deliver via WhatsApp**
    - Current general: OutboxEvent pattern ensures at-least-once delivery to in-app;
      WhatsApp failure does not affect the business record.
    - Gap: None in principle — same outbox pattern would apply to this new event.

---

## E. Check-in / Check-out edge cases (15 cases)

1. **Employee punches out after more than 16 hours of work**
   - Current: No maximum shift duration check on punches. Only `createShiftBody`
     enforces 16-hour limit on shifts, not on punches.
   - Gap: Minor — punch can record a 24h worked day if the employee never punches out
     and the rollup uses `firstInAt + 8h` as the synthetic OUT.

2. **Employee punches out at exactly 04:00 IST (business day boundary)**
   - Current: The punch at exactly 04:00 IST belongs to the NEW business day because
     `toBusinessDate()` uses >= 04:00.
   - Gap: Potential — a closing-shift OUT at exactly 04:00 would be attributed to the
     wrong day. In practice, the rollup at 03:45 would have already closed the day.

3. **Employee punches IN at 23:55 and OUT at 00:15 (straddles midnight)**
   - Current: Both punches belong to the same business date (before 04:00 IST = same
     business date). `toBusinessDate()` handles this correctly.
   - Gap: None — IMPL.

4. **Employee punches out before punching in (day started by rollup with ABSENT)**
   - Current: The day row exists (ABSENT) but has no IN punch, so OUT is rejected
     with 409 `ATTENDANCE_NOT_PUNCHED_IN`.
   - Gap: None — IMPL.

5. **Employee has an open punch from a previous day that was never closed**
   - Current: The nightly rollup closes it. The current day's punch is on the new
     `AttendanceDay` row.
   - Gap: None — IMPL.

6. **Manager backdates a punch to before the business day started (e.g., 03:30 IST for the same business date)**
   - Current: The edit endpoint allows punches within the business date. The business
     date boundary means 03:30 IST is the PREVIOUS business date. So the punch would
     be placed on the wrong day if the manager uses the literal time.
   - Gap: Potential — validation in `editPunchBody` says "must stay inside the punch's
     own business date" but the mapping to IST boundaries may confuse managers.

7. **Two employees share a device and both punch in within seconds of each other**
   - Current: Each punch is scoped to `employeeId`. Separate transactions.
   - Gap: None — IMPL.

8. **Employee punches in via browser on phone, then tries to punch out on desktop**
   - Current: Session is bearer-token based; both actions go to the same API and same
     employee record. Works correctly.
   - Gap: None.

9. **Employee has no scheduled shift and punches in anyway**
   - Current: Fully allowed. `lateMins = 0`. Day is PRESENT.
     Documented in book ch.18: "An unrostered employee who turns up and works is not
     late, and is not absent."
   - Gap: None — IMPL.

10. **Shift is cancelled after the employee has already punched in**
    - Current: The recompute re-reads the SCHEDULED shift. A CANCELLED shift is not
      returned by `shift.findFirst({ where: { status: 'SCHEDULED' } })`, so
      `lateMins` becomes 0 for that day.
    - Gap: None — minor cosmetic change (lateMins disappears after shift cancellation).

11. **Manager punches in for an employee using a backdated timestamp that crosses midnight**
    - Current: `at` is accepted and `toBusinessDate(at)` is used to find the correct
      business date. If `at` is before 04:00 IST, it maps to the previous business date.
    - Gap: None in principle, but confusing UX.

12. **Employee uses browser autofill to resubmit a form (double submission)**
    - Current: Idempotency-Key prevents the actual API duplicate.
    - Gap: None at the API layer.

13. **Last punch for the day is an OUT, then employee punches IN again (next segment)**
    - Current: Allowed — the guard only rejects IN when the last punch is also IN.
      Multiple IN/OUT pairs per day are valid.
    - Gap: None — IMPL.

14. **Employee status changes from ACTIVE to ON_NOTICE mid-shift**
    - Current: ON_NOTICE does not disable any attendance operations. Employee can
      still punch in and out normally.
    - Gap: None — IMPL. Book ch.18 states this explicitly.

15. **Employee status changes to EXITED while clocked in**
    - Current: The exit transaction sets `User.status = DISABLED` and deletes refresh
      tokens, so the next API call will return 401 (session expired). Any further
      punch attempts will fail.
    - Gap: None — IMPL (the open punch is not forcibly closed; the rollup handles it).

---

## F. Break edge cases (11 cases)

1. **Break started while not punched in**
   - Current: 409 `ATTENDANCE_NOT_PUNCHED_IN`.
   - Gap: None — IMPL.

2. **Second break started while one is already open**
   - Current: 409 `ATTENDANCE_BREAK_ALREADY_OPEN`.
   - Gap: None — IMPL.

3. **Break end called with no open break**
   - Current: 409 `ATTENDANCE_BREAK_NOT_OPEN`.
   - Gap: None — IMPL.

4. **Break is left open when employee punches out**
   - Current: The nightly rollup closes it at `lastOutAt`. An immediate fix is not
     applied when the OUT punch is recorded — only the rollup handles this.
   - Gap: Minor — an open break during checkout gives incorrect `workedMins` until
     the rollup runs. The board shows the open break state.

5. **Employee takes a break that is longer than their entire shift**
   - Current: `workedMins = max(0, grossMins - breakMins)`. If breakMins > grossMins,
     workedMins = 0.
   - Gap: None — by design; workedMins cannot go negative.

6. **Break started just before midnight (crosses 04:00 IST boundary)**
   - Current: `startedAt` is recorded on the current day. The rollup closes it using
     that day's `lastOutAt`. The new business day's attendance is separate.
   - Gap: None in principle.

7. **Manager tries to end an employee's break on their behalf**
   - Current: `endBreak()` takes no `employeeId` parameter; it always resolves to
     `scope.selfEmployeeId`. Managers cannot end another employee's break via this
     endpoint.
   - Gap: This is undocumented behaviour — managers may need this capability in practice.

8. **Two break end requests arrive simultaneously (race condition)**
   - Current: The transaction finds the open BreakLog and updates it. If both
     transactions find the same open break, the second `UPDATE` would find
     `endedAt` already set (depending on isolation level).
   - Gap: Minor — not explicitly protected with `FOR UPDATE` on BreakLog rows.

9. **Break duration is calculated as negative (clock skew between calls)**
   - Current: `diffMins` returns `max(0, ...)` — cannot be negative.
   - Gap: None — IMPL.

10. **Break reason is not provided**
    - Current: `reason` is optional in `startBreak()`.
    - Gap: None — optional by design.

11. **Multiple breaks in a day — total break time subtracted correctly**
    - Current: `recompute()` sums `durationMins` across all BreakLog rows for the day.
      Verified: `const breakMins = breaks.reduce(...)`.
    - Gap: None — IMPL.

---

## G. Timezone and workday boundary edge cases

1. **Punch at exactly 04:00:00 IST**
   - Current: `toBusinessDate()` with `>=` boundary means 04:00:00 belongs to the NEW
     business date.
   - Gap: INFERRED — exact boundary behavior of `toBusinessDate` not verified from the
     implementation source; confirm the `>=` vs `>` comparison.

2. **Server timezone differs from IST**
   - Current: The API is on Railway. `toBusinessDate()` uses `Asia/Kolkata` timezone.
   - Gap: None if the implementation is correct.

3. **Daylight saving time (India does not observe DST)**
   - Current: India uses a single fixed offset (UTC+5:30). No DST handling needed.
   - Gap: None.

---

## H. Attendance history and 365-day window

1. **Current history query is limited to 92 days per request**
   - Current: `attendanceHistoryQuery` enforces `daysBetween(from, to) <= 92`.
   - SRS Amendment A7: "Rolling 365-day history window."
   - Gap: The 365-day requirement needs a dedicated endpoint or pagination strategy.
     The current query covers 92 days max per call.

2. **History for an employee who moved outlets is split across outlets**
   - Current: `AttendanceDay.outletId` is frozen at write time.
     `GET /attendance?employeeId=X` returns records from both outlets.
   - Gap: None — this is correct behavior.

---

## I. Percentage calculation edge cases (20+ cases)

1. **No eligible working days in the selected period**
   - SRS Amendment A7: "If eligible days are zero, display N/A rather than 0%."
   - Current: No percentage endpoint exists. Not IMPL.
   - Gap: PROPOSED.

2. **Pending attendance is counted as present**
   - SRS Amendment A7: "Pending submissions are not present and must not automatically
     be counted as absent."
   - Current: No pending state in schema. In the current model, a punch = PRESENT
     (no pending concept exists yet).
   - Gap: PROPOSED — once verification is added, pending must not count as present.

3. **Rejected submission counted as absent**
   - SRS Amendment A7: "Rejected submissions do not count as present."
   - Current: No rejected submission state exists.
   - Gap: PROPOSED.

4. **Employee has approved leave on a non-scheduled day**
   - SRS Amendment A7: "Approved leave reduces eligible working days only for
     applicable scheduled working days."
   - Current: `writeLeaveDays()` writes ON_LEAVE for every calendar day in the range,
     regardless of whether the employee had a scheduled shift.
   - Gap: The current implementation does not filter by scheduled days when writing
     ON_LEAVE. This means a 3-day leave over a weekend would mark all 3 days ON_LEAVE
     even if Saturday and Sunday are normally weekly off. The attendance percentage
     calculation should only subtract scheduled working days, not all leave days.

5. **Employee with zero scheduled shifts in a month**
   - SRS Amendment A7: Eligible days would be 0. Display N/A.
   - Current: No percentage calculation endpoint. Gap: PROPOSED.

6. **Employee with a half-day approved leave**
   - Current: `writeLeaveDays()` skips half-day approvals (does not write ON_LEAVE).
     Only the note is written. This is correct per the leave service.
   - Gap: None for the leave side. How a half-day affects eligible-day denominator
     is not specified in the amendment (it says 0.5 days of leave). OPEN DECISION.

7. **Multiple attendance records in a day (duplicate protection)**
   - SRS Amendment A7: "Prevent duplicate submissions from inflating present-day totals."
   - Current: `@@unique([employeeId, businessDate])` on AttendanceDay prevents
     multiple summary rows. Only one PRESENT day per employee per date.
   - Gap: None — IMPL.

8. **Future scheduled days are not counted as absences**
   - SRS Amendment A7: "Future scheduled days are not absences."
   - Current: The rollup only runs for `toBusinessDate(now)` — it only marks past
     days. Future days have no ABSENT row unless the rollup has run.
   - Gap: None — IMPL.

9. **Employee joined mid-month**
   - SRS Amendment A7: Eligible days should start from `joinedOn`.
   - Current: No percentage endpoint. Gap: PROPOSED — `joinedOn` must be considered
     in eligible day calculation.

10. **Employee exited mid-month**
    - SRS Amendment: Eligible days should end at `exitedOn`.
    - Current: No percentage endpoint. Gap: PROPOSED.

11. **Attendance percentage for a partial day (HALF_DAY status)**
    - SRS Amendment: "If multiple shifts exist, use the actual shift model rather than
      counting raw punch events as separate present days."
    - Current: HALF_DAY is a status that contributes to absence analysis but not
      clearly defined as 0.5 present days.
    - Gap: PROPOSED — how HALF_DAY contributes to the percentage numerator is unspecified.

12-20: See [attendance-open-decisions.md](attendance-open-decisions.md) for the full
list of unresolved calculation questions (holiday calendar, HALF_DAY treatment,
multi-shift days, etc.).

---

## J. Leave interaction edge cases (13 cases)

1. **Leave approved over days the employee actually worked**
   - Current: `writeLeaveDays()` only writes ON_LEAVE where status is ABSENT.
     If the employee worked, the PRESENT status is not overwritten.
     `conflictDates` array returned in response.
   - Gap: None — IMPL. (Note: implementation is `updateMany WHERE status = ABSENT`,
     which is more selective than just checking for punches).

2. **Half-day leave approved — full-day ON_LEAVE written**
   - Current: Half-day approval writes only the note; status is not set to ON_LEAVE.
   - Gap: None — IMPL. Correctly handled in `writeLeaveDays()`.

3. **Leave is approved for a future date that has no AttendanceDay row**
   - Current: An upsert creates the row with `status = ON_LEAVE`.
   - Gap: None — IMPL.

4. **Leave is cancelled after the nightly rollup has already run for those dates**
   - Current: `cancel()` sets ON_LEAVE rows back to ABSENT via `updateMany`.
     The nightly rollup on the next night will re-mark them.
   - Gap: None for future dates. For past dates, cancelled approved leave is blocked
     by `LEAVE_ALREADY_STARTED`.

5. **Employee submits a new leave request that overlaps with a REJECTED leave**
   - Current: Rejected leaves do NOT block new requests. The overlap check only
     covers PENDING and APPROVED.
   - Gap: None — IMPL.

6. **Employee submits leave backdated to yesterday**
   - Current: Blocked with 422 `LEAVE_PAST_DATE` unless the actor holds
     `workforce.leave.decide`.
   - Gap: None — IMPL.

7. **Manager files backdated sick leave for an employee**
   - Current: Allowed for holders of `workforce.leave.decide`. The `canDecide`
     flag is passed from the controller.
   - Gap: None — IMPL.

8. **Leave request is more than 180 days in the future**
   - Current: 422 `LEAVE_WINDOW_EXCEEDED`.
   - Gap: None — IMPL.

9. **Employee cancels leave that has already started (fromDate = today)**
   - Current: 409 `LEAVE_ALREADY_STARTED` for APPROVED leave where `fromDate <= today`.
   - Gap: None — IMPL.

10. **Two managers approve the same leave request simultaneously**
    - Current: `updateMany({ where: { id, status: 'PENDING' } })` — only one will
      update count=1; the other gets count=0 and throws `LEAVE_NOT_PENDING`.
    - Gap: None — IMPL.

11. **Employee self-approves their own leave (manager who is also an employee)**
    - Current: `leave.service.ts` does NOT check `user.sub !== leave.decidedById`.
    - Gap: Book ch.19 states: "The decider may not be the requesting employee, even if
      they hold the key, and the check is on `Employee.id` not `User.id`." This check
      is documented in the book but its presence in the actual `decide()` function was
      NOT verified from the source code read. INFERRED NOT VERIFIED.

12. **Leave approved → ON_LEAVE written → leave approval transaction rolls back**
    - Current: Both writes are in the same `$transaction`. If either fails, both roll
      back.
    - Gap: None — IMPL. Tested in `leave.e2e-spec.ts`.

13. **Approved leave days count is 3 calendar days but only 1 is a working day**
    - Current: `dayCount` is calendar days inclusive, not working days.
      SRS ch.19: "The count is calendar days, inclusive, weekly offs included."
    - Gap: None — by explicit design decision documented in book ch.19.

---

## K. Permission edge cases (15 cases)

1. **KITCHEN_MANAGER tries to edit another employee's punch**
   - Current: `workforce.attendance.edit` is not granted to KITCHEN_MANAGER in the
     RBAC matrix. 403 FORBIDDEN.
   - Gap: None — IMPL per `14-rbac-and-permissions.md`.

2. **KITCHEN_STAFF supplies employeeId of another employee on the punch endpoint**
   - Current: `resolveEmployee()` checks `scope.selfEmployeeId !== employeeId` and
     returns 404 NOT_FOUND.
   - Gap: None — IMPL.

3. **STORE_MANAGER at Patia accesses attendance records for Saheed Nagar**
   - Current: `OutletGuard` restricts to `OWN_OUTLET`. Records for a different outlet
     return 404.
   - Gap: None — IMPL.

4. **HR_ACCOUNTS reads salary for any outlet**
   - Current: `workforce.salary.read` is ALL_OUTLETS for HR_ACCOUNTS.
   - Gap: None — IMPL.

5. **OPERATIONS_MANAGER reads salary**
   - Current: Not granted. `workforce.salary.read` is only for OWNER and HR_ACCOUNTS.
   - Gap: None — IMPL.

6. **Employee reads another employee's attendance history by guessing the employeeId**
   - Current: `selfEmployeeId` scope is enforced in `list()` —
     `scope.selfEmployeeId` overrides whatever `employeeId` is in the query.
   - Gap: None — IMPL.

7. **Employee reads a leave request that belongs to a colleague**
   - Current: `scope.selfEmployeeId && leave.employeeId !== scope.selfEmployeeId →
     throw notFound()`.
   - Gap: None — IMPL.

8. **PURCHASE_MANAGER tries to punch in (has `workforce.attendance.punch_self`)**
   - Current: Yes, every role has `workforce.attendance.punch_self` at SELF scope.
   - Gap: None — IMPL.

9. **OPERATIONS_MANAGER changes RBAC role for another user**
   - Current: `admin.user.assign_role` is granted only to OWNER.
   - Gap: None — IMPL.

10. **KITCHEN_MANAGER decides on a leave request**
    - Current: `workforce.leave.decide` is not granted to KITCHEN_MANAGER.
      Leave requests from kitchen staff would wait for the STORE_MANAGER.
    - Gap: Operational — identified in book ch.14 as a known complaint ("when the
      Store Manager is off").

11. **COUNTER_CASHIER requests leave for another employee**
    - Current: `workforce.leave.request` is SELF scope. Cannot file for others.
    - Gap: None — IMPL.

12. **User without an Employee row tries to access attendance endpoints**
    - Current: `resolveEmployee()` throws 403 if `employeeId` cannot be resolved.
    - Gap: None — IMPL.

13. **PROPOSED: Employee accesses the manager verification queue**
    - SRS Amendment A5: Employees cannot verify their own submissions.
    - Gap: PROPOSED — verification endpoint not yet built.

14. **PROPOSED: KITCHEN_MANAGER accesses the verification queue**
    - SRS Amendment A3: Verification is a Store Manager function at OWN_OUTLET.
    - Gap: PROPOSED — need to confirm whether KITCHEN_MANAGER holds the verification
      permission.

15. **PROPOSED: Selfie URL is guessable or public**
    - SRS Amendment A9: Private storage references only.
    - Gap: PROPOSED — Supabase private bucket usage is not yet implemented.

---

## L. Notifications and recovery edge cases

1. **LEAVE_REQUESTED OutboxEvent exists but the dispatcher is down**
   - Current: At-least-once delivery via transactional outbox. Manager will receive
     the notification when the dispatcher recovers.
   - Gap: None — IMPL.

2. **WhatsApp template not approved by Meta**
   - Current: WhatsApp failure does not affect the underlying leave record.
   - Gap: None — IMPL.

3. **Duplicate notification sent for the same event (dispatcher retry)**
   - Current: OutboxEvent has `processedAt` and `status` fields (seen in
     `notifications.service.ts` references). Deduplication logic should prevent
     duplicates.
   - Gap: INFERRED NOT VERIFIED — the OutboxEvent processing deduplication was not
     confirmed in detail from source code.

4. **PROPOSED: Attendance submission notification to manager**
   - SRS Amendment: Manager should see pending submissions.
   - Gap: PROPOSED — no OutboxEvent type for attendance submission exists.
