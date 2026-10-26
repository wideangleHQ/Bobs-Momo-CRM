# Attendance System — Implementation Audit

Generated: 26 October 2026. Based on the `preview` branch. Sections 1–11 describe
the code **before** Phase 2 and were read-only. Section 0 records what Phase 2
changed and supersedes any contrary statement below.

---

## 0. Phase 2 update: secure self punch with 500 m geofence (26 Oct 2026)

### 0.1 Rule implemented

A **self punch** (an employee punching their own attendance) is accepted only if
the server measures the device coordinates to be **at most 500 m** from the
employee's outlet. The distance is a haversine calculation in
`apps/api/src/modules/workforce/geofence.ts` (`haversineMetres`,
`withinGeofence`). Exactly on the radius counts as inside. No GPS-accuracy
allowance or boundary tolerance is applied, because none has been approved
(see ATT-DEC-GEO-ACCURACY in the open decisions).

> **Conflict with the SRS.** SRS Amendment v1.1 section A5 states 150 m. The
> product owner's Phase 2 instruction states 500 m for both outlets. The
> implementation follows the instruction. The radius is data
> (`Outlet.geofenceRadiusM`), so it can be changed without code. The SRS should
> be amended to match, or the radius lowered, once the owner confirms.

### 0.2 Where the configuration lives

New nullable columns on `Outlet`: `latitude`, `longitude`, `geofenceRadiusM`
(migration `20261026000000_attendance_geofence`, additive, with a CHECK that
the three are all set or all null and in range). The outlet is **always taken
from the employee's own record**, never from the request. Nothing is
hard-coded in the frontend.

New columns on `AttendancePunch`: `latitude`, `longitude`, `accuracyM`,
`distanceM`, recorded for self punches only. `distanceM` is the server's own
measurement; the client cannot supply it (the request schema is strict).

### 0.3 Verified coordinates

Both Google Maps links were opened and the resolved place pin was read from the
page URL and listing.

| Place | Listing seen | Latitude | Longitude | Radius |
|---|---|---|---|---|
| Pathargadia | Bob's MoMo, Plot No. 126, 200ft Road, Patharagadia, Bhubaneswar 751024 | 20.3661741 | 85.7944251 | 500 m |
| Kalinga Nagar | Bob's MoMo, Vaishnab Complex, Sum Hospital Rd, Kalinga Nagar, Shampur, Bhubaneswar 751029 | 20.2861315 | 85.7732064 | 500 m |

The pins match the listed branches. That confirms the **coordinates**, not the
**outlet mapping**:

- The provisioning script and the earlier DB notes name the outlets
  `SAHEED_NAGAR` and `PATHARAGADIA`. `PATHARAGADIA` is the same place as
  Pathargadia (spelling differs only).
- **No outlet exists for Kalinga Nagar.** `SAHEED_NAGAR` is a different locality
  and has not been assumed to be it. No outlet was created and no coordinates
  were assigned to it.
- The outlet codes were not re-read from the live database in this phase (the
  direct database host is not reachable from the development machine). Run the
  dry run below to confirm the real codes before applying.

### 0.4 Activating a geofence

Nothing is activated by the migration. Activation is explicit, per outlet, and
never creates an outlet:

```
bun run prisma/set-outlet-geofence.ts PATHARAGADIA 20.3661741 85.7944251 500          # dry run
bun run prisma/set-outlet-geofence.ts PATHARAGADIA 20.3661741 85.7944251 500 --apply  # write
```

**Until an outlet is configured, self punches for that outlet are refused** with
`ATTENDANCE_OUTLET_NOT_CONFIGURED`. Failing closed is deliberate. The
consequence is that `SAHEED_NAGAR` staff cannot self punch until it is given a
verified location or the Kalinga Nagar mapping is settled. Managers can still
enter a punch on an employee's behalf.

### 0.5 Defects found and fixed

| # | Defect (root cause) | Fix |
|---|---|---|
| 1 | **Any employee could backdate their own punch.** `punch()` treated a supplied `at` as a manager entry, and the self-scope check only compared `employeeId`. Sending `{direction, at}` wrote a MANAGER_EDIT punch at a time of the employee's choosing. | A self-scoped grant sending `at` is refused (403). Manager entry now requires a non-self grant. |
| 2 | **Self punch could bypass the geofence by naming its own `employeeId`**, which also made it a "manager entry". | Naming your own id is still a self punch. |
| 3 | **Two simultaneous first punches could both succeed.** `FOR UPDATE` locked punch rows, but on a first punch there are none. | The `AttendanceDay` row is locked first. |
| 4 | Exited employees could still punch. | Self punches by an `EXITED` employee are refused. |
| 5 | A retried punch after a lost response re-read GPS, changing the body and tripping the idempotency conflict. | The page holds the key and the exact body until settled. A 4xx clears them (nothing was written); a network error or 5xx keeps them and re-reads the board first. |

### 0.6 Error codes (new)

`ATTENDANCE_LOCATION_REQUIRED` (400), `ATTENDANCE_OUTSIDE_GEOFENCE` (409),
`ATTENDANCE_OUTLET_NOT_CONFIGURED` (409), `ATTENDANCE_OUTLET_INACTIVE` (409),
`ATTENDANCE_EMPLOYEE_EXITED` (409).

### 0.7 Not implemented in Phase 2, and why

- **Selfie evidence.** No storage integration exists in the API: `tasks.service.ts`
  records attachment metadata only and says Supabase Storage is not wired, and
  `SUPABASE_*` is not read by `env.ts`. Building private upload and signed-URL
  access from scratch, untested against a real bucket, was judged riskier than
  deferring it. Whether a selfie is mandatory on every punch, and its retention,
  are also undecided. No mock was added.
- **Manager verification queue / verified status** (gap 3 above): unchanged.
  The page never labels a punch "verified".
- **Facial recognition and biometric matching**: out of scope, as instructed.

### 0.8 Tests

| Check | Result |
|---|---|
| `bun test test/geofence.test.ts` (23 tests: both outlets, inside/outside/boundary, N and E offsets) | **Passed** |
| `apps/api` `typecheck` and `lint` | **Passed** |
| `apps/web` `tsc --noEmit` and `lint` | **Passed** |
| `apps/api` `build` and `apps/web` `build` | **Passed** |
| `test/workforce.e2e.test.ts` (new geofence, identity, backdating, concurrency tests; existing punch tests updated to send a location) | **Superseded: executed in Phase 3 on an isolated database, passed (see 0B.5).** Originally not run: no database with the migration applied, and the shared database must not be used. |
| `test/rbac-coverage.test.ts` | Failed to start here (beforeAll timed out: no live DB/Redis). Not a result about the change. |
| Browser behaviour (permission denied, GPS off, timeout) | **Superseded: exercised in Phase 3 with simulated geolocation (see 0B.6).** Real device GPS and the real permission prompt remain untested. |
| Migration SQL | **Not applied** and not validated against a live Postgres. `prisma validate` passes. |

