# Tasks, checklists and audits

The SRS asks for six things: one-time tasks, recurring tasks, opening
checklists, closing checklists, cleaning and SOP checklists, and operational
audits. It then says the obvious thing out loud: "The same task engine powers"
all of them, "avoiding a separate, duplicate module for each."

That instruction is the most valuable sentence in the document, and it is worth
understanding why before writing any code.

Strip the labels off those six features and look at what is left. Each one is a
unit of work with a title, an outlet, an optional assignee, a due time, and a
status that moves from not-started to done. Each one needs comments, because
somebody will need to say "the fridge is still warm". Each one needs a photo
sometimes. Each one needs to appear on a manager's board when it is late. A
checklist adds a list of sub-items with pass or fail. An audit is a checklist
where a failure creates work. A recurring task is a task with a rule that makes
more of them.

Build five modules and you get five task lists, five overdue sweeps, five
notification paths, five permission sets and five places to fix the same bug. A
manager then has five screens to check, which in a QSR means they check none of
them. Build one `Task` table with a discriminator and the differences collapse
into four enum values and two nullable foreign keys.

Requirements implemented: FR-TASK-001 (create and assign), FR-TASK-002
(complete), FR-TASK-003 (overdue notification) and FR-TASK-004 (checklist and
audit execution).

> **Spec note:** this chapter introduces the permission keys
> `task.task.create`, `task.task.read`, `task.task.update_self`,
> `task.task.complete`, `task.task.cancel`, `task.template.manage` and
> `task.recurrence.manage` (`task.task.verify` is already in chapter 14); the
> error codes `TASK_INVALID_TRANSITION`, `CHECKLIST_INCOMPLETE`,
> `PHOTO_REQUIRED`, `NOTE_REQUIRED`, `VERIFICATION_NOT_REQUIRED`,
> `TEMPLATE_MISMATCH`, `ATTACHMENT_TOO_LARGE` and `UNSUPPORTED_MIME_TYPE`; and
> a partial unique index on `Task(recurrenceId, outletId, businessDate)`.

## The four kinds of task

`TaskKind` is the discriminator. It decides which nullable columns are
populated, whether `TaskChecklistResult` rows exist, and what the default for
`requiresVerification` is.

| | ONE_OFF | RECURRING_INSTANCE | CHECKLIST_RUN | AUDIT_RUN |
|---|---|---|---|---|
| Created by | A manager, or a failed audit item | The generator job | The generator job, or a manager | The generator job, or a manager |
| `templateId` | null | null | set | set, template `isAudit = true` |
| `recurrenceId` | null | set | set when scheduled | set when scheduled |
| `parentTaskId` | set when it came from a failed item | null | null | null |
| `TaskChecklistResult` rows | none | none | one per template item | one per template item |
| `requiresVerification` default | false | false | false | true |
| Completed via | `POST /tasks/:id/complete` | `POST /tasks/:id/complete` | `POST /tasks/:id/checklist` | `POST /tasks/:id/checklist` |
| `dueAt` from | The creating manager | `businessDate + dueAfterMins` | `businessDate + dueAfterMins` | `businessDate + dueAfterMins` |
| Typical example | "Call the AC technician" | "Post today's sales figure" | Kitchen opening checklist | Monthly hygiene audit |

Everything else on the row behaves identically across all four. The board query
does not branch on kind. The overdue sweep does not branch on kind. The
notification dispatcher does not branch on kind. The only places that branch are
the completion path (checklist submit versus plain complete) and the generator.

`AUDIT_RUN` is the one kind that defaults `requiresVerification` to true, and
that is because an audit is somebody checking somebody else's work. A hygiene
audit that nobody senior ever looks at is a form-filling exercise.

## The task state machine

```text
                         POST /tasks
                              │
                              ▼
                       ┌─────────────┐
        ┌──────────────│    OPEN     │──────────────┐
        │              └──────┬──────┘              │
        │ POST :id/cancel     │ POST :id/start      │
        │                     ▼                     │  sweep:
        │              ┌─────────────┐              │  dueAt < now
        │◄─────────────│ IN_PROGRESS │              │
        │ POST         └──────┬──────┘              │
        │ :id/cancel          │                     ▼
        ▼                     │              ┌─────────────┐
  ┌─────────────┐             │              │   OVERDUE   │
  │  CANCELLED  │             │              └──────┬──────┘
  └─────────────┘             │                     │
                              │    start / complete │
                              │◄────────────────────┘
                              │
                              │ POST :id/complete
                              │ POST :id/checklist
                              ▼
                       ┌─────────────┐
                       │  COMPLETED  │
                       └──────┬──────┘
                              │ POST :id/verify
                              │ only when requiresVerification
                              ▼
                       ┌─────────────┐
                       │  VERIFIED   │
                       └─────────────┘
                        terminal
```

| From | To | Trigger | Permission | Actor | Event |
|---|---|---|---|---|---|
| (none) | OPEN | `POST /tasks` | `task.task.create` | Manager, or the system | `TASK_ASSIGNED` when an assignee is set |
| OPEN | IN_PROGRESS | `POST /tasks/:id/start` | `task.task.update_self` | Assignee, or a manager | none |
| OPEN | COMPLETED | `POST /tasks/:id/complete` | `task.task.complete` | Assignee, or a manager | none |
| OPEN | CANCELLED | `POST /tasks/:id/cancel` | `task.task.cancel` | Creator or a manager | none |
| OPEN | OVERDUE | overdue sweep | system | job | `TASK_OVERDUE` |
| IN_PROGRESS | COMPLETED | `POST /tasks/:id/complete` or `/checklist` | `task.task.complete` | Assignee | none |
| IN_PROGRESS | CANCELLED | `POST /tasks/:id/cancel` | `task.task.cancel` | Creator or a manager | none |
| IN_PROGRESS | OVERDUE | overdue sweep | system | job | `TASK_OVERDUE` |
| OVERDUE | IN_PROGRESS | `POST /tasks/:id/start` | `task.task.update_self` | Assignee | none |
| OVERDUE | COMPLETED | `POST /tasks/:id/complete` or `/checklist` | `task.task.complete` | Assignee | none |
| OVERDUE | CANCELLED | `POST /tasks/:id/cancel` | `task.task.cancel` | Manager | none |
| COMPLETED | VERIFIED | `POST /tasks/:id/verify` | `task.task.verify` | Manager | none |

