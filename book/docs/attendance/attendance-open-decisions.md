# Attendance System — Open Decisions

Decisions are prioritised by whether they block implementation of the next phase.
Decisions marked **BLOCKS** must be resolved before any code is written for that
feature. Decisions marked **DEFERRED** are safe to proceed without but must be
answered before UAT.

Where SRS Amendment v1.1 explicitly resolves a question, it is noted as "RESOLVED
by Amendment v1.1" and listed only for reference.

---

### Third pass: Phase 3 findings (26 Oct 2026)

| ID | Question | State now | Blocks |
|---|---|---|---|
| ATT-DEC-SELFEDIT | May a manager enter or edit their own punches? Currently they can (audited; the day stays `PENDING` and cannot be self-verified). | Not changed. | Integrity of manager worked-time |
| ATT-DEC-EDIT-AFTER-VERIFY | Should editing a punch on a `VERIFIED` day reset it to `PENDING` or require a new decision? Currently it stays `VERIFIED` (audited). | Not changed. | Integrity of verified records |
| ATT-DEC-DISABLED-TOKEN | Should a disabled account's access token stop working immediately (a status check per request) or after its 15-minute life? Platform authentication, outside attendance. | Not changed; reproduced. | Offboarding a Store Manager |
| ATT-DEC-CLOCKS | Outbox availability is written by the application and compared with the database clock. Require synchronized hosts, or write the timestamp database-side? | Prerequisite documented. | Notification latency |
| ATT-DEC-FUTURE | Confirm that attendance may never be set in the future (implemented with a 60 s allowance for clock drift). | Implemented as an integrity guard. | None |
| ATT-DEC-OVERRIDE | (restated) SRS A2 requires a manager-controlled path for corrections and resubmission after a rejection; none exists beyond manager-entered punches, which leave the status `REJECTED`. | Open. | Rejected-day corrections |
| ATT-DEC-MGR-SELF | (restated) Nobody can verify a Store Manager's own attendance. | Open; Owner/Ops not granted. | Manager attendance percentage |

Reproduced pre-existing leave defects (not attendance, not fixed): leave
self-approval, and LEAVE_REQUESTED/LEAVE_DECIDED notifications rendering a generic
type and a dead deep link. See section 0B.2 of the implementation audit.

---

### Second pass: verification, history and percentage (26 Oct 2026)

None of these block the work already built. Each records what was implemented
meanwhile so the choice is visible and reversible.

| ID | Question | Built meanwhile | Blocks |
|---|---|---|---|
| ATT-DEC-MGR-SELF | Who verifies a Store Manager's own attendance? Only Store Managers hold `workforce.attendance.verify` and nobody verifies themselves, so a manager's days stay `PENDING` and never count as present. | Nothing. No Owner/Ops grant was added (A2: oversight does not replace manager verification by default). | Manager attendance percentage |
| ATT-DEC-OVERRIDE | May the Owner (or anyone) override or reinstate a decided/rejected day, and how? A2 says overrides must be authorized and audited but defines no process. | No override. A decided day is final; correction by manager-entered punch leaves the status as is. | Rejected-day corrections |
| ATT-DEC-LEGACY | Existing days created before verification have no verification status. Count them as present, require backfill, or leave out? | Left null, never counted, shown as `unverifiedDays`. No backfill was run. | Historic percentages |
| ATT-DEC-PERPUNCH | OD-005: verification is per day. Confirm that a later check-out needs no separate verification. | Per day (A5.10, A5.12). | None |
| ATT-DEC-HALFDAY | Does a verified HALF_DAY count as 1, 0.5 or 0 present days? | 1, reported as a present day; no weighting. | Percentage accuracy |
| ATT-DEC-HALFLEAVE | How does approved half-day leave affect the denominator? | Not reduced; counted in `halfDayLeaveDays`. | Percentage accuracy |
| ATT-DEC-UNSCHEDULED | A verified day with no shift, or on approved leave: counted in the numerator? | No; reported as `verifiedOnIneligibleDays` so the figure stays at most 100. | Percentage accuracy |
| ATT-DEC-TODAY | The A7 "configured cutoff" for treating a scheduled day as an absence is not defined. | Today is in progress (never an absence); earlier days with no verified presence are absences. | Percentage accuracy |
| ATT-DEC-ROUNDING | Rounding of the percentage. | Two decimals, display only. | None |
| ATT-DEC-HOLIDAY | There is no holiday calendar in the schema. | Days with no shift are neither eligible nor absent, which also covers weekly offs. | Holiday-aware percentage |
| ATT-DEC-TZ | Use `Outlet.timezone` or the fixed IST 04:00 helper? | The helper, as everywhere else. | Non-IST outlet |
| ATT-DEC-BREAKLIMIT | Break limits, grace, deductions, auto-close of a forgotten break? | None invented. A forgotten break stays open and blocks the employee's own punch-out; a manager-entered OUT leaves it open. | Break policy |
| ATT-DEC-NOTIFY-BREAK | Are break notifications required? | None sent. | None |
| ATT-DEC-LEAVE-SELF | `LeaveService.decide` lacks a self-approval check (found, not fixed, out of scope). | Not changed. | Leave integrity |