## 0B. Phase 3: security testing, QA and stabilization (26 Oct 2026)

**Readiness decision: ready for staging validation only. Not ready for deployment.**
Reasons are listed in 0B.9. Nothing in this section was deployed, and no shared
or production database was touched.

### 0B.1 How the testing was done

- **Isolated infrastructure.** Docker Desktop would not start on the development
  machine (its own "Inference manager" startup error; the only offered fix was a
  factory reset, which was not used). PostgreSQL 16.15 and Redis were installed in
  a WSL Ubuntu distro and run from `/tmp` on ports 54322 and 63790, the same ports
  as `docker-compose.yml`. Every run used explicit local `DATABASE_URL`,
  `DIRECT_URL`, `REDIS_URL` and test-only JWT secrets, with `TZ=Asia/Kolkata`.
  The shared Supabase database was not used for any test.
- **Test-runner hazard found and closed.** `scripts/test-env.ts` fell back to
  `apps/api/.env` when no `DATABASE_URL` was set, and that file points at the
  shared Supabase project, so a bare `bun test` would have run the destructive e2e
  suites against it. The preload now discards a non-local database from that
  fallback (it prints only the host) unless `ALLOW_REMOTE_TEST_DB=1`.
- **Two engines of evidence.** API e2e tests against the real application and
  database, and a browser session against the real web app and API on ports
  3100/3101 (a temporary copy of `apps/web`, so the developer's own servers on
  3000/3001 were not touched; the copy and the temporary launch entries were
  removed afterwards).

### 0B.2 Security findings

Severity is the author's judgement of impact on this system. "Fixed" means a
regression test exists and was run.

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | **Exited employee could punch by naming their own `employeeId`.** The Phase 1 exited check was skipped whenever `employeeId` was present. Introduced in Phase 1. | Medium | **Fixed.** Test `an exited employee cannot punch, even by naming their own id`; confirmed to fail on the old code and pass on the fix. |
| S2 | **Manager could set a punch (or move an existing one) into the future**, creating attendance for days that have not happened. | Low to Medium | **Fixed** (`ATTENDANCE_FUTURE_PUNCH`, 60 s clock allowance). Tests for both the entry and the edit. The "no future attendance" rule is an integrity guard inferred from the SRS, not a stated requirement. |
| S3 | **An impossible calendar date (`2026-13-45`) passed validation and returned HTTP 500** on `GET /attendance` and every other route using `businessDateSchema`. | Medium (error disclosure, reliability) | **Fixed at the root** in `packages/shared/src/inventory.ts`. It now returns 400. Test in the pagination/filter abuse case. |
| S4 | **The `Outlet` geofence CHECK did not enforce all-or-nothing.** A CHECK passes on NULL, so setting only `latitude` was accepted. The application still failed closed (it null-checks all three), so this was a missing database guarantee, not an exploitable path. | Low | **Fixed** in migration `20261026000000_attendance_geofence` (not yet applied anywhere real). Found only because the constraint was exercised against a real database; the offline SQL diff could not have shown it. |
| S5 | **A disabled account's existing access token keeps working until it expires (at most `JWT_ACCESS_TTL`, 900 s).** Reproduced: `GET /attendance/verification-queue` returned 200 after the user was set `DISABLED`; login returns 403 and refresh tokens are revoked. `JwtAuthGuard` does not re-check user status. | Medium | **Not changed.** Platform authentication, outside attendance and out of scope. Effect on attendance: a disabled Store Manager can keep verifying for up to 15 minutes; an exited employee cannot punch (S1). |
| S6 | **A manager can enter and edit their own punches** (`manual_punch` and `editPunch` do not forbid the target being the caller). The day stays `PENDING` and the manager cannot verify it, so it cannot count as present, but worked time and lateness can be changed. Both actions are audited. | Low | **Not changed.** The SRS does not forbid it. Recorded as ATT-DEC-SELFEDIT. |
| S7 | **Editing a punch on an already `VERIFIED` day leaves it `VERIFIED`.** A verified record can be altered after the decision (audited, by an authorized manager). | Low | **Not changed.** Policy question: ATT-DEC-EDIT-AFTER-VERIFY. |
| S8 | **Outbox availability uses the application clock but is claimed against the database clock.** With a 7 to 49 s skew between hosts, notifications are delayed by the skew. Reproduced here (WSL clock behind Windows); the stuck rows had `availableAt` ahead of the database `now()`. | Low | **Not changed** (notification engine). Deployment prerequisite: NTP-synced hosts. |

Pre-existing leave issues, reproduced (not attendance, not fixed, per scope):

- **Self-approval of leave.** A Store Manager who is also an employee created a
  leave request (201) and approved it themselves (200); `decidedById` was their own
  id. `LeaveService.decide()` has no self-approval check.
- **Leave notifications render incorrectly.** The delivered text was "Your leave
  from 2026-10-26 to 2026-10-26 was approved by your manager." (type and approver
  fall back to generic words) and the deep link was `/workforce/leave/` with no id.
  The templates read `leaveId`, `leaveType` and `decidedByName`, which the service
  does not put in the outbox payload.

### 0B.3 What was attacked and held

All run against the real application and isolated database. `test/attendance-security.e2e.test.ts` (58 tests) plus the Phase 1/2 blocks in `test/workforce.e2e.test.ts`.