`OVERDUE` is not terminal. This is the detail people get wrong. A task that goes
overdue is still work that needs doing, and the sweep flagging it does not
absolve anybody. Completing an overdue task moves it straight to `COMPLETED`,
and the fact that it was late is recorded by `completedAt > dueAt`, which is a
comparison of two columns that already exist. There is no `wasLate` boolean,
because a boolean can drift out of sync with the timestamps and the timestamps
cannot drift out of sync with themselves. The on-time rate metric later in this
chapter reads exactly that comparison.

`overdueNotifiedAt` stays stamped after the task leaves `OVERDUE`, so the
history of "this one went late" survives a start or a complete.

Any status change attempted through `PATCH /tasks/:id` is rejected with
`TASK_INVALID_TRANSITION`. Status moves through the five dedicated endpoints and
nowhere else. That keeps every transition guard in one service method per
transition instead of a switch statement inside a generic update.

## No approval on routine completion

From the SRS, section 10.1: "No manager approval is required for routine task
completion. Verification exists only where a specific task or business rule
genuinely requires it."

`Task.requiresVerification` defaults to `false`. A cook finishes cleaning the
grill, taps complete, and the task is done. The manager sees it on the board as
completed. Nobody signs anything.

`requiresVerification` is set true in exactly two places: an `AUDIT_RUN`
generated from a template with `isAudit = true`, and a manager explicitly
ticking "needs my sign-off" when creating a one-off task. Those are the narrow
cases the `VERIFIED` status exists for.

Read that as a design constraint with teeth. During UAT somebody will ask for a
manager tick on every completed task, because a verification column looks like
accountability. It is not. In a kitchen with 15 tasks a day per outlet, a
verification step means 30 approvals a day landing on a store manager who is
also expediting orders, which means they get batch-approved at 22:00 without
being read, which means the data is now worse than no data because it looks
verified. The client rejected approval layers explicitly and repeatedly across
purchase, leave and tasks. Do not add them back.

## Checklist templates

```text
  ChecklistTemplate                ChecklistTemplateItem
  ─────────────────                ─────────────────────
  code      KITCHEN_OPEN           sortOrder        1
  name      Kitchen opening        label            Check fridge temp < 4C
  isAudit   false                  requiresPhoto    true
  outletId  null  ◄── all outlets  requiresNote     false
  isActive  true                   failCreatesTask  true
       │                                   ▲
       └────────── 1 : N ──────────────────┘
                   @@unique([templateId, sortOrder])
```

`outletId` is nullable and null means the template applies to every outlet. That
is how `KITCHEN_OPEN` is defined once and runs at both Saheed Nagar and Patia. A
template with an `outletId` set is outlet-specific, which is what you use when
one kitchen has a tandoor and the other does not.

`isAudit` flips the generated task's kind to `AUDIT_RUN` and its
`requiresVerification` to true. That is the entire difference between a
checklist and an audit at the data level.

Three per-item flags control what the submitting employee has to provide:

`requiresPhoto` means the result row must carry an `attachmentId`. Used for
anything a manager would otherwise have to walk over and look at: fridge
thermometer reading, oil colour in the fryer, the state of the floor drain.

`requiresNote` means the result row must carry a non-empty `note`. Used for
readings and counts, where "PASS" alone loses the number.

`failCreatesTask` means a `FAIL` on this item spawns follow-up work.

### What failCreatesTask does

```text
  POST /tasks/{auditTaskId}/checklist
  { "results": [ ..., { "templateItemId": "i7", "result": "FAIL",
                      "note": "Chimney filter clogged" }, ... ] }
        │
  ═════ BEGIN TRANSACTION ═══════════════════════════════════════
   1. validate every active template item has a result
   2. INSERT TaskChecklistResult rows (upsert on taskId+templateItemId)
   3. FOR each FAIL on an item with failCreatesTask = true:
        INSERT Task {
          kind:         ONE_OFF
          title:        'Fix: ' + item.label
          description:  result.note
          parentTaskId: auditTaskId
          outletId:     auditTask.outletId
          priority:     HIGH
          assigneeId:   store manager of that outlet
          dueAt:        now + 24h
          businessDate: auditTask.businessDate
          requiresVerification: true
        }
        INSERT OutboxEvent AUDIT_ITEM_FAILED
   4. UPDATE parent task status = COMPLETED, completedAt = now
  ═════ COMMIT ══════════════════════════════════════════════════
        │
        ▼
   200 { task, results, followUpTasks: [ { id, title, dueAt } ] }
```

Everything in one transaction. If the follow-up insert fails, the `FAIL` result
does not get recorded either, because a recorded failure with no follow-up is a
problem that has been observed and then dropped. That is worse than not
observing it, since the audit trail now says somebody looked.

The follow-up is `HIGH` priority, not `URGENT`. `URGENT` is reserved for things
a manager raises by hand when the situation warrants it, and a priority level
that fires automatically stops meaning anything within a week.

The 24 hour due window is a constant in config. It is deliberately short: the
point of an audit is that failures get fixed before the next audit.

`AUDIT_ITEM_FAILED` goes to the Store Manager and the Operations Manager on
in-app and WhatsApp, per the event table in chapter 21. The Operations Manager is on
that list because cross-outlet visibility of failures is the thing the owner is
actually buying.

`parentTaskId` links the follow-up back to the audit run, so the audit's detail
screen shows what came out of it and whether it got fixed.

## Recurrence

```prisma
model TaskRecurrence {
  cronExpr     String        // "0 7 * * *", evaluated in Asia/Kolkata
  templateId   String?       // set for checklists and audits
  title        String?       // set for plain recurring tasks
  outletId     String?       // null = fan out to every active outlet
  departmentId String?
  assigneeId   String?
  priority     TaskPriority  @default(NORMAL)
  dueAfterMins Int           @default(120)
  isActive     Boolean       @default(true)
  lastRunAt    DateTime?
}
```

`cronExpr` is a standard five field cron expression, and it is evaluated in
`Asia/Kolkata`, not UTC and not the server's locale. `0 7 * * *` means 07:00
IST, which is 01:30 UTC. Getting this wrong puts the kitchen opening checklist
on the board at 12:30 in the afternoon, and it is the kind of bug that survives
staging because staging runs on the same misconfigured clock. The generator uses
`cron-parser` with `{ tz: 'Asia/Kolkata' }` and there is a unit test asserting
the UTC instant of the next fire.

### The generator job

`apps/api/src/jobs/recurring-tasks.job.ts`, cron `*/15 * * * *`.

