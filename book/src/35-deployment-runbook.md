# Deployment runbook

Procedures, not explanation. Each step states what you do and what you should see.
If a step does not produce the expected result, stop and read the troubleshooting
tree at the end rather than continuing and hoping.

Every command assumes you are at the repository root with the Railway CLI
installed (`bun add -g @railway/cli`) and logged in (`railway login`).

## Procedure 1: first-time production setup

Run once, at the start of week 3. Budget 90 minutes. Two people, one running
commands and one reading the steps aloud.

### Supabase

1. Create a Supabase project named `bobs-momo-prod`. Choose region
   `ap-south-1` (Mumbai). **Expected:** project provisions in 2 to 3 minutes,
   status turns green.
   Region matters. Bhubaneswar to Mumbai is roughly 25 to 40 ms. Singapore is
   roughly 70 ms, and every dashboard query makes several round trips.
2. Select the Pro plan. **Expected:** the project shows 8 GB database, 100 GB
   file storage, 7-day backups.
3. Go to Project Settings, Database, Connection string. Copy both the
   **session pooler** string (port 5432) and the **transaction pooler** string
   (port 6543). **Expected:** two URLs, both containing `?pgbouncer=true` on the
   transaction one.
   The API uses the transaction pooler for `DATABASE_URL`. Prisma migrations use
   the session pooler for `DIRECT_URL`, because migrations issue DDL and advisory
   locks that PgBouncer's transaction mode does not support.
4. Go to Database, Backups. Confirm daily backups are on and note the retention
   window. **Expected:** "Daily backups enabled, 7 days retained".
5. Go to Storage. Create a bucket named `task-proof`. Set it to **private**.
   **Expected:** bucket appears, public toggle off.
6. On that bucket, add a policy allowing `service_role` to insert and select, and
   nothing else. **Expected:** an anonymous `curl` of a known object path returns
   403. The API serves files by minting a signed URL with a 15 minute expiry, so
   nothing is ever fetched anonymously.
7. Project Settings, API. Copy the project URL and the `service_role` key.
   **Expected:** two values. The `service_role` key is a secret with full storage
   access. It goes in Railway, nowhere else.

### Upstash Redis

8. Create an Upstash Redis database named `bobs-momo-prod`, region
   `ap-south-1` (Mumbai), Fixed 250 MB plan, TLS enabled, eviction policy
   `allkeys-lru`. **Expected:** database created, region matches Supabase.
9. Copy the **TCP** connection URL, the one starting `rediss://`, not the REST
   URL. **Expected:** a `rediss://default:<password>@<host>:6379` string. The
   application uses `ioredis` over TCP, so the REST URL will not work.
10. Run `redis-cli --tls -u "<url>" PING` from your machine. **Expected:** `PONG`.

### Railway

11. Create a Railway project named `bobs-momo`. Create two environments,
    `staging` and `production`. **Expected:** environment switcher shows both.
12. In `production`, create a service named `api` from the GitHub repository, root
    directory `apps/api`. **Expected:** Railway detects `railway.json` and shows
    the Nixpacks builder.
13. Create a second service named `web`, root directory `apps/web`.
    **Expected:** two services listed.
14. On `api`, open Settings, Networking, and generate a domain. Point
    `api.erp.bobsmomo.in` at it with a CNAME. On `web`, do the same for
    `erp.bobsmomo.in`. **Expected:** both show "Certificate issued" within 10
    minutes.
15. Set every environment variable listed in
    [chapter 09](09-environments-and-configuration.md) on the `api` service. At minimum:
    `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
    `JWT_REFRESH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
    `SUPABASE_STORAGE_BUCKET`, `WHATSAPP_PHONE_NUMBER_ID`,
    `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_ENABLED`, `CORS_ORIGINS`, `APP_TIMEZONE`,
    `NODE_ENV`, `LOG_LEVEL`. **Expected:** the config validator refuses to boot if
    any is missing, so a missing value shows as a crash loop with a named
    variable in the logs, not a mystery.