| Area | Result |
|---|---|
| Authentication | All 10 attendance routes return 401 without a token; garbage, truncated and tampered tokens return 401; a token with a stale permission hash returns 401 `AUTH_PERMISSIONS_STALE` (so existing Store Manager sessions are forced to sign in again after the RBAC change). |
| Authorization matrix | Staff, HR, Operations Manager and Owner all get 403 on the queue and on verify/reject; only the Store Manager gets 200. Staff cannot edit punches or see another employee's rows. Another outlet's manager gets 404 on both decide and queue. A foreign `outletId` query is 404. |
| Forged fields | `distanceM`, `outletId`, `verificationStatus`, `verifiedById`, `roleKey`, top-level `latitude` on a punch are refused and write nothing. A decision cannot carry `verifiedById`, `verifiedAt` or `verificationStatus`. A break cannot carry `employeeId` or `outletId`. |
| Coordinates | Latitude above 90 or below -90, longitude above 180, strings, nulls, missing longitude, empty object, negative accuracy, extra keys, an array, and literal `NaN`/`Infinity` are all refused with nothing written. 501 m is refused and 499 m accepted, measured by the server. |
| Punch integrity | Self backdating and future-dating: 403. Retried request replays one punch. Same key with a different body: 409 `IDEMPOTENCY_KEY_REPLAYED`. Two simultaneous first punches: exactly one succeeds. Inactive outlet and unconfigured outlet refuse self punches. |
| Verification | Self-verification 403, and the manager's own day is absent from their queue. Short, empty and whitespace reasons refused and the day stays `PENDING`. Verify then reject (and the reverse): second is 409. Simultaneous verify and reject: exactly one 200 and one 409, one audit row, one outbox row. Rejected day refuses employee punches and breaks; a manager-entered correction is accepted but the day stays `REJECTED`. |
| Failed decisions | Refused decisions (bad reason, wrong outlet, no permission) write no audit row and no outbox row. |
| Notifications | After delivery: the employee gets exactly one `ATTENDANCE_DECIDED` whose text includes the reason and whose link is `/attendance`; both outlet managers get `ATTENDANCE_SUBMITTED`; the other outlet's manager, HR and the employee do not. Re-delivering the same outbox row creates no second notification. No latitude, longitude, accuracy or distance appears in any outbox payload, audit row or notification. |
| Database | CHECK constraints refuse a decision without verifier/time, a rejection without a reason of at least 5 characters, and half-configured or out-of-range outlet coordinates. |
| Breaks | Two simultaneous starts: one 200, one 409, one open break. Two simultaneous ends: one 200, one 409. End with none open: 409. Start before check-in or after check-out: 409. Self punch-out while on break: 409. A manager-entered OUT leaves the break open and visible (`openBreak: true`). |
| History and percentage | Window start is exactly today minus 364 days; the day before returns 400. `pageSize` 0 or above 100, `page` 0, non-numeric, malformed or impossible dates, unknown filter values: 400. `from` after `to`: 200 with no rows. Cross-employee and cross-outlet summary: 404. Client-supplied `attendancePercent`, `eligibleDays` and `verifiedPresentDays` query parameters are ignored. Percentage computed from real shifts, leave, and verified/pending/rejected/legacy rows: 60% as expected, and identical for the employee and the manager. |

### 0B.4 Migrations