```ts
async run(now = new Date()) {
  const recurrences = await this.prisma.taskRecurrence.findMany({
    where: { isActive: true },
    include: { template: { include: { items: true } } },
  });

  for (const rec of recurrences) {
    // window: everything since we last looked, capped at 24h of catch-up
    const since = maxDate(rec.lastRunAt ?? subHours(now, 24),
                         subHours(now, 24));
    const fireTimes =
      cronFireTimesBetween(rec.cronExpr, since, now, 'Asia/Kolkata');
    if (fireTimes.length === 0) continue;

    const outlets = rec.outletId
      ? [await this.repo.outlet(rec.outletId)]
      : await this.repo.activeOutlets();

    for (const fireAt of fireTimes) {
      const businessDate = toBusinessDate(fireAt);
      for (const outlet of outlets) {
        await this.createInstance(rec, outlet, fireAt, businessDate);
      }
    }
    await this.prisma.taskRecurrence.update({
      where: { id: rec.id }, data: { lastRunAt: now },
    });
  }
}
```

`createInstance` writes the task and, when the recurrence has an assignee, an
`OutboxEvent` for `TASK_ASSIGNED`, in one transaction. It catches the unique
violation and moves on:

```ts
try {
  await this.prisma.$transaction(...);
} catch (e) {
  // already generated by an earlier or concurrent run
  if (isUniqueViolation(e, 'task_recurrence_day_uniq')) return;
  throw e;
}
```

The idempotency guard is a partial unique index, written by hand in the
migration because Prisma cannot express a partial unique constraint in the
schema file:

```sql
CREATE UNIQUE INDEX task_recurrence_day_uniq
  ON "Task" ("recurrenceId", "outletId", "businessDate")
  WHERE "recurrenceId" IS NOT NULL;
```

This is the whole defence against duplicate generation, and it is in the
database rather than in application code on purpose. The job runs every 15
minutes, a Railway deploy can restart it mid-run, `lastRunAt` might not have
committed, and two overlapping runs are possible. Every one of those situations
ends in the same place: the second insert violates the index and gets swallowed.
No distributed lock, no advisory lock, no leader election.

The constraint carries one rule with it: a recurrence fires at most once per
outlet per business date. A checklist that runs at open and at close is two
recurrence rows pointing at two templates, which is how `KITCHEN_OPEN` and
`CLOSING` are configured anyway. If the client ever needs a genuinely twice-daily
single template, the index gains the fire hour. Not in Phase 1.

### Why instances are materialised

A tempting alternative is to compute recurring tasks on read: hold the cron
expressions, and when somebody opens their task list, evaluate which instances
should exist today. No generator job, no duplicate rows, no index.

It does not work, because a task instance accumulates state that has nowhere to
live. It gets an assignee, and reassignment has to persist. It gets comments. It
gets checklist results, one row per item. It gets a photo attachment. It gets
started at 07:14 and completed at 07:52. It goes overdue and a notification
fires once. Every one of those needs a row with a stable id, and the moment you
create that row you have materialised the instance anyway, just lazily and with
a race condition on first read.

So the generator materialises. The cost is a job every 15 minutes and about
20 rows a day. The benefit is that a task instance is an ordinary row that every
other part of the system already understands.

### A worked example

The client configures `KITCHEN_OPEN`:

```json
{
  "name": "Kitchen opening checklist",
  "cronExpr": "0 7 * * *",
  "templateId": "tpl-kitchen-open",
  "outletId": null,
  "departmentId": "dept-kitchen",
  "assigneeId": null,
  "priority": "NORMAL",
  "dueAfterMins": 120,
  "isActive": true
}
```

The template has `isAudit = false` and 11 items. Two outlets are active.

At 07:00 IST the cron fires. The generator run at 07:00 (or the next run within
15 minutes) finds one fire time in its window and creates two tasks:

| Field | Saheed Nagar task | Patia task |
|---|---|---|
| `kind` | CHECKLIST_RUN | CHECKLIST_RUN |
| `title` | Kitchen opening checklist | Kitchen opening checklist |
| `outletId` | BM-SAHEED | BM-PATIA |
| `departmentId` | Kitchen | Kitchen |
| `templateId` | tpl-kitchen-open | tpl-kitchen-open |
| `recurrenceId` | rec-kitchen-open | rec-kitchen-open |
| `businessDate` | 2026-08-26 | 2026-08-26 |
| `dueAt` | 2026-08-26 09:00 IST | 2026-08-26 09:00 IST |
| `assigneeId` | null | null |
| `status` | OPEN | OPEN |

`dueAt` is the fire time plus `dueAfterMins`, so 07:00 plus 120 minutes gives
09:00. `assigneeId` is null because the recurrence did not name one, which means
the task is outlet-level: it appears on the Kitchen department's shared list and
on the manager's board, and whoever opens the kitchen picks it up. No
`TASK_ASSIGNED` notification fires, because there is nobody to notify. If the
recurrence had named an assignee, both tasks would carry it and both employees
would get in-app and WhatsApp notifications.

At 09:00 neither task is complete. At 09:00 or within ten minutes, the overdue
sweep sets both to `OVERDUE`, stamps `overdueNotifiedAt` and emits two
`TASK_OVERDUE` events to the respective store managers. No `TaskChecklistResult`
rows exist yet; they are created by the submit, not by the generator.

## The overdue sweep

`apps/api/src/jobs/overdue-tasks.job.ts`, cron `*/10 * * * *`.

```sql
UPDATE "Task"
   SET status = 'OVERDUE',
       "overdueNotifiedAt" = now()
 WHERE status IN ('OPEN', 'IN_PROGRESS')
   AND "dueAt" < now()
   AND "overdueNotifiedAt" IS NULL
RETURNING id, "outletId", "assigneeId", "createdById", title, "dueAt";
```

The `WHERE` clause is served by `@@index([status, dueAt])` from the schema. With
`status` as the leading column and a small enum cardinality, Postgres seeks the
two relevant status values and then range-scans `dueAt`, so the sweep touches
only tasks that are actually late rather than the whole table. At Phase 1 volume
the table is a few thousand rows and any plan would do, but the index is free
and the query stays flat when the client adds outlets.

The returned rows are turned into `OutboxEvent` rows for `TASK_OVERDUE` inside
the same transaction as the `UPDATE`. If the dispatcher is down, the events sit
in the outbox and go out when it recovers. That is the whole point of the outbox
pattern from ADR-003.

`overdueNotifiedAt` exists to make the notification fire once. Without it, the
sweep would re-select the same late task every ten minutes and emit an event
every time. A task that goes late on Friday evening and gets picked up Monday
morning would generate 372 notifications, each one a WhatsApp message the client
pays Meta for, to a store manager who muted the app after the fifth. One
notification per task, and the manager's board carries the ongoing state.

The column is never cleared. If a task goes overdue, gets completed, and a
manager later reopens the equivalent work, that is a new task with a new row.