16. Generate the two JWT secrets with `openssl rand -base64 48` each. Use
    different values for staging and production. **Expected:** two 64-character
    strings that exist in exactly one place, the Railway dashboard.
17. On `web`, set `NEXT_PUBLIC_API_URL=https://api.erp.bobsmomo.in/api/v1` and
    `NODE_ENV=production`. **Expected:** two variables.
18. Deploy both services once from the Railway dashboard. **Expected:** `api`
    fails its health check, because the database has no tables yet. This is
    correct at this stage.

### Database and first user

19. From your machine, with `DIRECT_URL` exported, run the migration.
    ```bash
    export DATABASE_URL="<session pooler url>"
    bunx prisma migrate deploy --schema apps/api/prisma/schema.prisma
    ```
    **Expected:** every migration listed as applied, ending with
    "All migrations have been successfully applied".
20. Run the production seed. It inserts units, item categories, the two outlets,
    departments, checklist templates and the recurrence rows. It inserts no
    users, no employees and no stock.
    ```bash
    bun run db:seed:prod
    ```
    **Expected:** output lists 6 units, 5 categories, 2 outlets (`BM-SAHEED`,
    `BM-PATIA`), 8 departments, 4 checklist templates.
21. Create the first OWNER user. The script prompts for a username and generates
    a temporary password.
    ```bash
    bun run scripts/create-owner.ts --username bobsmomo.owner \
      --email owner@bobsmomo.in
    ```
    **Expected:** the script prints a 16-character temporary password once and
    creates the user with `mustReset: true`. Copy it into the client's hands
    directly, by phone or in person. Do not put it in WhatsApp, email or a
    ticket.
22. Redeploy the `api` service. **Expected:** health check passes within 60
    seconds, service status green.
23. Run the smoke suite against production.
    ```bash
    SMOKE_BASE_URL=https://api.erp.bobsmomo.in \
    SMOKE_WEB_URL=https://erp.bobsmomo.in \
    SMOKE_USER=... SMOKE_PASSWORD=... bun run smoke
    ```
    **Expected:** all six checks print `ok`.
24. Log in as the OWNER in a browser. **Expected:** forced to the password change
    screen, and after changing it, the dashboard loads with both outlets visible
    and every figure at zero.

## Procedure 2: routine release

1. Confirm `main` is green in GitHub Actions. **Expected:** the latest commit
   shows a green check on all five required checks.
2. Confirm the staging deploy that ran on that merge finished and its smoke
   passed. **Expected:** the `deploy staging` job is green and its "Smoke test"
   step printed six `ok` lines.
3. Click through the change on staging yourself. Not a test, an actual look at
   the screen the client will see. **Expected:** the change behaves as the ticket
   describes.
4. Open the GitHub Actions run and approve the `production` environment gate.
   **Expected:** the production job starts.
5. Watch the "Apply migrations to production" step. **Expected:** either "No
   pending migrations" or a list of applied migrations, in under 30 seconds.
6. Watch the "Wait for the health check" step. **Expected:** passes within 3
   minutes.
7. Watch the post-deploy smoke step. **Expected:** six `ok` lines.
8. Tag the release and push the tag.
   ```bash
   git tag -a v1.3.0 -m "stock transfer between outlets"
   git push origin v1.3.0
   ```
   **Expected:** the tag appears in GitHub.
9. Watch the Railway logs for the `api` service for two minutes. **Expected:**
   no `level: error` lines, request log lines flowing normally.
10. If the release changed anything a user will notice, message the client.
    **Expected:** one short line naming what changed, in the client WhatsApp
    group.

Release during business hours only, and not between 06:00 and 08:00 IST when both
kitchens are doing opening stock, or between 19:00 and 22:00 IST when both
outlets are at peak. The safe window is roughly 14:00 to 17:00 IST.

## Procedure 3: hotfix release

Use this when production is broken and the fix is small and understood. If you do
not understand the cause yet, use Procedure 4 instead and investigate with
service restored.