---

## Phase 2 update (26 Oct 2026)

Resolved by the Phase 2 implementation (see section 0 of
[attendance-implementation-audit.md](attendance-implementation-audit.md)):

- **OD-001 (where outlet coordinates live):** `Outlet.latitude`, `longitude`,
  `geofenceRadiusM`, nullable, set per outlet by an explicit script.
- **Geofence radius:** 500 m per the product owner's instruction. SRS Amendment
  v1.1 A5 says 150 m. **Needs owner confirmation and an SRS amendment.**

Newly open or still open after Phase 2:

| ID | Question | Blocks |
|---|---|---|
| ATT-DEC-OUTLET-MAP | Which outlet record is Kalinga Nagar? Only `SAHEED_NAGAR` and `PATHARAGADIA` exist; Saheed Nagar is a different locality. Create a new outlet, or rename/re-point an existing one? Until answered it has no geofence and its staff cannot self punch. | Kalinga Nagar attendance |
| ATT-DEC-SAHEED | Does Saheed Nagar need attendance at all? If yes it needs its own verified coordinates; if no, its staff are blocked by design until it is configured or closed. | Saheed Nagar attendance |
| ATT-DEC-GEO-ACCURACY | Reject, flag, or accept a punch whose reported GPS accuracy is poor (for example 400 m on a 500 m fence)? Currently the accuracy is **stored but not used**; the check is distance only, no tolerance. | Nothing, but a weak accuracy reading can pass |
| ATT-DEC-SELFIE | Is a selfie mandatory on every punch or only IN? Which bucket, signed-URL lifetime and retention? Selfie is **not implemented** (no storage integration exists). | Selfie evidence |
| ATT-DEC-SPOOF | Browser geolocation can be faked. Is that risk accepted, or are further controls wanted (for example flagging implausible jumps)? Not addressed in Phase 2. | Nothing |

---

## Priority 1: Blocks development of geofence + verification features