## Completion

`PATCH /tasks/:id` edits fields: title, description, priority, `dueAt`,
`assigneeId`, `requiresVerification`. It cannot change `status`. Changing the
assignee emits a fresh `TASK_ASSIGNED` to the new person.

Status moves through the dedicated endpoints. `start` stamps `startedAt`.
`complete` stamps `completedAt` and requires the task not be a `CHECKLIST_RUN`
or `AUDIT_RUN` with unsubmitted results, which it enforces by returning
`CHECKLIST_INCOMPLETE`. `verify` stamps `verifiedAt` and `verifiedById` and
returns `VERIFICATION_NOT_REQUIRED` when `requiresVerification` is false, so a
manager cannot quietly introduce a sign-off step the system did not ask for.

### Submitting a checklist

`POST /tasks/:id/checklist` takes every item result in one request. Not one
request per item. A cook on a phone in a kitchen doorway gets one round trip,
one spinner and one failure mode, and the whole submission is atomic.

```ts
export const submitChecklistBody = z.object({
  results: z.array(z.object({
    templateItemId: z.string().uuid(),
    result:         z.nativeEnum(ChecklistItemResult),   // PASS FAIL NA
    note:           z.string().trim().max(500).nullish(),
    attachmentId:   z.string().uuid().nullish(),
  })).min(1).max(100),
});
```

Validation, in order, before anything is written:

1. The task's `templateId` is not null, else 422 `TEMPLATE_MISMATCH`.
2. Every `templateItemId` belongs to that template, else 422
   `TEMPLATE_MISMATCH`.
3. Every template item has exactly one result, else 422 `CHECKLIST_INCOMPLETE`
   with the missing item labels in `details`.
4. Every item with `requiresPhoto` and result `PASS` or `FAIL` carries an
   `attachmentId` that belongs to this task, else 422 `PHOTO_REQUIRED`.
5. Every item with `requiresNote` and result `PASS` or `FAIL` carries a non-empty
   `note`, else 422 `NOTE_REQUIRED`.

A result of `NA` skips the photo and note requirements, because "the fryer was
not used today" is a legitimate answer and demanding a photo of an unused fryer
teaches staff to photograph anything to make the form go away.

Then the transaction from the `failCreatesTask` diagram runs: upsert the result
rows, create follow-ups, set the parent to `COMPLETED`.

The upsert is on `@@unique([taskId, templateItemId])`, which makes the whole
endpoint naturally idempotent. A double-tapped submit writes the same rows
twice with the same values. Follow-up task creation is guarded by checking for
an existing child with the same `parentTaskId` and title before inserting, so a
replay does not duplicate the follow-up either.

### Photo upload

Supabase Storage, private bucket `task-proof`, signed URLs both ways.

```text
  1. POST /tasks/:id/attachments
     { "mimeType": "image/jpeg", "sizeBytes": 1843200 }
             │
             │  validate mime in allow-list, size <= 5 MB
             │  build storageKey
             │  INSERT TaskAttachment (row exists before the bytes do)
             │  supabase.storage.createSignedUploadUrl(key, 300s)
             ▼
     201 { "attachmentId": "...", "uploadUrl": "https://...",
           "expiresInSecs": 300 }

  2. Browser PUTs the file bytes straight to uploadUrl
     (never through the API, so the API never buffers a 5 MB body)

  3. POST /tasks/:id/checklist  with attachmentId on the result row

  4. GET /tasks/:id returns attachments with a fresh
     createSignedUrl(key, 300s) for display
```

Limits: 5 MB per file, mime in `image/jpeg`, `image/png`, `image/webp`. Both are
checked server-side at step 1 and both are enforced again by the bucket policy,
because a signed upload URL is a capability and the client half of a validation
is a suggestion.

Storage key convention:

```text
  task-proof/{outletCode}/{businessDate}/{taskId}/{attachmentId}.{ext}
  task-proof/BM-PATIA/2026-08-26/9a3f.../e71c....jpg
```

Outlet first so a per-outlet cleanup or export is a prefix listing. Business
date second so retention by age is a prefix listing too. Task id third so
everything about one checklist run sits together. The attachment id as filename
means no collision and no user-supplied string anywhere in the path, which
removes path traversal as a category.

The bucket is private. There is no public URL for a task photo, ever. Reads go
through a 300 second signed URL minted on the `GET /tasks/:id` response, which
is long enough to render an image and short enough that a leaked link in a
WhatsApp forward is dead by the time anyone clicks it.

Attachment rows whose upload never happened are orphans. Phase 1 leaves them.
They are a few bytes of row and a manager never sees them, and a cleanup job for
a 250 MB annual storage footprint is work with no payoff.

## Endpoint reference

All paths relative to `/api/v1`. Bearer auth on every call.

One routing note before the list: `/tasks/my`, `/tasks/board` and
`/tasks/compliance` must be declared above `/tasks/:id` in the controller.
NestJS matches routes in declaration order, and a `:id` parameter route declared
first will swallow `my` and try to parse it as a UUID.

### GET /tasks

| | |
|---|---|
| Permission | `task.task.read` |
| Scope | OWN_OUTLET, ALL_OUTLETS for OWNER and OPERATIONS_MANAGER |
| Success | 200 |

```ts
export const listTasksQuery = z.object({
  outletId:     z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  assigneeId:   z.string().uuid().optional(),
  kind:         z.nativeEnum(TaskKind).optional(),
  status:       z.array(z.nativeEnum(TaskStatus)).optional(),
  priority:     z.nativeEnum(TaskPriority).optional(),
  from:         z.string().date().optional(),      // businessDate
  to:           z.string().date().optional(),
  q:            z.string().trim().max(60).optional(),
  page:         z.coerce.number().int().min(1).default(1),
  pageSize:     z.coerce.number().int().min(1).max(100).default(25),
});
```

Rules: `from` and `to` filter `businessDate`, not `createdAt`. Default ordering
is priority desc, then `dueAt` ascending with nulls last. A caller holding only
the `SELF` scope has `assigneeId` forced to their own employee id.

### POST /tasks

| | |
|---|---|
| Permission | `task.task.create` |
| Scope | OWN_OUTLET |
| Success | 201 |

```ts
export const createTaskBody = z.object({
  title:        z.string().trim().min(3).max(120),
  description:  z.string().trim().max(2000).nullish(),
  outletId:     z.string().uuid(),
  departmentId: z.string().uuid().nullish(),
  assigneeId:   z.string().uuid().nullish(),
  templateId:   z.string().uuid().nullish(),
  priority:     z.nativeEnum(TaskPriority).default('NORMAL'),
  dueAt:        z.string().datetime().nullish(),
  requiresVerification: z.boolean().default(false),
});
```

