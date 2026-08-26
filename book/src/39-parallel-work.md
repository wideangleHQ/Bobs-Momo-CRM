# Parallel work and team split

Two engineers on a three week build spend more time waiting on each other than they
expect. This chapter splits the backlog into lanes that can run at the same time without
touching the same files, and names the four points where the lanes must synchronise.

## The dependency spine

Almost everything in this system depends on four things being finished first. Those four
are the spine, they are sequential, and they belong to one person on day one and two.

```text
   S-01 monorepo
        │
        ▼
   D-01 prisma schema ──────► D-02 migration ──► D-03 seed ──► D-04 factories
        │                          │
        │                          ▼
        │                     A-01..A-04 auth
        │                          │
        │                          ▼
        └────────────────────► R-01..R-04 rbac + guards
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
   LANE A operations          LANE B people            LANE C platform
   inventory, purchase        workforce, tasks         notify, jobs, frontend
```

Until the schema, migration, auth and guards exist, a second engineer building a module
is guessing at model names and writing controllers with no way to protect them. The
fastest route through week 1 is one engineer owning the spine while the second engineer
builds the frontend shell, design tokens and the login screen, which need none of it.

## Lane definitions

Lanes are drawn along module directory boundaries, because that is where merge conflicts
actually happen. Two engineers in `modules/inventory/` will conflict. Two engineers in
`modules/inventory/` and `modules/tasks/` will not.

| Lane | Modules owned | Frontend areas owned |
|---|---|---|
| A, operations | inventory, purchase, vendors, sales, analytics | inventory screens, purchase screens, report screens, admin |
| B, people | employees, attendance, shifts, leave, salary, tasks | workforce screens, task screens |
| C, platform | auth, users, outlets, notifications, whatsapp, messaging, crm, jobs, common | shell, design system, login, notification bell, chat |

At two engineers, lane C is split: the platform pieces that block others (auth, guards,
outbox) go to whoever owns the spine in week 1, and the rest is picked up by whoever has
slack later.

## Parallel lanes by week

**Week 1.** One lane is sequential and one is genuinely parallel.

```text
  Engineer 1 ──► S-01..S-06 ──► D-01..D-04 ──► A-01..A-04 ──► R-01..R-04
                                                                  │
  Engineer 2 ──► F-01 tokens ──► F-02 login ──► F-03 shell ◄───────┘
                 (no backend dependency until F-02 needs A-02)
```

The one synchronisation point is Wednesday: engineer 2 needs `POST /auth/login` working
to finish F-02. Before that, engineer 2 builds the login screen against a mocked
response. Agree the response shape from [chapter 13](13-authentication.md) on Monday so
the mock is right.

**Week 2.** Fully parallel, two lanes, no shared files.

```text
  Engineer 1  LANE A   I-04 ─► I-05 ─► I-06 ─► P-01 ─► P-02 ─► P-03 ─► P-04
                       then F-04, F-05

  Engineer 2  LANE B   W-01 ─► W-02 ─► W-03 ─► W-04 ─► T-01 ─► T-02 ─► T-04
                       then F-06, F-07

  Shared, whoever has slack: N-01..N-06 notification engine
```

The notification engine is the awkward one. It is needed by both lanes but owned by
neither. Build N-01, the outbox write helper and dispatcher, on Monday of week 2 and
merge it before either lane starts emitting events. After that both lanes just insert
outbox rows, which is a one line call, and the resolvers in N-02 can land later without
blocking anyone.

**Week 3.** Parallel until the freeze, then joint.

```text
  Engineer 1  SA-01 ─► AN-01 ─► AN-02 ─► AN-03 ─► AN-04 ─► F-12 admin
  Engineer 2  M-01 ─► M-02 ─► F-09 ─► F-10 ─► F-11 ─► Q-01 playwright
  Both        Wed 12:00 freeze ─► O-01..O-04 ─► Q-03 ─► Q-04 UAT ─► Q-05 fixes
```

## Conflict flags

These are the places where two lanes touch the same file. Watch them.

| File or area | Lanes | Mitigation |
|---|---|---|
| `prisma/schema.prisma` | all | Schema changes go through the tech lead. One migration per day, batched, applied at 17:00. Never two people running `migrate dev` on the same afternoon. |
| `packages/shared/errors.ts` | all | The error code registry is append only and alphabetically grouped by module prefix. Conflicts resolve trivially if nobody reorders it. |
| `common/permissions.ts` | all | Same rule. Grouped by module, append within your group. |
| `app.module.ts` | all | Each new NestJS module adds one import line. Keep imports alphabetical so git resolves cleanly. |
| `modules/purchase/` calling inventory | A only | Purchase calls `InventoryService.recordTransaction`. Both are lane A, so no cross-lane conflict, but the coupling is real: do not let lane B change the inventory service signature. |
| Frontend `app/(app)/layout.tsx` | all | Nav items are read from a single `nav.config.ts`. Add your route there, not in the layout. |
| Query key factory | all | One file per feature folder, not one global file. |

If two lanes must change the same file in the same day, the second one waits. On a three
week project a fifteen minute wait is cheaper than a forty minute merge.

## Working in isolated worktrees

For the four largest tickets, work in a separate git worktree so a long-running branch
does not block the other engineer's ability to run the app.

```bash
git worktree add ../bobs-momo-inventory feat/inventory-ledger
git worktree add ../bobs-momo-tasks     feat/task-engine
```

The four worth isolating are I-02 the stock ledger, T-01 to T-04 the task engine, N-01
to N-02 the notification engine, and AN-01 to AN-04 the analytics layer. Each is a day
or more of work across many files and each is disruptive to have half-finished in a
shared checkout.

Every other ticket is small enough for a normal branch.

## Synchronisation points

Four moments where both engineers stop and agree, because getting these wrong costs more
than the meeting.

**Monday week 1, 30 minutes, the contract review.** Walk the Prisma schema in
[chapter 10](10-data-model.md) and the API conventions in
[chapter 15](15-api-conventions.md) together. Every disagreement about a field name is
free now and expensive on Thursday.

**Wednesday week 1, 15 minutes, the auth handshake.** Confirm the login response shape,
the token storage decision and the fetch wrapper contract, so the frontend stops working
against a mock.

**Monday week 2, 15 minutes, the outbox handshake.** Confirm the `emitOutbox` helper
signature and the payload shape per event key, so both lanes emit events the dispatcher
can actually resolve.

**Wednesday week 3, 30 minutes, the freeze meeting.** Walk the remaining backlog, agree
what ships and what moves to the Phase 2 list, and write the list down in the same
meeting.

## What not to parallelise

Two things that look parallelisable and are not.

The database schema. It is tempting to let each lane add its own models. Do not. A
single owner keeps the naming consistent, catches the missing index, and stops two
people from independently inventing `outletId` and `outlet_id`.

The design tokens and shared components. If lane A builds its own table component and
lane B builds another one, the app looks like two apps and the third week is spent
reconciling. One person owns [chapter 28](28-ui-system.md)'s component inventory and
everyone else consumes it.

## Review load

Every pull request gets one review. At two engineers, they review each other, which is
fine as long as nobody self-merges. The tech lead's five days are spent on the schema,
the security checklist in [chapter 37](37-security.md), the two money paths (inventory
ledger and purchase recording), and the UAT session.

Keep pull requests under 400 changed lines. A 1,200 line pull request on Thursday of
week 2 gets rubber-stamped, and rubber-stamped is how the negative stock guard ships
inverted.