| Decision ID | Question | Why It Matters | SRS Statement | Current Implementation | Options | Blocks Development? | Recommendation |
|---|---|---|---|---|---|---|---|
| OD-001 | Where should outlet geofence coordinates be stored, and who maintains them? | Server-side distance validation requires authoritative outlet coordinates. There are currently no lat/lng fields on the `Outlet` model. | Amendment A5: "Server validates location against the assigned outlet and 150-metre radius." | No coordinates in `Outlet` model (verified in `schema.prisma`). | (A) Add `latitude`, `longitude`, `geofenceRadiusMetres` to `Outlet` model; admin UI to set per outlet. (B) Hard-code in environment variables. | YES — cannot implement geofence without coordinates | Option A: Schema field, managed via admin panel. Hard-coding is fragile if coordinates need adjustment. |
| OD-002 | What schema model should represent a single attendance submission (with verification status, location evidence, and selfie)? | The current `AttendancePunch` model has no verification state or evidence fields. Extending it vs. creating a new `AttendanceSubmission` model is an architectural decision that affects every subsequent feature. | Amendment A5: submission enters "Pending verification"; A6: separate concepts for location result and attendance status. | `AttendancePunch` has `source` and `editReason` only. No verification state. | (A) Add `verificationStatus`, `latitude`, `longitude`, `locationAccuracy`, `locationResult`, `selfieRef` fields to `AttendancePunch`. (B) Create a new `AttendanceSubmission` table with a FK to `AttendancePunch`. | YES | Option A is simpler for Phase 2 and avoids an extra join. Option B is more architecturally pure but adds complexity. Recommend Option A with a clear migration plan. |
| OD-003 | What is the GPS accuracy threshold below which a submission is flagged as low accuracy? | The amendment requires a recovery state for low accuracy but does not specify the threshold. | Amendment A9: "Provide clear recovery states for ... low accuracy." | No accuracy check exists. | (A) 100m accuracy circle (common GPS standard). (B) 50m. (C) Make configurable per outlet. | YES — a threshold value is needed before implementing the check | Recommend 100m as a practical default for urban Bhubaneswar. Confirm with client. |
| OD-004 | Should gallery photo upload be blocked at the technical level, or only at the UX level? | The amendment says gallery uploads are not equivalent to fresh capture. The browser `<input capture="camera">` attribute can be bypassed on desktop. | Amendment A5: "Gallery upload is not equivalent to fresh capture unless separately approved." | No photo capture exists. | (A) Use `capture="camera"` as UX guidance; accept that desktop browsers can bypass it; manager review compensates. (B) Add a freshness token to the photo metadata. (C) Require liveness detection (out of scope per amendment). | YES — determines implementation approach for selfie capture | Option A: practical for Phase 2. The amendment explicitly excludes liveness detection. Manager review is the verification step. |
| OD-005 | Should verification be the primary path for ALL punch events, or only the first check-in of the day? | Requiring manager verification for every IN/OUT would create a huge queue for a 25-person workforce with multiple shift segments per day. | Amendment A5 describes the "attendance submission" flow (check-in). It says "Check-out remains a separate event and follows the existing SRS and current application workflow." | Check-out is currently unverified. | (A) Verification only for check-in (first IN of the day). (B) Verification for every IN punch. (C) Verification for both IN and OUT punches. | YES — determines queue volume and manager workload | Option A: check-in only. The amendment specifically defers check-out to the existing workflow. Verify this interpretation with the client. |

---

## Priority 2: Blocks analytics implementation

| Decision ID | Question | Why It Matters | SRS Statement | Current Implementation | Options | Blocks Development? | Recommendation |
|---|---|---|---|---|---|---|---|
| OD-006 | What defines a "scheduled working day" for the attendance percentage denominator? | Without a holiday calendar or clear policy, the denominator is ambiguous. Bob's Momo trades 7 days a week; the book documents no holiday list. | Amendment A7: "Eligible Scheduled Working Days − Approved Leave Days − Other Applicable Non-working Days." Amendment also states: "Do not fabricate schedules or use sample values in production analytics." | No holiday calendar. Shifts are rostered manually per week. | (A) Use only days with a SCHEDULED shift as working days. (B) Treat every calendar day as a working day unless WEEKLY_OFF. (C) Add a `HolidayCalendar` model. | YES — cannot calculate eligible days without a definition | Recommend Option A: use SCHEDULED shift as the working day indicator. Simplest and consistent with existing shift model. Confirm with client. |
| OD-007 | How should a HALF_DAY attendance status contribute to the attendance percentage numerator? | HALF_DAY is a distinct status but the amendment's formula only references "Verified Present Days." Is a HALF_DAY 0.5 present days or 1? | Amendment A7: "Attendance % = (Verified Present Days ÷ Eligible Days) × 100." HALF_DAY is not mentioned in the percentage formula. | HALF_DAY is a recompute outcome but not addressed in the analytics formula. | (A) HALF_DAY = 0.5 present days. (B) HALF_DAY = 1 present day. (C) HALF_DAY = 0 present days (employee was there but not a "full present"). | Blocks accurate percentage | Recommend Option A: 0.5 present days, consistent with the leave `dayCount` model. |
| OD-008 | How does the percentage calculation handle employees on the first week of joining? | `joinedOn` may be mid-month. Including pre-joining dates as eligible would understate the denominator. | Amendment A7: "The original SRS does not define a complete shift calendar." | No percentage endpoint; `joinedOn` is on the Employee record. | (A) Only count dates >= `joinedOn` as eligible. (B) Only count dates >= `joinedOn` AND <= today. | YES — affects numerator validity | Option A is the correct approach. |
| OD-009 | Should the 365-day rolling window use calendar days or business days? | The amendment says "rolling 365 calendar days." This is clear, but needs to be confirmed given the 04:00 IST business day boundary. | Amendment A7: "rolling 365 calendar days, using the applicable outlet timezone." | No rolling history endpoint. | (A) 365 calendar days (as stated in amendment). (B) 365 business dates (using the 04:00 IST rule). | Deferred — calendar days is likely the intent | Option A: calendar days, consistent with the amendment text. |