```json
{
  "id": "9a3f...", "kind": "ONE_OFF", "title": "Call the AC technician",
  "outletId": "a1...", "assigneeId": "8f1c...", "priority": "HIGH",
  "status": "OPEN", "dueAt": "2026-08-27T06:30:00.000Z",
  "businessDate": "2026-08-26", "requiresVerification": false
}
```

Rules: `kind` is derived, never supplied. No `templateId` gives `ONE_OFF`; a
template with `isAudit = false` gives `CHECKLIST_RUN`; `isAudit = true` gives
`AUDIT_RUN` and forces `requiresVerification` to true. `businessDate` comes from
the 04:00 IST rule at creation time. `assigneeId` must be an `ACTIVE` or
`ON_NOTICE` employee of `outletId`. `dueAt` may not be in the past. Emits
`TASK_ASSIGNED` when `assigneeId` is set and the assignee has a linked `User`.

Errors: 400 `VALIDATION_FAILED`, 404 `NOT_FOUND` for an out-of-scope outlet,
422 `EMPLOYEE_NOT_ACTIVE`, 422 `ASSIGNEE_OUTLET_MISMATCH`.

### GET /tasks/:id

Permission `task.task.read`, scope OWN_OUTLET, 200. Returns the task plus the
assignee and creator summaries, the template items with any recorded results,
comments, attachments with fresh signed URLs, the parent task summary when
`parentTaskId` is set, and the child follow-up tasks. This is the one endpoint
that assembles everything, because the task detail screen needs it all in one
round trip on a phone. 404 `NOT_FOUND` outside scope.

### PATCH /tasks/:id

Permission `task.task.update_self`, scope OWN_OUTLET, 200.

```ts
export const updateTaskBody = createTaskBody
  .omit({ outletId: true, templateId: true })
  .partial();
```

Rules: `status` is not in the schema and an attempt to send it returns
422 `TASK_INVALID_TRANSITION` with a message naming the correct endpoint.
`outletId` and `templateId` are immutable. Changing `assigneeId` emits a fresh
`TASK_ASSIGNED`. Tasks in `COMPLETED`, `VERIFIED` or `CANCELLED` reject edits
with 409 `TASK_INVALID_TRANSITION`.

### POST /tasks/:id/start

Permission `task.task.update_self`, scope SELF for the assignee or OWN_OUTLET for a
manager, 200. Empty body. Sets `IN_PROGRESS` and stamps `startedAt` if not
already set. Valid from `OPEN` and `OVERDUE`. Anything else is
409 `TASK_INVALID_TRANSITION`.

### POST /tasks/:id/complete

| | |
|---|---|
| Permission | `task.task.complete` |
| Scope | SELF for the assignee, OWN_OUTLET for a manager |
| Success | 200 |

```ts
export const completeTaskBody = z.object({
  note:          z.string().trim().max(500).optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
});
```

Rules: valid from `OPEN`, `IN_PROGRESS` and `OVERDUE`. Sets `completedAt`. A
`CHECKLIST_RUN` or `AUDIT_RUN` with no submitted results returns
422 `CHECKLIST_INCOMPLETE` pointing at the checklist endpoint. `note` is stored
as a `TaskComment` authored by the completer, so the completion note and the
conversation live in one list.

Errors: 409 `TASK_INVALID_TRANSITION`, 422 `CHECKLIST_INCOMPLETE`,
403 `FORBIDDEN` when a non-assignee without a manager key completes.

### POST /tasks/:id/verify

Permission `task.task.verify`, scope OWN_OUTLET, 200. Body is an optional
`note`. Valid only from `COMPLETED` and only when `requiresVerification` is
true. Stamps `verifiedAt` and `verifiedById`. The verifier may not be the
assignee who completed it.

Errors: 409 `TASK_INVALID_TRANSITION`, 422 `VERIFICATION_NOT_REQUIRED`,
403 `FORBIDDEN` on self-verification.

### POST /tasks/:id/cancel

Permission `task.task.cancel`, scope OWN_OUTLET, 200.

```ts
export const cancelTaskBody = z.object({
  reason: z.string().trim().min(3).max(300),
});
```

Rules: valid from `OPEN`, `IN_PROGRESS` and `OVERDUE`. `reason` is required and
is stored as a `TaskComment` plus an `AuditLog` row. A cancelled task is excluded
from the assignee's completion rate denominator, which is why the reason
matters: cancellation is the one status that erases a task from somebody's
performance figures, and an unexplained cancellation is an unaudited favour.

Errors: 409 `TASK_INVALID_TRANSITION`, 400 `VALIDATION_FAILED`.

### POST /tasks/:id/comments

Permission `task.task.read`, scope SELF or OWN_OUTLET, 201.

```ts
export const createCommentBody = z.object({
  body: z.string().trim().min(1).max(1000),
});
```

Rules: anybody who can read the task can comment on it, including on a completed
or cancelled task, because "this came back on Tuesday" is worth recording.
`authorId` is the caller's employee id.

### GET /tasks/:id/comments

Permission `task.task.read`, scope SELF or OWN_OUTLET, 200. Paged, oldest first,
served by `@@index([taskId, createdAt])`.

### POST /tasks/:id/attachments

| | |
|---|---|
| Permission | `task.task.update_self` |
| Scope | SELF for the assignee, OWN_OUTLET for a manager |
| Success | 201 |

```ts
export const createAttachmentBody = z.object({
  mimeType:  z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
});
```

```json
{
  "attachmentId": "e71c...",
  "storageKey": "task-proof/BM-PATIA/2026-08-26/9a3f.../e71c....jpg",
  "uploadUrl": "https://xyz.supabase.co/storage/v1/object/upload/sign/...",
  "expiresInSecs": 300
}
```

Errors: 422 `ATTACHMENT_TOO_LARGE`, 422 `UNSUPPORTED_MIME_TYPE`,
409 `TASK_INVALID_TRANSITION` on a completed or cancelled task.

### POST /tasks/:id/checklist

Permission `task.task.complete`, scope SELF for the assignee or OWN_OUTLET, 200.
Schema, validation order and transaction are in the sections above.

```json
{
  "task": { "id": "9a3f...", "status": "COMPLETED",
            "completedAt": "2026-08-26T03:52:00.000Z" },
  "results": [
    { "templateItemId": "i1", "result": "PASS", "note": "3.1 C" },
    { "templateItemId": "i7", "result": "FAIL",
      "note": "Chimney filter clogged with grease" }
  ],
  "followUpTasks": [
    { "id": "c02b...", "title": "Fix: Chimney filter clean",
      "priority": "HIGH", "dueAt": "2026-08-27T03:52:00.000Z" }
  ]
}
```