Both attendance migrations were validated on **PostgreSQL 16.15** (the project
uses 15 in `docker-compose.yml` and CI; Supabase's version was not checked).

1. **Fresh database:** all six migrations apply in order with no error.
2. **Existing database with attendance data.** A database was built at the
   pre-attendance schema (the four original migrations), loaded with an outlet, an
   employee, four attendance days (`PRESENT`, `HALF_DAY`, `ABSENT`, `ON_LEAVE`),
   three punches, an **open** break and an approved leave request, the original
   migrations were marked applied, and `prisma migrate deploy` applied the two new
   ones. All rows survived unchanged; every new column is NULL; no outlet was
   activated; the three CHECK constraints and the index exist; the constraints
   enforce on the migrated table. This is the closest available check of "safe on an
   existing database". It is **not** a test against real production data.
3. **Defect found by this:** the geofence CHECK (S4) was fixed and the legacy
   database was rebuilt and re-verified.
4. **Rollback.** Both migrations are additive, so rollback is a manual reversal
   written and rehearsed before use, not automatic: drop the three CHECK
   constraints and the index, then the added columns, then `DROP TYPE
   "AttendanceVerification"`. Dropping loses any verification decisions or
   geofence/punch location data recorded since. No rollback script was run.
5. **Ordering and compatibility:** `20261026000000_attendance_geofence` before
   `20261026010000_attendance_verification`; neither depends on the other; the
   Prisma schema is consistent (`prisma validate` passes) and the regenerated
   permissions file is byte-identical to the generator's output.
6. **Not done:** applying to Supabase. The direct database host is not reachable
   from the development machine, and migrations must not be applied to shared
   infrastructure without authorization.

### 0B.5 Test results

| Check | Command (from `apps/api` unless stated) | Result |
|---|---|---|
| Attendance and workforce suites | `bun test test/workforce.e2e.test.ts test/attendance-security.e2e.test.ts test/rbac-coverage.test.ts test/geofence.test.ts test/attendance-summary.test.ts` | **Passed**, 152 pass, 0 fail |
| Full API suite, fresh isolated DB, run 1 | `bun test test` | 359 pass, **1 fail** |
| Full API suite, same DB, run 2 | `bun test test` | 359 pass, **1 fail** (re-runnable; the suites clean up after themselves) |
| The 1 failure | `notifications.e2e.test.ts` "low stock digest emits one alert per outlet" | **Failed.** Not attendance. Cause evidenced by the stuck outbox rows: `availableAt` ahead of the database clock (S8), because the WSL database clock is 7 to 49 s behind the Windows host. It fails identically when run alone. Unproven on a host with synchronized clocks. |
| Shared and web unit tests | `bun test packages/shared`, `bun test apps/web` (repo root) | **Passed**, 4 and 25 |
| API typecheck and lint | `bun run typecheck`, `bun run lint` | **Passed** |
| Web typecheck and lint | `bunx tsc --noEmit`, `bun run lint` (in `apps/web`) | **Passed** |
| Root typecheck | `bun run typecheck` (root) | **Passed** |
| Root lint (what CI runs) | `bun run lint` (root, `eslint .`) | **Failed**, 2 errors, both in `apps/web/features/inventory/receive-stock-flow.tsx` (unused `useCan`, `getVendor`). Not attendance; it breaks the CI `lint` step. Not fixed (scope). |
| Production builds | `bun run build` (root) | **Passed** |
| Prisma | `bunx prisma validate`, `node scripts/gen-permissions.mjs` then diff | **Passed**; generated permissions identical |
| RBAC coverage | `test/rbac-coverage.test.ts` | **Passed** (inside the full run) |

A note on a misleading signal during this phase: a later full run showed a second
failure (`HR creates an employee`). That was pollution from temporary browser
fixtures with `BR-EMP-*` codes, which sort after `BM-EMP-*` and defeat the employee
code allocator (`ORDER BY employeeCode DESC`, then +1). It disappeared on a clean
database and is not a product regression. The allocator's sensitivity to unusual
codes is a latent, pre-existing fragility.

### 0B.6 Browser results (real web app, real API, isolated DB)

Driven with the built-in browser. The pane could not draw screenshots (its window
was not on screen), so clicks were dispatched from the page and state was read from
the DOM. Browser geolocation was **simulated** by replacing `navigator.geolocation`;
the real permission prompt and a real GPS were not exercised.

| Scenario | Result |
|---|---|
| Employee page: status, outlet, N/A percentage with no roster | Passed |
| Location permission denied / device cannot locate / timeout | Passed: the specific message for each, **no request sent**, button recovers |
| 600 m from the outlet | Passed: server message with the measured distance and the limit; button recovers |
| Punch in, start break, end break | Passed |
| Punch out while on a break | Passed: refused with "End your break before punching out" |
| Request reaches the server but the response is lost | Passed after a fix (S-UX1): page re-reads, shows the punch went through, flips to "Punch out"; exactly one punch in the DB |
| Request never reaches the server, then retry | Passed: retry used the **same Idempotency-Key and the same coordinates** (GPS not re-read), one OUT recorded |
| Board endpoint fails (HTTP 500) | Passed: clear error with "Try again", recovers |
| Employee views a rejected day | Passed: shows REJECTED, the manager's reason, and disabled punch and break buttons |
| Employee opens the manager queue | Passed: "You cannot verify attendance", no API call |
| Manager queue | Passed: name, date, outlet, times, server-measured distance and device accuracy; no coordinates |
| Reject dialog: empty, then 2 characters | Passed: refused with a clear message, queue unchanged |
| Valid rejection, then empty queue | Passed |
| Another manager decides the record while the dialog is open | Passed: "That record is already verified. The list has been refreshed." and the queue updated |
| Percentage on the employee page | Passed: 66.67% = 4 verified of 6 eligible (7 rostered, 1 approved leave), with the rejected day reported |
| History: default range, "Show the full 365 days", verification filter, rejection reason | Passed; the date input minimum equals today minus 364 days |
| Layout at 280, 344 px (foldable and phone) | Passed: no horizontal overflow on the employee and history pages |

Fixed during browser testing: S-UX1 the misleading "Tap again to retry" banner
after a lost response (now "Your punch in did go through"); the rejection reason ran
into the next sentence; the three text links were 20 px tall and are now 44 px.

**Not exercised in a browser:** an expired or refreshed session, the 401 "sign in
again" flow after the permission change, the manager page at 280 px, tablet width,
keyboard-only operation, and a real device with real GPS and camera permissions.

### 0B.7 Store Manager ownership and RBAC re-check

- The matrix row, `permissions.ts` and the effective check agree: the generator
  reproduces the file byte for byte, and the test matrix shows only the Store
  Manager reaching the verification routes.
- **The unresolved gap stands: nobody can verify a Store Manager's own attendance.**
  The authoritative requirements (SRS A2/A3) give verification to the Store
  Manager and say Owner oversight does not replace it by default. Granting Owner or
  Operations Manager the right would be a business decision, so it was not done.
  Recorded as ATT-DEC-MGR-SELF.
- **Rejected days are consistent with the SRS but incompletely specified.** A2
  says employees cannot reinstate rejected attendance and that corrections or
  resubmission need manager-controlled review with a recorded decision. The current
  lockout honours the first half. No manager path exists to *change* a rejected
  decision or accept a resubmission (A2's second half), and none was invented
  (ATT-DEC-OVERRIDE).

### 0B.8 Remaining unresolved items kept visible

1. **Kalinga Nagar** has no outlet record; nothing was created or reassigned.
2. **Selfie evidence is not implemented** (no storage integration; mandatory
   capture and retention undecided). SRS A5.5 and acceptance criterion A12.4
   require it, so the amendment is not satisfied without it.
3. **Radius:** the SRS says 150 m; 500 m is implemented by owner instruction.
4. **Legacy days** have no verification status; none were backfilled.
5. **Store Manager verification ownership** (0B.7).

### 0B.9 Why this is "staging validation only"

- Selfie evidence, a stated SRS requirement, is not built.
- No outlet has an active geofence in any real database; Kalinga Nagar cannot be
  configured until an outlet exists, and Saheed Nagar staff cannot self punch until
  it has a verified location.
- The migrations have not been applied to a Supabase-hosted database, and were
  tested on PostgreSQL 16, not the project's 15 or Supabase's version.
- Browser testing used simulated geolocation and no real devices.
- CI's root lint step currently fails (outside attendance).
- Open policy decisions affect real behaviour (0B.8).

### 0B.10 Deployment prerequisites (in order)

1. Decide the open items in 0B.8, and the decisions in the open-decisions document
   marked as affecting behaviour.
2. Provision an isolated staging database; from a host that can reach its direct
   URL, run `bunx prisma migrate deploy` in `apps/api`. Take a backup first.
3. Confirm the staging PostgreSQL version and re-run the legacy-data migration
   check there.
4. Configure each outlet's geofence with `prisma/set-outlet-geofence.ts` (dry run,
   then `--apply`) only after the pin and outlet mapping are confirmed.
5. Provide Redis (`REDIS_URL`); without it the punch idempotency protection is
   silently absent.
6. Synchronize clocks between the API host and the database (S8).
7. Ask Store Managers to sign in again (their permission set changed).
8. Fix the two root lint errors so CI passes.
9. Re-run the full API suite and a real-device browser check (real GPS, real
   permission prompt) against staging.

---

## 0A. Manager verification, breaks, history, percentage, notifications (26 Oct 2026)

Second implementation pass, on top of section 0. **Nothing here is deployed.** The
two migrations (`20261026000000_attendance_geofence`,
`20261026010000_attendance_verification`) are **not applied** to any real database
(Phase 3, section 0B, applied them only to isolated test databases). The test
table in 0A.10 records the state at the end of that pass; **section 0B supersedes
it**: the e2e tests listed there as Not Run were executed in Phase 3.

### 0A.1 What was built

| Capability | Where |
|---|---|
| Day-level verification state and decision fields | `AttendanceDay.verificationStatus` (`PENDING`/`VERIFIED`/`REJECTED`), `verifiedById`, `verifiedAt`, `verificationNote`; enum `AttendanceVerification`; `prisma/schema.prisma`, migration `20261026010000_attendance_verification` |
| Submit, decide, queue, history window, summary | `apps/api/src/modules/workforce/attendance.service.ts` (`punch`, `decide`, `verificationQueue`, `list`, `summary`, `lockDay`) |
| Percentage engine (pure function, unit tested) | `apps/api/src/modules/workforce/attendance-summary.ts` (`summariseAttendance`) |
| Routes | `workforce.controller.ts` |
| New permission | `workforce.attendance.verify`, Store Manager, OWN_OUTLET only. Added to the matrix in `book/src/14-rbac-and-permissions.md` and regenerated into `packages/shared/src/permissions.ts` with `scripts/gen-permissions.mjs` (2-line diff). |
| Notifications | New event keys `ATTENDANCE_SUBMITTED` (to the outlet Store Manager) and `ATTENDANCE_DECIDED` (to the employee), IN_APP only, via the existing outbox: `packages/shared/src/enums.ts`, `notifications.ts`, `recipients.ts`, `templates.ts` |
| Manager UI | `apps/web/app/(app)/attendance/verify/page.tsx` |
| Employee UI | `attendance/page.tsx` (status, rejection reason, percentage), `attendance/history/page.tsx` (365-day window, verification filter and badge) |

### 0A.2 API contract

| Route | Permission | Notes |
|---|---|---|
| `GET /attendance/verification-queue?page&pageSize&outletId` | `workforce.attendance.verify` | Pending days in the caller's outlets, oldest first. The caller's own day is excluded. Returns the server-measured distance, never coordinates. |
| `POST /attendance/days/:id/verify` body `{note?}` | `workforce.attendance.verify` | 200 |
| `POST /attendance/days/:id/reject` body `{reason}` | `workforce.attendance.verify` | `reason` 5 to 280 characters, required |
| `GET /attendance?from&to&status&verification&employeeId&outletId&page&pageSize` | `workforce.attendance.read` | `from` older than 364 days before today returns 400 `ATTENDANCE_WINDOW_EXCEEDED`. With no `from` the window start is used. Self scope is forced to the caller's own records. |
| `GET /attendance/summary?employeeId&from&to` | `workforce.attendance.read` | The single calculation both views read. Self scope ignores/forbids another `employeeId` (404). Managers must name an employee (400 otherwise) in their outlets (404 otherwise). |

New error codes: `ATTENDANCE_DAY_NOT_FOUND` (404), `ATTENDANCE_NOT_PENDING` (409),
`ATTENDANCE_SELF_VERIFY` (403), `ATTENDANCE_DAY_REJECTED` (409),
`ATTENDANCE_BREAK_STILL_OPEN` (409), `ATTENDANCE_WINDOW_EXCEEDED` (400).

### 0A.3 Verification state machine (implemented)

Verification is **per attendance day**, not per punch: SRS A5.10 counts verified
attendance once per workday and A5.12 keeps check-out a separate event. A day
needs one decision however many punches it has.

| From | Trigger | Actor | Result |
|---|---|---|---|
| none (null) | First self punch of the day | Employee | `PENDING`; one `ATTENDANCE_SUBMITTED` outbox row in the same transaction |
| none (null) | Manager-entered punch | Manager | `PENDING` (no notification); a manager entry never auto-verifies, so HR/Owner cannot verify by the back door |
| `PENDING` | verify | Store Manager of the outlet, not the employee | `VERIFIED` + audit `workforce.attendance.verify` + `ATTENDANCE_DECIDED` |
| `PENDING` | reject with reason | same | `REJECTED` + audit `workforce.attendance.reject` + `ATTENDANCE_DECIDED` |
| `VERIFIED` or `REJECTED` | any further decision | anyone | 409 `ATTENDANCE_NOT_PENDING`. There is no override or reinstatement path (see decisions). |
| `REJECTED` | self punch or break | Employee | 409 `ATTENDANCE_DAY_REJECTED`. The employee cannot reopen it. |
| any | later punch or manager edit | any | Verification status is **unchanged** (a later OUT does not reset a verified day) |

Concurrency: the decision is a conditional update on `PENDING`; of two
simultaneous decisions one wins, the other gets 409. Punches and breaks lock the
`AttendanceDay` row `FOR UPDATE` first. The DB also enforces, by CHECK
constraint, that a decision has a verifier and timestamp and that a rejection has
a reason of at least 5 characters.

### 0A.4 Authorization

- Acting identity comes only from the verified token. The request body cannot
  carry an employee id for breaks (strict schema, 400).
- Verify/reject: `workforce.attendance.verify` (Store Manager, OWN_OUTLET). A day
  outside the caller's outlets is 404, not 403. A day belonging to the caller
  (`Employee.userId` equals the caller, or `employeeId` equals the token's) is 403
  `ATTENDANCE_SELF_VERIFY`.
- Not granted: Owner, Operations Manager, HR/Accounts. SRS A2 says Owner oversight
  "does not replace manager verification by default" and A3 gives only the Store
  Manager the verify right. This is a conscious reading, recorded as a decision.

### 0A.5 Breaks

Existing behaviour kept: start needs the last punch to be IN, one open break at a
time, end needs an open break, duration is minutes between the two timestamps, and
breakMins is subtracted from worked time in `recompute`.

Added: the day row is locked so simultaneous start/start or end/end cannot create
two open breaks or close one twice; a rejected day refuses breaks; a **self
punch-out while a break is open is refused** (`ATTENDANCE_BREAK_STILL_OPEN`) so an
end time is never invented. A manager-entered OUT is not blocked, and the open
break is left open and visible (`openBreak: true`); no one closes it for them.
No break limit, deduction or penalty exists or was added.

### 0A.6 History (365 days)

Window = today's business date and the previous 364, using the existing
`toBusinessDate`/`businessDateOffset` helpers (04:00 IST day boundary). Server-side
pagination (existing `pageQuerySchema`, max 100), one query plus one count, no
per-row queries. Rows carry the verification status, `verifiedAt` and the
rejection note; the verifier's id, storage keys and location are not returned.

### 0A.7 Attendance percentage and leave rules

`Eligible = scheduled working days - approved full-day leave on those days`;
`Attendance % = verified present days / eligible days x 100` (SRS A7).

- **Scheduled working day** = a date with a `SCHEDULED` shift for the employee
  (the only roster in the schema). Two shifts on one date count once. No roster
  means N/A, never 0%.
- **Present** = a day with a `VERIFIED` record and status `PRESENT` or `HALF_DAY`.
  Pending, rejected and pre-verification (null) days are never counted, and are
  reported separately (`pendingDays`, `rejectedDays`, `unverifiedDays`) rather than
  hidden or treated as absences.
- **Leave** = `APPROVED` `LeaveRequest` rows read directly, so approval,
  cancellation and date changes recalculate automatically and the original request
  history is untouched (A8.6). Pending, rejected and cancelled leave do not change
  the denominator. The `ON_LEAVE` rows written by `writeLeaveDays` are not used.
- Clamped to joining date and exit date; future dates are not absences.
- Monthly buckets use the same counts and sum to the total.
- Values are never supplied by the client; both the employee card and the manager
  view call `GET /attendance/summary`.

Choices the SRS does not define, implemented conservatively and reported in the
response so they are visible, not silent (see decisions ATT-DEC-HALFDAY,
ATT-DEC-HALFLEAVE, ATT-DEC-TODAY, ATT-DEC-UNSCHEDULED, ATT-DEC-ROUNDING):
a verified HALF_DAY counts as one present day; approved half-day leave does not
reduce the denominator (`halfDayLeaveDays`); the current business date is never an
absence and joins the denominator only once verified present; verified presence on
an unscheduled or on-leave day stays out of the numerator
(`verifiedOnIneligibleDays`) so the figure cannot exceed 100; the result is shown
to two decimals.

### 0A.8 Notifications and audit

- Both notifications are outbox rows written inside the same transaction as the
  state change, so they exist if and only if it committed. Delivery uses the
  existing dispatcher (retry with backoff, 5-minute duplicate suppression); a
  delivery failure cannot roll back a decision.
- Duplicates: submission fires only on the null to PENDING transition (once per
  day); a decision fires once because only one conditional update can succeed.
- Audit rows (existing `AuditLog`): `workforce.attendance.verify`, `.reject`
  (before, after, note, actor), `.manual_punch` (new: manager-entered punches were
  previously unaudited), plus the existing `.edit`. No location data, tokens or
  photo data are logged. The notification body contains the date and, for a
  rejection, the manager's reason, delivered only to that employee.
- Break start/end send no notification: no policy requires one.

### 0A.9 Conflicts and findings (documented, not changed)

| # | Finding | Evidence |
|---|---|---|
| 1 | SRS A2/A5 say 150 m; owner instructed 500 m | section 0.1 |
| 2 | SRS A4 routes (`/employee/...`, `/workforce/...`) are proposals; the app uses `/attendance`, `/attendance/verify`, `/attendance/history`. Existing conventions were followed. | `apps/web/app/(app)/attendance/` |
| 3 | A7 asks for the outlet timezone; the code uses a fixed IST 04:00 business-day helper and `Outlet.timezone` is not read. Equivalent today (both outlets are IST), wrong if an outlet is ever in another zone. | `packages/shared/src/business-date.ts` |
| 4 | **Pre-existing, not fixed:** `LeaveService.decide()` has no self-approval check, so a manager who is also an employee can approve their own leave. | `leave.service.ts` `decide` |
| 5 | **Pre-existing, not fixed:** the LEAVE_REQUESTED/LEAVE_DECIDED templates read `leaveId`, `leaveType`, `decidedByName`, but `leave.service.ts` does not put those in the outbox payload, so those notifications render blanks and a dead deep link. | `templates.ts` vs `leave.service.ts` |
| 6 | **Pre-existing:** `writeLeaveDays` marks every calendar day in a leave range, not just scheduled days. The new summary does not depend on it. | `leave.service.ts` |
| 7 | A manager-entered punch makes the day `PENDING`, so the Store Manager must still verify it. The Store Manager's own attendance has no verifier (ATT-DEC-MGR-SELF). | `attendance.service.ts` |

### 0A.10 Tests

| Check | Result |
|---|---|
| `test/attendance-summary.test.ts`: 20 tests (N/A, pending/rejected/legacy, approved/half-day/multi-day leave, double counting, no-roster, future/today, join and exit clamps, month/year/leap-day buckets, monthly sums) | **Passed** |
| `test/geofence.test.ts`: 23 tests | **Passed** |
| `apps/api` typecheck, lint, build | **Passed** |
| `apps/web` typecheck, lint, build | **Passed** |
| Prisma: `validate` passes; `migrate diff` SQL matches the `AttendanceDay` part of the hand-written migration | **Passed** (offline) |
| `test/workforce.e2e.test.ts`: new describe block (submission and outbox once, staff cannot decide, other-outlet 404, self-verify 403, queue contents, reason validation, verify audit and notification, double and opposite decisions, concurrent decisions, rejected day closes punches and breaks, break overlap/concurrency/checkout-on-break, history window and scoping, summary scoping) | **Superseded: executed in Phase 3, passed (see 0B.3 and 0B.5).** |
| Notification delivery to an inbox, duplicate suppression on redelivery | **Superseded: executed in Phase 3 through the real dispatcher, passed (see 0B.3).** |
| Frontend behaviour (loading, empty, error, conflict-refresh, dialog flows) | **Superseded: browser-tested in Phase 3 (see 0B.6).** `apps/web` still has no component test runner. |
| Migration SQL against a real PostgreSQL | **Superseded: run on PostgreSQL 16.15, fresh and over legacy-shaped data (see 0B.4).** Not run on Supabase. |

Prerequisites for the blocked tests: a PostgreSQL database that is **not** the
shared one, both migrations applied (`bun run db:deploy` with that DB's
`DIRECT_URL`), seeded outlets, Redis for idempotency, then
`bun test test/workforce.e2e.test.ts`. A UI check additionally needs the API and
web dev servers running against it, and a device or emulated geolocation for the
punch flow.

### 0A.11 Not done, and why

- **Selfie evidence:** still blocked (no storage integration, no mandatory/retention
  policy). Verification shows distance and times, not a photo.
- **Kalinga Nagar:** no outlet record; nothing assigned.
- **Verification of a Store Manager's own attendance, override, reinstatement,
  correction-request status:** no approver or process is defined (see decisions).
- **Bulk verify, per-month export, manager-side summary table for all employees:**
  not required by the brief; the summary is per employee.

---

## 1. Architecture overview

```
Browser (Next.js)
  ├── apps\web\app\(app)\attendance\page.tsx          — employee self-service
  ├── apps\web\app\(app)\attendance\board\page.tsx     — live attendance board
  ├── apps\web\app\(app)\attendance\history\page.tsx   — attendance history
  ├── apps\web\app\(app)\leave\page.tsx                — employee leave list
  ├── apps\web\app\(app)\leave\new\page.tsx            — submit leave request
  └── apps\web\app\(app)\leave\approvals\page.tsx      — manager leave queue
        |
        | REST API (/api/v1)
        v
NestJS API (apps\api)
  └── apps\api\src\modules\workforce\
      ├── workforce.module.ts
      ├── workforce.controller.ts
      ├── attendance.service.ts          — punch, break, edit, list, today
      ├── leave.service.ts               — create, decide, cancel, writeLeaveDays
      ├── employees.service.ts
      ├── shifts.service.ts
      └── salary.service.ts
        |
        | Prisma ORM
        v
Supabase PostgreSQL
  ├── AttendanceDay    (one per employee per business date)
  ├── AttendancePunch  (append-mostly; IN/OUT events)
  ├── BreakLog         (one open at a time per employee per day)
  ├── LeaveRequest     (PENDING → APPROVED/REJECTED/CANCELLED)
  └── Shift, Employee, Outlet, AuditLog
```

---

## 2. File paths and key symbols

| File | Key symbols | Purpose |
|---|---|---|
| `apps\api\src\modules\workforce\attendance.service.ts` | `AttendanceService`, `punch()`, `startBreak()`, `endBreak()`, `editPunch()`, `list()`, `today()`, `recompute()`, `pairedMinutes()` | All attendance business logic |
| `apps\api\src\modules\workforce\leave.service.ts` | `LeaveService`, `create()`, `decide()`, `cancel()`, `writeLeaveDays()` | Leave request lifecycle |
| `apps\api\src\modules\workforce\shifts.service.ts` | `ShiftsService` | Roster management |
| `apps\api\src\modules\workforce\employees.service.ts` | `EmployeesService` | Employee CRUD and exit |
| `apps\api\src\modules\workforce\workforce.controller.ts` | Route handlers for all workforce endpoints | Controller layer |
| `apps\api\prisma\schema.prisma` | `AttendanceDay`, `AttendancePunch`, `BreakLog`, `LeaveRequest`, `Shift`, `Employee`, `SalaryRecord` | Database schema |
| `apps\web\app\(app)\attendance\page.tsx` | Employee self-service punch page | Frontend |
| `apps\web\app\(app)\attendance\board\page.tsx` | Live board (manager view) | Frontend |
| `apps\web\app\(app)\attendance\history\page.tsx` | Attendance history | Frontend |
| `apps\web\app\(app)\leave\page.tsx` | Employee leave list | Frontend |
| `apps\web\app\(app)\leave\new\page.tsx` | Leave submission form | Frontend |
| `apps\web\app\(app)\leave\approvals\page.tsx` | Manager leave queue | Frontend |
| `book\src\18-employees-attendance-shifts.md` | Book documentation | Architecture narrative |
| `book\src\19-leave-and-salary.md` | Book documentation | Leave and salary narrative |
| `book\src\14-rbac-and-permissions.md` | RBAC matrix | Permission reference |

---

## 3. Prisma models relevant to attendance (verified in `schema.prisma`)

### AttendanceDay
```
id           String  (uuid)
employeeId   String  (FK → Employee)
outletId     String  (FK → Outlet, frozen at write time)
businessDate DateTime  (@db.Date)
status       String   (ABSENT | PRESENT | HALF_DAY | ON_LEAVE | WEEKLY_OFF)
firstInAt    DateTime?
lastOutAt    DateTime?
workedMins   Int      (default 0)
breakMins    Int      (default 0)
lateMins     Int      (default 0)
note         String?  (set by rollup for SYSTEM_ROLLUP flag)
updatedAt    DateTime

@@unique([employeeId, businessDate])
@@index([outletId, businessDate])
```

### AttendancePunch
```
id              String
attendanceDayId String  (FK → AttendanceDay, CASCADE delete)
direction       String  (IN | OUT)
punchedAt       DateTime
source          String   (default "WEB"; values: WEB, MANAGER_EDIT, SYSTEM_ROLLUP)
editedById      String?  (FK → User)
editReason      String?
createdAt       DateTime

@@index([attendanceDayId, punchedAt])
```

### BreakLog
```
id              String
attendanceDayId String  (FK → AttendanceDay, CASCADE delete)
startedAt       DateTime
endedAt         DateTime?
durationMins    Int?
reason          String?

@@index([attendanceDayId])
```

### LeaveRequest
```
id           String
employeeId   String   (FK → Employee)
type         LeaveType  (CASUAL | SICK | UNPAID | COMP_OFF)
fromDate     DateTime  (@db.Date)
toDate       DateTime  (@db.Date)
dayCount     Decimal   (@db.Decimal(4,1))
reason       String
status       LeaveStatus  (PENDING | APPROVED | REJECTED | CANCELLED)
decidedById  String?
decidedAt    DateTime?
decisionNote String?
createdAt    DateTime
updatedAt    DateTime

@@index([employeeId, status])
@@index([status, fromDate])
```

### Shift (referenced by attendance for lateMins calculation)
```
id          String
employeeId  String
outletId    String
shiftDate   DateTime (@db.Date)
startsAt    DateTime
endsAt      DateTime
status      ShiftStatus (SCHEDULED | CANCELLED | SWAPPED)
note        String?
createdById String

@@unique([employeeId, shiftDate, startsAt])
@@index([outletId, shiftDate])
```

---

## 4. Verified permissions and guards

From `apps\api\src\modules\workforce\attendance.service.ts` and
`book\src\14-rbac-and-permissions.md`:

| Permission | Roles | Scope |
|---|---|---|
| `workforce.attendance.punch_self` | ALL roles | SELF |
| `workforce.break.log_self` | ALL roles | SELF |
| `workforce.attendance.read` | OWNER, OPS_MGR | ALL_OUTLETS |
| `workforce.attendance.read` | STORE_MGR, KITCHEN_MGR | OWN_OUTLET |
| `workforce.attendance.read` | HRA | ALL_OUTLETS |
| `workforce.attendance.read` | All others | SELF |
| `workforce.attendance.edit` | OWNER, OPS_MGR | ALL_OUTLETS |
| `workforce.attendance.edit` | STORE_MGR | OWN_OUTLET |
| `workforce.attendance.edit` | HRA | ALL_OUTLETS |
| `workforce.leave.request` | ALL roles | SELF |
| `workforce.leave.read` | OWNER, OPS_MGR | ALL_OUTLETS |
| `workforce.leave.read` | STORE_MGR, KITCHEN_MGR | OWN_OUTLET |
| `workforce.leave.read` | HRA | ALL_OUTLETS |
| `workforce.leave.read` | All others | SELF |
| `workforce.leave.decide` | OWNER, OPS_MGR | ALL_OUTLETS |
| `workforce.leave.decide` | STORE_MGR | OWN_OUTLET |
| `workforce.leave.decide` | HRA | ALL_OUTLETS |

Guard implementation: `JwtAuthGuard → PermissionsGuard → OutletGuard` (per
`book\src\37-security.md`). Outlet scope enforcement is in `OutletGuard` reading
from `UserOutlet` rows.

---

## 5. Validation (DTOs / Zod schemas)

From `book\src\18-employees-attendance-shifts.md` (schema shapes documented; not
independently verified from controller source):

| Schema | Key constraints |
|---|---|
| `punchBody` | direction: IN/OUT; employeeId optional (manager use); at optional (manager backdating); reason optional |
| `breakStartBody` | employeeId optional; reason optional |
| `editPunchBody` | punchedAt datetime required; reason required (min 3 chars) |
| `listAttendanceQuery` | from/to dates; range max 92 days; outletId optional |
| `createLeaveBody` | type enum; fromDate/toDate; halfDay bool (default false); reason min 5 chars; refine: fromDate <= toDate; halfDay requires single date |

---

## 6. Current status transitions as implemented

As verified in `attendance.service.ts` `recompute()` function (lines 358–367):

```typescript
const status =
  leave && punches.length === 0
    ? 'ON_LEAVE'
    : workedMins >= FULL_DAY_MINS      // 360
      ? 'PRESENT'
      : workedMins >= HALF_DAY_MINS    // 240
        ? 'HALF_DAY'
        : punches.length > 0
          ? 'PRESENT'                  // ANY punch = PRESENT regardless of minutes
          : 'ABSENT';
```

**Important discrepancy from book documentation:** The book (`18-employees-attendance-shifts.md`) describes `workedMins > 0 → HALF_DAY` and `workedMins >= 240 → HALF_DAY`. The actual code sets `PRESENT` for any employee with at least one punch, regardless of worked minutes. This means an employee who punches IN but not OUT would be marked `PRESENT` (not `HALF_DAY`) until the rollup inserts a synthetic OUT.

---

## 7. Existing tests found (from book documentation — not independently executed)

From `book\src\18-employees-attendance-shifts.md`:

- `apps/api/src/modules/attendance/recompute.spec.ts` — 9 unit tests on `recompute()`
- `attendance.e2e-spec.ts` — 16 service/integration tests
- `shifts.e2e-spec.ts` — 7 shift tests
- `attendance-rollup.job.spec.ts` — 9 rollup tests

From `book\src\19-leave-and-salary.md`:

- `leave.e2e-spec.ts` — 23 leave service tests
- `salary.e2e-spec.ts` — 14 salary service tests

**Note:** The existence and passing state of these test files was NOT verified by
running them in this phase. File paths listed in the book may not match the actual
repository layout. The controller and repository files were not found with a glob
search (the workforce module has no separate `attendance.controller.ts` or
`attendance.repository.ts` — everything is in `workforce.controller.ts` and
`attendance.service.ts`).

---

## 8. Confirmed implementation gaps

| Gap | Evidence | Impact |
|---|---|---|
| No outlet geofence coordinates | `Outlet` model in `schema.prisma` has no `latitude` or `longitude` fields | SRS Amendment A5 requirement for 150m radius validation cannot be implemented |
| No selfie/photo capture | No photo upload logic in `attendance.service.ts`; no `selfieRef` field on `AttendancePunch` | SRS Amendment A5 selfie evidence requirement cannot be satisfied |
| No manager verification queue | No `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED` states in `AttendanceDay` or `AttendancePunch`; no verification endpoint in `workforce.controller.ts` | SRS Amendment A5 steps 8–11 not implemented |
| No 365-day rolling analytics endpoint | `list()` limited to 92 days; no analytics endpoint found | SRS Amendment A7 rolling history and percentage calculation not available |
| No attendance percentage calculation endpoint | No endpoint for eligible days, present days, or percentage | SRS Amendment A7 and Feature List 5.9 not satisfied |
| No OutboxEvent for attendance submission/verification | Only `LEAVE_REQUESTED` and `LEAVE_DECIDED` events verified | SRS Amendment requirement that employees are notified of verification decisions not satisfied |
| `writeLeaveDays()` does not filter by scheduled working days | Leave sets `ON_LEAVE` on all calendar days, not only scheduled working days | SRS Amendment A7: "Approved leave reduces eligible working days only for applicable scheduled working days" — overstates ON_LEAVE days |

---

## 9. Potential risks

### Confirmed risks (based on code review)

- **`recompute()` status logic differs from book**: Any punch = PRESENT (not HALF_DAY). An employee with one IN punch and no OUT would be marked PRESENT before the rollup runs. This could inflate attendance percentage if the amendment's "verified present days" rule is applied naively to the current data.
- **`writeLeaveDays()` marks all calendar days as ON_LEAVE**: This overstates leave days relative to the amendment's requirement. Affects eligible-day calculation.
- **Self-approval check**: Book documents that the `decide()` function checks `Employee.id` for self-approval, but this was not verified in the actual service code. If missing, a manager who is also an employee could approve their own leave.

### Potential risks (not verified from code)

- **Idempotency-Key handling in controller**: The book states the key is required, but the enforcement middleware was not confirmed in the controller code.
- **Race condition on break end**: `endBreak()` does not use `SELECT FOR UPDATE` on BreakLog rows (unlike the punch flow). Two simultaneous end-break calls could both succeed.
- **OutboxEvent deduplication**: Whether the notification dispatcher deduplicates events if the rollup retries were not confirmed.

---

## 10. External dependencies

| Dependency | Used for | Phase 1 status |
|---|---|---|
| Supabase PostgreSQL | All attendance, leave, shift, employee data | Active |
| Upstash Redis | Idempotency-Key cache (24h); session caching | Active |
| Supabase Storage (private bucket) | Selfie storage | NOT YET USED for attendance |
| WhatsApp Business API | LEAVE_REQUESTED and LEAVE_DECIDED notifications | Active for leave |

---

## 11. Recommended implementation order for Phase 2

This ordering minimises risk by building on the stable existing foundation before
adding new schema fields.

1. **Outlet geofence coordinates** — Add `latitude`, `longitude`, `geofenceRadiusMetres`
   to the `Outlet` model. No breaking change; nullable fields.

2. **Selfie upload infrastructure** — Confirm Supabase private bucket is available;
   implement upload endpoint; add `selfieRef` to `AttendancePunch`.

3. **Attendance submission review states** — Add `verificationStatus` enum or a new
   `AttendanceSubmission` table. Decide architecture with the team before implementing.

4. **Location validation in punch endpoint** — Server-side distance calculation using
   Haversine formula against configured outlet coordinates.

5. **Manager verification queue** — New endpoint `GET /attendance/verify-queue` and
   `POST /attendance/verify/:id`. Scoped to STORE_MANAGER OWN_OUTLET.

6. **Verification notifications** — New OutboxEvent types for submission and decision.

7. **365-day rolling history endpoint** — New endpoint with proper eligible-day
   calculation, incorporating the scheduled-day filter for leave.

8. **Attendance percentage analytics** — Depends on rolling history. Implement after
   the data model is confirmed stable.

9. **Fix `writeLeaveDays()` eligible-day calculation** — Currently writes ON_LEAVE
   for all calendar days; should only subtract from eligible days when the date is
   a scheduled working day (requires shift/roster input).

10. **Self-approval check verification** — Confirm `decide()` actually enforces the
    documented check; add test if missing.