---

## Priority 3: Deferred — needed before UAT but not before Phase 2 build starts

| Decision ID | Question | Why It Matters | SRS Statement | Current Implementation | Options | Blocks Development? | Recommendation |
|---|---|---|---|---|---|---|---|
| OD-010 | What OutboxEvent notification types should cover the verification workflow? | New notification events are needed for submission notification to the manager and verification/rejection decisions to the employee. | Amendment states employee sees the decision; manager sees pending queue. | Only `LEAVE_REQUESTED` and `LEAVE_DECIDED` events exist. | Define: `ATTENDANCE_SUBMISSION_PENDING` (to manager), `ATTENDANCE_VERIFIED` (to employee), `ATTENDANCE_REJECTED` (to employee, with reason). | Deferred — notifications are a separate concern from the core feature | Recommended event names above. Must be added to the notification dispatcher rules table. |
| OD-011 | Should the manager verification queue send a WhatsApp notification or only an in-app alert? | WhatsApp for every punch from 25 employees could generate 25+ messages per morning. | Amendment: notification mechanism not specified. SRS: WhatsApp is a delivery channel. | Not built. | (A) In-app only (less noise). (B) In-app + WhatsApp for the queue summary (e.g., "5 attendance submissions pending review"). (C) In-app + WhatsApp per individual submission. | Deferred | Option B: a batch WhatsApp message per manager per morning is less intrusive and more likely to be read. |
| OD-012 | What happens when an employee has no SCHEDULED shift for a day but submits attendance from the outlet? | Currently: allowed and counts as PRESENT (unrostered employee who turns up). With geofencing: their location can still be validated. | Book ch.18: "An unrostered employee who turns up and works is not late, and is not absent, and their day counts toward PRESENT." | PRESENT for any punches, lateMins = 0. | (A) Allow — same behavior as now (geofence validates location regardless of shift). (B) Require a shift before allowing submission. | Deferred | Option A: consistent with current model. Unrostered presence is valid. |
| OD-013 | Who can override an outside-radius result to mark attendance as valid? | A manager may need to manually approve attendance for an employee who is genuinely at an offsite location for business reasons. | Amendment A6: "Any manual exception must be restricted to an authorized manager action and logged with a reason." | No exception path exists. | (A) Manager can override via the existing punch-edit path (with reason + audit log). (B) New "override" endpoint. | Deferred | Option A: the existing MANAGER_EDIT path is sufficient. No new endpoint needed. |

---

## RESOLVED — For reference only

| Decision ID | Question | Resolved by | Resolution |
|---|---|---|---|
| OD-R001 | Is biometric/photo attendance required? | SRS Amendment v1.1, section A13 | Photo/selfie evidence required; biometric hardware remains excluded. |
| OD-R002 | Is attendance manual or device-based? | SRS Amendment v1.1, section A1 | Self-service via web (responsive mobile browser); no native mobile app. |
| OD-R003 | What is the geofence radius? | SRS Amendment v1.1, section A5 | 150 metres from outlet coordinates. |
| OD-R004 | Is payroll computation in scope? | SRS v1.0 decision; book ch.19 ADR-006 | Salary storage only; no payroll computation in Phase 1. |
| OD-R005 | How many approval stages for leave? | SRS v1.0 Section 9; Feature List 6.2 | Single manager decision only. No second approval layer. |
| OD-R006 | Does REJECTED leave history block resubmission? | `leave.service.ts` overlap check (verified in code) | Rejected and cancelled leave does NOT block resubmission for the same dates. |