Errors: 422 `CHECKLIST_INCOMPLETE`, 422 `PHOTO_REQUIRED`, 422 `NOTE_REQUIRED`,
422 `TEMPLATE_MISMATCH`, 409 `TASK_INVALID_TRANSITION`.

### GET /tasks/my

Permission `task.task.read`, scope SELF, 200. The staff screen.

```ts
export const myTasksQuery = z.object({
  includeCompleted: z.coerce.boolean().default(false),
});
```

Rules: returns tasks where `assigneeId` is the caller's employee id, plus
unassigned tasks for the caller's outlet and department, because that is how an
outlet-level checklist reaches the person who opens the kitchen. Grouped into
`overdue`, `today` and `upcoming`. No pagination: if a cook has more than 25
open tasks, pagination is not the problem.

```json
{
  "overdue":  [ { "id": "9a3f...", "title": "Kitchen opening checklist",
                  "kind": "CHECKLIST_RUN", "dueAt": "...", "itemCount": 11,
                  "completedItemCount": 0, "priority": "NORMAL" } ],
  "today":    [],
  "upcoming": []
}
```

### GET /tasks/board

Permission `task.task.read`, scope OWN_OUTLET, 200. The manager view: columns by
status, one card per task, filtered by outlet, department, assignee and date
range. Same filter schema as `GET /tasks`, response grouped by status with per
column counts so the UI does not count client-side.

### GET /checklist-templates

Permission `task.template.manage` to write, `task.task.read` to list, scope
OWN_OUTLET, 200. Query by `code`, `isAudit`, `isActive` and `outletId`, where
`outletId` returns both the outlet's own templates and the global ones with a
null `outletId`.

### POST /checklist-templates

Permission `task.template.manage`, scope ALL_OUTLETS, 201.

```ts
export const createTemplateBody = z.object({
  code:        z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,39}$/),
  name:        z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).nullish(),
  isAudit:     z.boolean().default(false),
  outletId:    z.string().uuid().nullish(),
  items: z.array(z.object({
    sortOrder:       z.number().int().min(1),
    label:           z.string().trim().min(3).max(200),
    requiresPhoto:   z.boolean().default(false),
    requiresNote:    z.boolean().default(false),
    failCreatesTask: z.boolean().default(false),
  })).min(1).max(60),
});
```

Rules: `code` is unique and uppercase. `sortOrder` must be unique within the
template, enforced by `@@unique([templateId, sortOrder])` and checked in the
service so the error is readable. Creating a template with `isAudit = true`
means every generated run defaults to `requiresVerification`.

Errors: 409 `DUPLICATE_TEMPLATE_CODE`, 400 `VALIDATION_FAILED`.

### PATCH /checklist-templates/:id

Permission `task.template.manage`, scope ALL_OUTLETS, 200. Edits name,
description, `isActive` and the item list.

Editing items on a template with historical runs does not rewrite those runs.
`TaskChecklistResult` points at `templateItemId`, so deleting an item would
orphan old results. Item removal is therefore a soft operation: the item is
dropped from the template's active list but the row survives for historical
result rendering. Changing a label changes it for past runs too, which is the
one place this design leaks and is accepted because a label edit is almost
always a typo fix.

### GET /task-recurrences

Permission `task.recurrence.manage`, scope OWN_OUTLET, 200. Lists recurrences
with the next three fire times computed in `Asia/Kolkata`, so an admin
configuring a cron expression can see what it will do before saving.

### POST /task-recurrences

Permission `task.recurrence.manage`, scope ALL_OUTLETS, 201.

```ts
export const createRecurrenceBody = z.object({
  name:         z.string().trim().min(3).max(80),
  cronExpr:     z.string().trim()
                  .refine(isValidCron, 'invalid cron expression'),
  templateId:   z.string().uuid().nullish(),
  title:        z.string().trim().min(3).max(120).nullish(),
  outletId:     z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  assigneeId:   z.string().uuid().nullish(),
  priority:     z.nativeEnum(TaskPriority).default('NORMAL'),
  dueAfterMins: z.number().int().min(15).max(1440).default(120),
}).refine(v => !!v.templateId || !!v.title,
  { message: 'either templateId or title is required' });
```

Rules: exactly one of `templateId` and `title` drives what gets generated. A
cron expression finer than daily is accepted but the once-per-business-date
index means only the first fire of each date materialises, so the UI warns on
anything with more than one fire per day.

Errors: 400 `VALIDATION_FAILED`, 404 `NOT_FOUND` for a missing template.

### PATCH /task-recurrences/:id

Permission `task.recurrence.manage`, scope ALL_OUTLETS, 200. Same fields plus
`isActive`. Setting `isActive = false` stops generation and leaves existing
instances alone, which is the correct behaviour when a checklist is being
retired mid-week.

### GET /tasks/compliance

| | |
|---|---|
| Permission | `task.task.read` |
| Scope | OWN_OUTLET, ALL_OUTLETS for OWNER |
| Success | 200 |

```ts
export const complianceQuery = z.object({
  outletId: z.string().uuid().optional(),
  from:     z.string().date(),
  to:       z.string().date(),
  kind:     z.array(z.nativeEnum(TaskKind))
              .default(['CHECKLIST_RUN', 'AUDIT_RUN']),
});
```

```json
{
  "from": "2026-08-01", "to": "2026-08-26",
  "data": [
    {
      "outletId": "a1...", "outletCode": "BM-PATIA",
      "generated": 52, "completed": 47, "cancelled": 1,
      "completionRate": 0.921, "onTimeRate": 0.808,
      "failedItems": 6, "followUpsOpen": 2,
      "byTemplate": [
        { "code": "KITCHEN_OPEN", "generated": 26, "completed": 25,
          "completionRate": 0.962 }
      ]
    }
  ]
}
```

Rules: `completionRate` is `completed / (generated - cancelled)`. This is the
number the owner looks at to answer "is the Patia kitchen actually running the
opening checklist", which was one of the original reasons for the project.

## Employee performance metrics

The SRS asks for "performance / activity visibility for managers (task
completion rate, attendance consistency)" under FR-EMP and again in the
analytics table. Here are the definitions, because a metric without a written
formula gets computed three different ways in three different screens.