1. Branch from `main`, not from your feature branch.
   ```bash
   git checkout main && git pull && git checkout -b fix/purchase-total-rounding
   ```
   **Expected:** a clean branch at the currently deployed commit.
2. Write the failing test first. **Expected:** it fails for the reason the
   incident describes. If it passes, you have the wrong cause.
3. Fix it. Run `bun test` locally. **Expected:** the new test passes and nothing
   else broke.
4. Open the pull request with title `fix(scope): description`. **Expected:** all
   five checks run.
5. Get the review. A hotfix still gets reviewed. A second pair of eyes costs four
   minutes and a wrong hotfix costs an evening.
6. Squash merge. **Expected:** staging deploys and smokes automatically.
7. Approve the production gate immediately. **Expected:** production live in
   about four minutes.
8. Verify the specific broken behaviour by hand against production.
   **Expected:** the reported symptom is gone.
9. Tag as a patch: `v1.3.1`. **Expected:** tag pushed.
10. Write the post-incident note (template at the end of this chapter) within 24
    hours. **Expected:** a file in `docs/incidents/`.

## Procedure 4: rollback

1. Decide what you are rolling back. Check the Railway deployment list.
   ```bash
   railway deployments --service api --environment production
   ```
   **Expected:** a list with the current deployment first and its commit SHA.
2. Confirm the previous deployment is the one you want. Match its SHA against
   `git log`. **Expected:** the SHA is the last known-good release.
3. Roll back.
   ```bash
   railway rollback --service api --environment production
   ```
   **Expected:** Railway starts the previous image. Takes about 40 seconds.
4. If the web service is also affected, roll it back too.
   ```bash
   railway rollback --service web --environment production
   ```
   **Expected:** frontend serves the previous build.
5. Run the smoke suite. **Expected:** six `ok` lines.
6. Verify the specific symptom is gone. **Expected:** the reported problem no
   longer reproduces.
7. Do not roll back the database. The migration stays applied. Every migration in
   this project is written to be backward compatible with the previous release,
   which is what makes step 3 safe. See
   [chapter 34](34-ci-cd.md) for why, and Procedure 5 for what to do when a
   migration genuinely has to be undone.
8. Announce to the client: "We rolled back a change from this afternoon, the
   system is working normally, the fix will go out tomorrow." **Expected:** they
   hear it from you before they notice it themselves.
9. Revert the bad commit on `main` so the next merge does not redeploy it.
   ```bash
   git revert <sha> && git push
   ```
   **Expected:** staging redeploys to the rolled-back state, keeping staging and
   production aligned.

### Restoring the database

Only for a genuinely destructive migration or data loss.

1. Set the `api` service to 0 replicas in the Railway dashboard. **Expected:** the
   app goes offline. This is intentional, you are stopping further writes.
2. In Supabase, go to Database, Backups. Identify the most recent backup before
   the damage. **Expected:** a timestamp you can name.
3. Trigger the restore. **Expected:** Supabase warns this replaces the current
   database. Confirm.
4. Wait. **Expected:** restore completes in 5 to 20 minutes for a database this
   size.
5. Export the `AuditLog` rows created between the backup timestamp and the stop,
   from any read replica or export you took before restoring. **Expected:** a
   list of business actions that will need to be re-entered by hand.
6. Restore the `api` service to 1 replica. **Expected:** health check passes.
7. Re-enter the lost actions with the client. **Expected:** a short list, because
   the window is measured in hours and the business does maybe 200 writes a day.

## Procedure 5: a migration that needs a maintenance window

Applies when a migration is not backward compatible, holds a long lock, or
rewrites a large table. Most migrations do not need this. Check first.

1. Confirm the migration actually needs a window. It does if it drops a column
   still read by the running release, adds `NOT NULL` without a default to a
   populated table, changes a column type, or rewrites more than 100,000 rows.
   **Expected:** a one-line written justification in the pull request.