All three take a `from` and `to` pair of Asia/Kolkata business dates, both
inclusive. Both filter on `Task.businessDate` and `AttendanceDay.businessDate`,
never on `createdAt`. A task created on the 25th for a due date on the 28th
belongs to the 25th, which is the date the work was assigned.

### Task completion rate

```text
              tasks with status in (COMPLETED, VERIFIED)
  rate  =  ────────────────────────────────────────────────
            tasks assigned to E, businessDate in [from,to],
            dueAt <= rangeEnd, status != CANCELLED
```

Two exclusions carry all the weight.

Cancelled tasks are excluded from the denominator entirely. This is the
denominator trap and it is worth stating on its own line: a task cancelled by a
manager must not count against the assignee. The manager cancelled it because
the AC technician was not needed, or the delivery did not arrive, or the task
was a duplicate. Counting it as a miss punishes an employee for a decision they
did not make, and once staff notice, the metric stops being trusted and starts
being gamed.

Tasks with `dueAt` after the range end are excluded too. A task due next Tuesday
is not incomplete today, it is not due yet, and including it drags the current
month's rate down for no reason. Tasks with no `dueAt` at all are included in
the denominator, because an undated task assigned three weeks ago and never
touched is a real miss.

### On-time rate

```text
                completed tasks where completedAt <= dueAt
  rate  =  ───────────────────────────────────────────────────
             completed tasks with a non-null dueAt in range
```

Tasks with no `dueAt` are excluded from both numerator and denominator. There is
no way to be late for a deadline that does not exist, and putting them in the
denominator would make an undated task an automatic miss.

`OVERDUE` is not consulted. The comparison is `completedAt` against `dueAt`,
which is true whether or not the sweep happened to run before the completion.
A task completed 90 seconds after its due time is late by this measure and the
sweep may never have seen it. That is correct.

### Attendance consistency

```text
             (PRESENT days) + 0.5 x (HALF_DAY days)
  rate  =  ──────────────────────────────────────────
            days in range with a SCHEDULED shift, minus
            days with status ON_LEAVE

  ABSENT days are in the denominator and not the numerator.
  WEEKLY_OFF days are in neither.
```

Approved leave is excluded from the denominator, not counted as a miss.
Somebody who took a week of approved leave and worked every other day has a
consistency of 1.0, which is the honest answer. `WEEKLY_OFF` days are excluded
for the same reason. Only a scheduled shift creates an expectation, which is the
same principle as `lateMins` being zero without a shift in chapter 18.

`HALF_DAY` counting as 0.5 is a judgement call that keeps the metric readable.
Anything more elaborate needs a policy the client has not written.

None of these three metrics feeds anything automatic. There is no threshold that
triggers a notification and no ranking that appears on a leaderboard. They are
numbers on a manager's screen next to an employee's name, and they exist to
start a conversation, not to replace one. Phase 1 does not do performance
management.

## UI notes

The staff task list is the single most used screen in the system. Two cooks and
a counter cashier per outlet per shift open it several times a day, on a mid
range Android phone, with flour on their hands, standing up. Everything else in
this book can be a table on a laptop. This one cannot.

The screen is a single scrolling column, grouped `overdue`, `today`,
`upcoming`, with the group headers sticky. No tabs. No filter bar. No search. A
cook has between two and eight tasks and can see all of them by scrolling.