2. Try the expand and contract path from [chapter 11](11-migrations-and-seed.md) instead.
   **Expected:** in most cases the change splits into three safe deploys and no
   window is needed. If so, stop here and use Procedure 2 three times.
3. If a window is genuinely needed, agree it with the client at least 24 hours
   ahead. Pick 15:00 to 15:30 IST on a weekday. **Expected:** written confirmation
   in the client group.
4. Take a manual Supabase backup immediately before the window.
   **Expected:** backup listed with a timestamp you noted.
5. Post the maintenance banner. Set `MAINTENANCE_MODE=true` on the `web` service
   and redeploy. **Expected:** every page shows "System maintenance until 15:30,
   please use the paper register for now."
6. Set the `api` service to 0 replicas. **Expected:** API offline, no writes
   possible.
7. Apply the migration from your machine with `DIRECT_URL`.
   ```bash
   export DATABASE_URL="<session pooler url>"
   bunx prisma migrate deploy --schema apps/api/prisma/schema.prisma
   ```
   **Expected:** applied, with the elapsed time printed. If it exceeds your
   estimate by 3x, do not cancel it midway. Cancelling a rewrite can leave a
   partial state. Let it finish and extend the window.
8. Deploy the new API code. **Expected:** health check passes.
9. Set `api` back to 1 replica. **Expected:** service green.
10. Run the smoke suite. **Expected:** six `ok` lines.
11. Set `MAINTENANCE_MODE=false` and redeploy `web`. **Expected:** normal app
    returns.
12. Tell the client the window closed. **Expected:** message sent before the
    stated end time, not after.

## Procedure 6: rotating a leaked secret

Assume the secret is compromised the moment you suspect it. Rotate first, ask how
later.

### JWT access or refresh secret

1. Generate a new value: `openssl rand -base64 48`.
2. Set it on the `api` service in Railway. **Expected:** Railway triggers a
   redeploy.
3. Truncate the refresh token table, because every existing refresh token is now
   unverifiable anyway.
   ```sql
   DELETE FROM "RefreshToken";
   ```
   **Expected:** all sessions invalidated.
4. Tell the client every user must log in again. **Expected:** message sent
   before they start calling.
5. Verify by logging in yourself. **Expected:** login works, an old browser tab
   gets 401 on its next request and is redirected to the login screen.

### Supabase service_role key

1. In Supabase, Project Settings, API, roll the `service_role` key.
   **Expected:** a new key, the old one invalid immediately.
2. Update `SUPABASE_SERVICE_KEY` on the `api` service. **Expected:** redeploy.
3. Verify a task photo upload works end to end. **Expected:** file lands in the
   `task-proof` bucket and the signed URL renders.
4. Note that rolling this key breaks nothing else, because the key is used only by
   the API for storage operations.

### Database password

1. In Supabase, Project Settings, Database, reset the database password.
   **Expected:** new connection strings shown.
2. Update `DATABASE_URL` and `DIRECT_URL` on the `api` service, and
   `PROD_DATABASE_URL` and `PROD_DATABASE_URL_READONLY` in GitHub secrets.
   **Expected:** all four updated.
3. Redeploy `api`. **Expected:** health check passes. Expect roughly 60 seconds of
   connection errors while the pooler drops old connections.
4. Re-run the migration drift check in CI. **Expected:** passes, proving the
   GitHub secret is correct.

### WhatsApp access token

1. In Meta Business Manager, revoke the token and generate a new permanent token
   for the system user. **Expected:** new token string.
2. Update `WHATSAPP_ACCESS_TOKEN` on the `api` service. **Expected:** redeploy.
3. Send a test notification: trigger a `LEAVE_REQUESTED` event on staging pointed
   at your own number, or use the admin test endpoint. **Expected:** message
   arrives.
4. Check the outbox for events that went `DEAD` while the token was invalid.
   ```sql
   SELECT id, "eventKey", "lastError" FROM "OutboxEvent"
   WHERE status = 'DEAD' AND "createdAt" > now() - interval '2 hours';
   ```
   **Expected:** a list. Requeue them by setting `status = 'PENDING'`,
   `attempts = 0`.

### Redis URL

1. In Upstash, reset the password. **Expected:** new `rediss://` URL.
2. Update `REDIS_URL` on `api`. **Expected:** redeploy.
3. Verify `/readyz` reports `redis: ok`. **Expected:** 200 with all three
   dependencies healthy. Cached dashboards will be cold for a few minutes, which
   is a performance blip and not an outage.

### If a secret reached git history

1. Rotate it first, using the steps above. The value in history is dead the moment
   you rotate. **Expected:** rotation done before anything else.
2. Only then consider history rewriting. On a private repository with two
   contributors, `git filter-repo` plus a force push is feasible, but it invalidates
   every open branch and every local clone. **Expected:** a decision recorded in
   the incident note, either way.
3. Add the pattern to `.gitleaks.toml` so the pre-commit hook catches the next
   one. **Expected:** committing a similar string is blocked locally.

## Procedure 7: adding a third outlet

The SRS promises that the architecture supports adding outlets without redesign.
This is the proof. No code changes, no migration, no deploy. Roughly 30 minutes.

1. Insert the outlet. Through the admin UI at Settings, Outlets, New, or via SQL.
   ```sql
   INSERT INTO "Outlet" (id, code, name, address, timezone, "isActive")
   VALUES (gen_random_uuid(), 'BM-CHANDRA', 'Bob''s Momo Chandrasekharpur',
           '...', 'Asia/Kolkata', true);
   ```
   **Expected:** one row. `code` is unique, so a typo of an existing code fails
   loudly.
2. Create its departments. Kitchen, Counter, Store, Admin, matching the other
   outlets so reports group cleanly. **Expected:** four rows in `Department`,
   unique on `(outletId, name)`.
3. Create `ItemStock` rows for every active item at the new outlet, with
   `qtyOnHand` 0 and `reorderLevel` copied from the nearest comparable outlet.
   ```sql
   INSERT INTO "ItemStock" (id, "itemId", "outletId", "qtyOnHand", "reorderLevel")
   SELECT gen_random_uuid(), s."itemId", '<new outlet id>', 0, s."reorderLevel"
   FROM "ItemStock" s
   JOIN "Outlet" o ON o.id = s."outletId" AND o.code = 'BM-PATIA';
   ```
   **Expected:** one row per active item. This is the step people forget. Without
   it, the first stock transaction at the new outlet fails because there is no
   balance row to update.
4. Create the employees, each with `outletId` set to the new outlet.
   **Expected:** rows in `Employee` with unique `employeeCode`.
5. Create the users, each with `roleKey` and a `UserOutlet` row pointing at the
   new outlet. **Expected:** `OWN_OUTLET` users see only this outlet.
6. Confirm no `UserOutlet` rows are needed for OWNER or OPERATIONS_MANAGER. They
   resolve every active outlet at login. **Expected:** the owner sees three
   outlets in the switcher after their next login, with no data change.
7. Create outlet-specific checklist templates only if the new outlet's process
   differs. Templates with `outletId` null already apply everywhere.
   **Expected:** in most cases, nothing to do.
8. Create `TaskRecurrence` rows for the new outlet, or confirm existing rows with
   `outletId` null already cover it. **Expected:** opening and closing checklists
   generate for the new outlet at 07:00 and 22:00 IST the next day.
9. Add a `DailySalesEntry` reminder expectation: the 23:30 IST job checks every
   active outlet, so no configuration is needed. **Expected:** a
   `SALES_ENTRY_MISSING` notification if nobody enters sales on the first day.
10. Verify by logging in as a new-outlet user, recording an opening stock entry
    and completing a checklist. **Expected:** both succeed, and the owner
    dashboard shows a third column.
11. Check the analytics endpoints. **Expected:** the third outlet appears without
    a code change, because every query groups by `outletId` rather than by a
    hardcoded pair.

The only limit is cost. A third outlet adds perhaps 15 more users and 30 percent
more rows, which is well inside the Supabase Pro and Upstash Fixed 250 MB plans.
Nothing in the pricing changes until roughly the eighth outlet.