A card carries the title, a due time as relative text ("due in 40 min", "2h
late"), a priority dot, and for a checklist a progress chip reading "0 of 11".
The whole card is the tap target, minimum 56 pixels tall, and there is no chevron
or menu icon competing for the tap.

One tap starts a task. There is no confirmation dialog and no separate "start"
screen: tapping a plain task card opens the detail sheet with a full-width
button reading "Mark complete", and the task moves to `IN_PROGRESS` the moment
the sheet opens. Recording that somebody looked at it costs nothing and asking
them to press two buttons costs a completion.

Tapping a checklist card opens the checklist directly, not an intermediate task
detail page. This is the no-nested-navigation rule, and it is the difference
between two taps and five. The checklist is a list of items, each one a row with
the label and a three-way segmented control: PASS, FAIL, NA. One tap per item.
Selecting FAIL expands a note field inline, and on an item with
`requiresPhoto` a camera button appears in the row, using
`<input type="file" accept="image/*" capture="environment">` so the phone opens
the camera rather than a file browser.

The submit bar is sticky at the bottom of the viewport, always visible, and
reads "Submit, 7 of 11 done". It is disabled until every item has an answer,
and tapping a disabled bar scrolls to the first unanswered item rather than
doing nothing. Doing nothing is how a cook decides the app is broken.

Photos are compressed in the browser before upload, to a maximum edge of 1600
pixels at JPEG quality 0.7, which takes a 4 MB phone photo to about 300 KB. That
is the difference between a five second upload on outlet wifi and a thirty
second one, and thirty seconds is long enough for somebody to lock their phone
and lose the form.

## Failure modes

| Failure | Symptom | Cause | Handling |
|---|---|---|---|
| Duplicate recurring instances | Two identical opening checklists on the board | Two overlapping generator runs, or `lastRunAt` not committed | Partial unique index `task_recurrence_day_uniq`, unique violation swallowed |
| Recurrence generates nothing | Checklist never appears, nobody notices until the owner asks | `isActive` false, cron in UTC, or the job crashed | Next-fire-time preview on the recurrence screen, and the `CHECKLIST_MISSED` event at the cutoff |
| Cron evaluated in UTC | Opening checklist appears at 12:30 IST | Default timezone in the cron library | `{ tz: 'Asia/Kolkata' }` explicitly, plus a unit test asserting the UTC instant |
| Overdue notification storm | 300 WhatsApp messages for one late task | Sweep re-selects the same row every 10 minutes | `overdueNotifiedAt IS NULL` in the `WHERE`, stamped in the same `UPDATE` |
| Failed audit item with no follow-up | Problem recorded and then forgotten | Follow-up insert outside the result transaction | One `$transaction` covering results, follow-ups and the parent status |
| Duplicate follow-up on a resubmit | Two "Fix: chimney filter" tasks | Idempotent result upsert, non-idempotent child insert | Child creation checks for an existing child with the same `parentTaskId` and title |
| Partial checklist submitted | Half-filled compliance data that looks complete | No completeness validation | `CHECKLIST_INCOMPLETE` listing every missing item label |
| Photo requirement bypassed | "PASS" on a fridge temperature with no evidence | Client-side-only validation | Server checks `requiresPhoto` against the result rows before writing |
| Attachment uploaded but never referenced | Orphan rows in `TaskAttachment` | User abandoned the form after picking a photo | Accepted. A few orphan rows against a 100 GB storage allowance is not worth a cleanup job |
| Task photo leaks publicly | A private kitchen photo indexed somewhere | Public bucket or a long-lived URL | Private bucket, 300 second signed URLs, no public path |
| Cancelled tasks drag down completion rate | Staff dispute their numbers, metric loses credibility | Cancelled rows left in the denominator | `status != CANCELLED` in the denominator, plus a named test |
| Staff sees another outlet's tasks | Cross-outlet data leak | Missing outlet scope on the list query | `OutletGuard` on the controller, 404 not 403, plus a permission boundary test |
| Manager adds a verification step to everything | Batch sign-offs at 22:00, meaningless data | `requiresVerification` set true by default somewhere | Default false in the schema, `VERIFICATION_NOT_REQUIRED` when verify is called on a task that does not need it |

## Test plan

State machine tests, `tasks.service.spec.ts`:

| Test | Assertion |
|---|---|
| `start moves OPEN to IN_PROGRESS` | `status === 'IN_PROGRESS'`, `startedAt` set |
| `start on COMPLETED rejects` | 409 `TASK_INVALID_TRANSITION` |
| `complete from OVERDUE succeeds` | `status === 'COMPLETED'`, `overdueNotifiedAt` still set |
| `late completion is detectable` | `completedAt > dueAt` on the returned row |
| `verify without requiresVerification rejects` | 422 `VERIFICATION_NOT_REQUIRED` |
| `verify by the completer rejects` | 403 `FORBIDDEN` |
| `PATCH with a status field rejects` | 422 `TASK_INVALID_TRANSITION` |
| `cancel without a reason rejects` | 400 `VALIDATION_FAILED` |
| `cancel writes a comment and an audit row` | One new `TaskComment`, one `AuditLog` |
| `AUDIT_RUN defaults requiresVerification true` | Task created from an `isAudit` template has the flag set |

Recurrence tests, `recurring-tasks.job.spec.ts`:

| Test | Assertion |
|---|---|
| `cron fires in IST not UTC` | `0 7 * * *` next fire equals 01:30 UTC |
| `null outletId fans out to every active outlet` | Two tasks created, one per outlet |
| `inactive outlet is skipped` | Outlet with `isActive = false` gets no task |
| `dueAt is fireAt plus dueAfterMins` | 07:00 plus 120 gives 09:00 IST |
| `running the job twice creates one instance` | Second run inserts nothing, one row per outlet per date |
| `concurrent runs create one instance` | Two `run()` calls in `Promise.all`, exactly one row survives, no unhandled rejection |
| `unique violation is swallowed not thrown` | Second insert resolves, job continues to the next recurrence |
| `inactive recurrence generates nothing` | Zero tasks |
| `assignee on the recurrence emits TASK_ASSIGNED` | One `OutboxEvent` per generated task |
| `null assignee emits nothing` | Zero outbox rows |
| `catch-up window is capped at 24 hours` | `lastRunAt` set 10 days ago produces at most one instance per date for the last day |

Overdue sweep tests, `overdue-tasks.job.spec.ts`:

| Test | Assertion |
|---|---|
| `sweep flags an OPEN task past dueAt` | `status === 'OVERDUE'`, `overdueNotifiedAt` set |
| `sweep flags an IN_PROGRESS task past dueAt` | Same |
| `sweep ignores a COMPLETED task past dueAt` | Status unchanged |
| `sweep ignores a task with no dueAt` | Status unchanged |
| `sweep fires exactly once` | Run three times, assert exactly one `OutboxEvent` with `eventKey === 'TASK_OVERDUE'` |
| `sweep emits inside the update transaction` | Force the outbox insert to throw, assert the status is still `OPEN` |

Checklist and audit tests, `tasks.e2e-spec.ts`:

| Test | Assertion |
|---|---|
| `missing item result rejects` | 422 `CHECKLIST_INCOMPLETE`, `details` names the missing labels |
| `extra item from another template rejects` | 422 `TEMPLATE_MISMATCH` |
| `PASS on a requiresPhoto item with no attachment rejects` | 422 `PHOTO_REQUIRED` |
| `NA on a requiresPhoto item is allowed` | 200 |
| `empty note on a requiresNote item rejects` | 422 `NOTE_REQUIRED` |
| `submit sets the parent to COMPLETED` | `status === 'COMPLETED'`, `completedAt` set |
| `FAIL on failCreatesTask spawns a follow-up` | One `ONE_OFF` task, `parentTaskId` set, `priority === 'HIGH'`, `dueAt` 24h out, assignee is the outlet's store manager |
| `FAIL on a non-failCreatesTask item spawns nothing` | Zero child tasks |
| `follow-up creation and results share a transaction` | Force the child insert to throw, assert zero `TaskChecklistResult` rows |
| `FAIL emits AUDIT_ITEM_FAILED` | One `OutboxEvent` per failed item |
| `resubmitting the same results is idempotent` | Same row count, same values, one follow-up task |
| `complete on an unsubmitted checklist rejects` | 422 `CHECKLIST_INCOMPLETE` |
| `attachment over 5 MB rejects` | 422 `ATTACHMENT_TOO_LARGE` |
| `application/pdf rejects` | 422 `UNSUPPORTED_MIME_TYPE` |
| `storage key follows the convention` | Matches `task-proof/BM-[A-Z]+/\d{4}-\d{2}-\d{2}/[0-9a-f-]+/[0-9a-f-]+\.jpg` |

Permission and metric tests:

| Test | Assertion |
|---|---|
| `KITCHEN_STAFF cannot create a task` | 403 `FORBIDDEN` |
| `KITCHEN_STAFF list is scoped to self` | `GET /tasks?assigneeId=<other>` returns only own rows |
| `KITCHEN_STAFF cannot verify` | 403 `FORBIDDEN` |
| `STORE_MANAGER cannot read another outlet's task` | 404 `NOT_FOUND`, not 403 |
| `STORE_MANAGER cannot manage templates` | 403 `FORBIDDEN` |
| `unassigned outlet task appears in GET /tasks/my` | Cook of that outlet and department sees it |
| `cancelled task is excluded from completion rate` | 4 assigned, 1 cancelled, 3 completed gives 1.0 |
| `future-due task is excluded from completion rate` | Task due after `to` does not appear in the denominator |
| `undated task counts in completion rate` | Null `dueAt`, never completed, drags the rate down |
| `undated task is excluded from on-time rate` | Denominator unchanged |
| `approved leave is excluded from attendance consistency` | Five scheduled days, two on approved leave, three present gives 1.0 |
| `half day counts as 0.5` | Two present, one half day, three scheduled gives 0.833 |