## Procedure 8: onboarding a new staff user

1. Create the employee record first. Admin, Employees, New. Fill name, phone,
   outlet, department, designation, joined date. **Expected:** an
   `employeeCode` like `BM-EMP-0031` is generated, employee appears in the
   outlet's list.
2. Create the user account. Admin, Users, New. Enter a username following the
   convention `firstname.lastname`, pick the role from the nine in
   [chapter 14](14-rbac-and-permissions.md), and link it to the employee record.
   **Expected:** the form refuses to save if the employee already has a user.
3. Select the outlets. For any role other than OWNER or OPERATIONS_MANAGER, tick
   exactly the outlets this person works at. **Expected:** at least one outlet
   required.
4. Save. **Expected:** the system generates a temporary password, displays it once
   on screen, and sets `mustReset: true`. It is never emailed and never stored in
   readable form.
5. Copy the temporary password and hand it over in person or read it over a phone
   call. **Expected:** the new user has it and you have not written it anywhere.
6. The user opens `erp.bobsmomo.in` and logs in with the username and temporary
   password. **Expected:** login succeeds but every screen redirects to the
   password change page. The API returns
   `403 PASSWORD_RESET_REQUIRED` on any other endpoint, so this cannot be skipped
   by typing a URL.
7. The user sets a new password. Minimum 10 characters, checked against a list of
   common passwords. **Expected:** `mustReset` flips to false, a fresh access and
   refresh token pair is issued, and the user lands on the dashboard for their
   role.
8. Confirm the user sees the right things. A KITCHEN_STAFF user should see their
   own tasks, their own attendance and nothing else. **Expected:** no inventory
   value figures, no salary, no other outlets.
9. Set notification preferences if the default is wrong. **Expected:** rows in
   `NotificationPreference` only where the user opted out of a default.
10. If the user forgets the temporary password before first login, an admin resets
    it from Admin, Users, Reset password. **Expected:** a new temporary password,
    `mustReset` back to true, and an `AuditLog` row with action
    `admin.user.password_reset` naming the admin who did it.

## Operations reference

| What | Where | Who has access |
|---|---|---|
| Application, production | `https://erp.bobsmomo.in` | all staff users |
| API, production | `https://api.erp.bobsmomo.in` | the application |
| Application, staging | `https://staging.erp.bobsmomo.in` | agency only |
| Railway dashboard | `railway.app` project `bobs-momo` | agency lead, agency engineer |
| Supabase dashboard | `supabase.com` project `bobs-momo-prod` | agency lead, agency engineer |
| Upstash console | `console.upstash.com` | agency lead |
| Meta WhatsApp Business | `business.facebook.com` | agency lead, client owner |
| GitHub repository | private, `wideangle/bobs-momo-erp` | agency lead, agency engineer |
| Uptime monitor | free tier checker on `/healthz` | agency lead |
| Domain and DNS | client's registrar | client owner, agency lead |

The client owner holds the WhatsApp Business account and the domain, because those
outlive any agency relationship. The agency holds the infrastructure credentials
during Phase 1 and hands them over at project close, documented in
[chapter 40](40-acceptance-and-uat.md).

### Support expectation

This is a fixed-price Rs 45,000 build with an infrastructure target under
Rs 5,000 per month. There is no 24/7 on-call rotation at that price, and pretending
otherwise would be dishonest to the client and unsustainable for the two people
building it.

What is actually committed:

| Window | Response | Covers |
|---|---|---|
| Mon to Sat, 10:00 to 19:00 IST | within 2 hours | anything |
| Outside that window | next business morning | anything non-blocking |
| System completely down, any time | best effort within 4 hours | login broken, API returning 5xx to everyone, data loss |

"Best effort" means the lead will act if reachable. It is not a guarantee. The
client should know this before go-live, not discover it on a Sunday evening. Say
it plainly in the handover meeting: the paper register stays in the drawer for the
first month, and if the system is down at 21:00 on a Sunday, use it and tell us in
the morning.

### Escalation path

```text
  Staff member notices a problem
            │
            ▼
  Outlet Store Manager triages
            │  Is it "I do not know how" or "it is broken"?
            ├─── how ────▶ check the user guide, ask the other manager
            │
            └─── broken ──▶ message the client WhatsApp group with:
                             what they were doing, what they expected,
                             what happened, a screenshot, the time
                                     │
                                     ▼
                          Agency engineer acknowledges
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
             Not blocking work              Blocking the business
             ticket, next release           incident, this chapter's
                                            incident checklist
                                                     │
                                                     ▼
                                            Agency lead informed
                                            within 30 minutes
```

## Troubleshooting decision tree

```text
  START: something is wrong
     │
     ▼
  Can you load https://erp.bobsmomo.in in a browser?
     │
     ├── NO ──▶ Does https://api.erp.bobsmomo.in/healthz return 200?
     │            ├── NO ──▶ Railway dashboard: is the `api` service running?
     │            │            ├── crash loop ──▶ read the last 100 log lines.
     │            │            │      A named env var in the error = a missing
     │            │            │      or wrong variable. Fix it, redeploy.
     │            │            │      "Can't reach database server" = go to
     │            │            │      the database branch below.
     │            │            ├── deploying ──▶ wait 3 min, recheck.
     │            │            └── running, no traffic ──▶ check the domain
     │            │                   CNAME and the Railway certificate.
     │            └── YES ──▶ the API is fine, the web service is not.
     │                         Railway: check the `web` service. Roll back
     │                         `web` only (Procedure 4, step 4).
     │
     └── YES ──▶ Does the page load but actions fail?
                  │
                  ├── 500 on some endpoints ──▶ Railway logs, filter
                  │     level=error. Group by `module` and `action`.
                  │     One module failing = a code bug, hotfix it.
                  │     Every module failing = look at the message.
                  │
                  ├── "Cannot reach the server" in the browser ──▶ open
                  │     devtools, network tab. CORS error = CORS_ORIGINS
                  │     is wrong for this domain. 401 on everything =
                  │     a JWT secret changed, users must log in again.
                  │
                  ├── Slow dashboard, everything else fine ──▶
                  │     1. Is Redis reachable? GET /readyz.
                  │        redis: fail = cache is bypassed, every request
                  │        hits Postgres. Check Upstash console for the
                  │        daily command limit or a bandwidth cap.
                  │     2. Supabase dashboard, Query Performance. Look for
                  │        a sequential scan on StockTransaction or
                  │        DailySalesEntry. A missing index after a
                  │        migration is the usual cause.
                  │     3. Supabase connection count. Near the pooler
                  │        limit = something is leaking connections.
                  │        Restart `api` to clear, then find the leak.
                  │
                  ├── Notifications not arriving ──▶
                  │     1. SELECT status, count(*) FROM "OutboxEvent"
                  │        GROUP BY status.
                  │        All PENDING and growing = the dispatcher cron
                  │        is not running, go to the jobs branch.
                  │        DEAD rows = read lastError.
                  │     2. lastError mentions 401 or "access token" =
                  │        the WhatsApp token expired. Procedure 6.
                  │     3. lastError mentions template = Meta rejected
                  │        the message template. Check template approval
                  │        status in Business Manager.
                  │     4. Events DONE but no message = check
                  │        Notification.status. SUPPRESSED = the user
                  │        turned that channel off. FAILED = read
                  │        failReason.
                  │
                  ├── Scheduled jobs not running ──▶
                  │     1. Railway logs, search "job.start". Nothing in
                  │        the last hour = the scheduler did not boot.
                  │     2. Did the service restart recently? A restart
                  │        mid-window can skip one run. Check
                  │        TaskRecurrence.lastRunAt.
                  │     3. Is APP_TIMEZONE set to Asia/Kolkata? A missing
                  │        value means cron fires on UTC, so the 07:00
                  │        checklist appears at 12:30 IST.
                  │     4. Trigger manually via the admin job endpoint to
                  │        confirm the job itself works.
                  │
                  └── Database connection errors ──▶
                        1. Supabase status page. A provider incident
                           means wait, not debug.
                        2. Supabase dashboard, Database, Connections.
                           At the limit = restart `api`, then look for
                           a leaked PrismaClient.
                        3. Is DATABASE_URL the transaction pooler
                           (6543) and DIRECT_URL the session pooler
                           (5432)? Swapping them causes migrations to
                           hang and normal queries to exhaust
                           connections.
                        4. Database size near 8 GB = the plan limit.
                           Check row counts on StockTransaction and
                           AuditLog first.
```

## Incident checklist

Capture before you fix. Once the system is restarted, the evidence is gone.

1. Note the wall-clock time you were told, and the time the reporter says it
   started. **Expected:** two timestamps in IST.
2. Screenshot or copy the exact error the user saw, including the `requestId` if
   one is shown. **Expected:** a string you can grep the logs for.
3. Pull the last 500 log lines from Railway before doing anything else.
   ```bash
   railway logs --service api --environment production > /tmp/incident.log
   ```
   **Expected:** a file. Railway's retention is short, so this is the only copy
   you will have in a week.
4. Screenshot the Railway service state, the Supabase connection graph and the
   Upstash metrics. **Expected:** three images, timestamped.
5. Record the currently deployed commit SHA. **Expected:** a SHA you can compare
   against the previous release.
6. Run these three queries and save the output.
   ```sql
   SELECT status, count(*) FROM "OutboxEvent" GROUP BY status;
   SELECT count(*) FROM "StockTransaction" WHERE "createdAt" > now() - interval '2 hours';
   SELECT action, count(*) FROM "AuditLog" WHERE "createdAt" > now() - interval '2 hours' GROUP BY action;
   ```
   **Expected:** three result sets showing whether writes were happening during
   the window.
7. Only now, fix it. Procedure 3 or Procedure 4.

### Communicating to the client

Within 15 minutes of confirming a real incident, one message in the client group:
what is not working, what staff should do instead, and when you will next update.
Nothing else. No cause, no blame, no estimate you are not sure of.

> "The stock screen is not saving right now. Please use the paper register for
> stock entries and we will enter them once it is back. Next update by 15:30."

Then update at the time you said, even if the update is "still working on it,
next update by 16:00". A missed promised update costs more trust than the outage
did.

When it is resolved, one closing message naming what staff need to do to catch
up. If nothing needs catching up, say that explicitly, because they will assume
otherwise.

### Post-incident note template

Written within 24 hours, into `docs/incidents/YYYY-MM-DD-short-name.md`. No blame,
no names, one page.

```markdown
# Incident: <short name>

- Date: 2026-09-14
- Detected: 14:22 IST, by the Patia store manager
- Started: approximately 14:05 IST
- Resolved: 15:10 IST
- Duration of impact: 65 minutes
- Severity: staff could not record stock issues at either outlet

## What happened

Two or three sentences. What broke, in plain language.

## Why

The actual cause, not the trigger. "A migration added a NOT NULL column the
running release did not populate" rather than "the deploy failed".

## Impact

Who could not do what, for how long, and what data needs re-entering. Name the
number of affected transactions if you can count them.

## Timeline

| Time (IST) | Event |
|---|---|
| 14:05 | Release v1.4.0 deployed |
| 14:22 | Reported in the client group |
| 14:31 | Rolled back API to v1.3.2 |
| 14:34 | Smoke checks passed, service restored |
| 15:10 | Client confirmed stock entries working |

## What we are changing

One to three concrete items with an owner and a date. A test that would have
caught it, a check added to the pipeline, a step added to a procedure in this
chapter. If the answer is "nothing, this was a one-off", write that and why.

## What we are not changing

Anything that was suggested and deliberately rejected, with the reason. This
stops the same suggestion coming back at the next incident.
```
