# Roles, permissions and outlet scope

FR-AUTH-002 says the system restricts module and outlet-level data access based
on the assigned role, and that unauthorised API calls are rejected with 403. The
SRS then defers the actual matrix to the design sprint. This chapter is that
matrix. It is the single largest table in the book and the one you will come
back to most often, because every endpoint in every module chapter names a
permission key from it.

Authentication, meaning who the caller is, is the previous chapter:
[Authentication](13-authentication.md).

## The nine people behind the nine roles

`RoleKey` has nine values. At Bob's Momo those nine values map onto about 25
actual humans, and the shape of the permission matrix follows from who they are
and what they are holding when they use the system.

`OWNER` is Bob. One person. He looks at the system on an Android phone, usually
after 22:00 when both outlets have closed, and occasionally on a laptop when the
accountant is in. He wants yesterday's sales, this week's wastage and the P&L
view, and he does not want to be asked to approve anything routine. He has every
permission at every outlet, including the ones nobody else has: publishing a
game, unlocking a sales entry, assigning a role.

`OPERATIONS_MANAGER` is the person who runs both outlets day to day. One person,
moving between Saheed Nagar and Patia, working from a phone with a laptop at
home. Cross-outlet operations, inventory, purchase, tasks and audits. Everything
Bob can do except the three financial and structural levers: no P&L, no sales
unlock, no role assignment.

`STORE_MANAGER` is the outlet in-charge. Two of them, one per outlet, and this
is the busiest role in the system. They work from the counter tablet and their
own phone. Rosters, attendance corrections, leave decisions, opening and closing
checklists, daily sales entry, purchase requests, local stock movements. Every
one of their permissions is `OWN_OUTLET`. A Store Manager at Patia cannot see a
single row from Saheed Nagar.

`KITCHEN_MANAGER` runs the kitchen. Two of them, one per outlet, working from a
phone that has flour on it, standing up, usually mid-task. They issue stock to
production, record wastage, run kitchen checklists, raise purchase requests when
the chicken mince is low, and assign tasks to kitchen staff. No money, no
salaries, no sales.

`INVENTORY_MANAGER` owns the item master and the stock ledger across both
outlets. One person, mostly on a laptop in the store room at Saheed Nagar. They
create items, set reorder levels, run transfers between outlets and correct the
ledger with adjustments. They are `ALL_OUTLETS` on inventory and nothing else.

`PURCHASE_MANAGER` buys the food. One person, at the mandi at 06:00 with a phone
and wet hands, entering unit prices for tomatoes while the vendor waits. They
own vendors, approve purchase requests and record purchases with prices. Their
price entries are the raw material for the whole costing story, so they are
`ALL_OUTLETS` on purchase and price history.

`HR_ACCOUNTS` handles employee records, attendance registers, leave history and
salary information. One person, part time, always on a laptop. This is the only
non-owner role with `workforce.salary.read` and `workforce.salary.write`, and
one of the few that spans both outlets.

`KITCHEN_STAFF` is the largest group. Twelve to sixteen people across the two
outlets, sharing a tablet mounted near the kitchen entrance and using their own
phones when the tablet is busy. They punch in, log breaks, request leave,
complete their assigned tasks and run checklists. Almost every permission they
hold is `SELF`. They see their own attendance and their own tasks, nobody
else's.

`COUNTER_CASHIER` works the front counter. Four to six people, on the counter
tablet. Same self-service block as kitchen staff, plus two extra things: they
enter the day's sales figures at closing, and they redeem a customer's game
coupon at the counter.

That is 20 to 30 users, which matches the SRS assumption, and it is why the
permission model in this system is a compiled constant rather than an
administration screen. See the storage section below.

## Permission key scheme

Every key is `module.resource.action`, lowercase, dot separated, three segments
exactly.

```text
  inventory  .  transaction  .  create
  ─────────     ───────────     ──────
  module        resource        action

  module    the NestJS module that owns the endpoint
  resource  the noun being acted on, singular
  action    create | read | update | delete-ish verb, or a domain verb
            such as approve, verify, punch_self, publish, redeem
```

Domain verbs are preferred over generic ones when the action carries a rule.
`purchase.request.approve` is a different thing from `purchase.request.update`
and giving it its own key is what lets a Kitchen Manager raise a request without
being able to approve their own.

Three scope modifiers decide how far a granted key reaches.

| Modifier | Meaning | Enforced by |
|---|---|---|
| `ALL_OUTLETS` | Every active outlet. `OWNER` and `OPERATIONS_MANAGER` only. | `OutletGuard` |
| `OWN_OUTLET` | Only outlets present in the caller's `UserOutlet` rows. | `OutletGuard` |
| `SELF` | Only rows whose `employeeId` equals the caller's. | `OutletGuard` plus the service |

A key without a scope modifier does not exist. Every grant in the matrix carries
one, even when the resource has no outlet dimension (a user changing their own
password is `SELF`).

## Reading the matrix

Columns are the nine roles, abbreviated to keep the table on screen.

| Marker | Meaning |
|---|---|
| `A` | Granted at `ALL_OUTLETS` scope. For a resource with no outlet column, `A` just means granted. |
| `O` | Granted at `OWN_OUTLET` scope. |
| `S` | Granted at `SELF` scope: only rows tied to the caller's own `employeeId`. |
| blank | Not granted. The API returns `403 FORBIDDEN`. |

| Abbrev | Role |
|---|---|
| OWN | `OWNER` |
| OPS | `OPERATIONS_MANAGER` |
| STM | `STORE_MANAGER` |
| KIT | `KITCHEN_MANAGER` |
| INV | `INVENTORY_MANAGER` |
| PUR | `PURCHASE_MANAGER` |
| HRA | `HR_ACCOUNTS` |
| KST | `KITCHEN_STAFF` |
| CSH | `COUNTER_CASHIER` |

## The permission matrix

### auth

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `auth.session.create` | A | A | A | A | A | A | A | A | A |
| `auth.password.change` | S | S | S | S | S | S | S | S | S |
| `auth.password.reset_other` | A | A | O | | | | A | | |

### admin

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `admin.user.create` | A | | | | | | A | | |
| `admin.user.read` | A | A | O | | | | A | | |
| `admin.user.update` | A | | | | | | A | | |
| `admin.user.disable` | A | | | | | | A | | |
| `admin.user.assign_role` | A | | | | | | | | |
| `admin.user.assign_outlet` | A | A | | | | | | | |
| `admin.audit.read` | A | A | | | | | | | |
| `admin.outlet.manage` | A | | | | | | | | |
| `admin.department.manage` | A | A | | | | | | | |

### inventory

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `inventory.item.create` | A | A | | | A | | | | |
| `inventory.item.read` | A | A | O | O | A | A | | | |
| `inventory.item.update` | A | A | | | A | | | | |
| `inventory.item.deactivate` | A | | | | A | | | | |
| `inventory.category.manage` | A | A | | | A | | | | |
| `inventory.unit.manage` | A | | | | A | | | | |
| `inventory.stock.read` | A | A | O | O | A | A | | | |
| `inventory.transaction.create` | A | A | O | O | A | | | | |
| `inventory.transaction.read` | A | A | O | O | A | | | | |
| `inventory.wastage.create` | A | A | O | O | A | | | | |
| `inventory.adjustment.create` | A | A | O | | A | | | | |
| `inventory.transfer.create` | A | A | | | A | | | | |
| `inventory.reorder_level.update` | A | A | | | A | | | | |

### purchase and vendor

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `purchase.request.create` | A | A | O | O | A | | | | |
| `purchase.request.read` | A | A | O | O | A | A | | | |
| `purchase.request.approve` | A | A | | | | A | | | |
| `purchase.request.cancel` | A | A | O | O | | A | | | |
| `purchase.record.create` | A | | | | | A | | | |
| `purchase.record.read` | A | A | O | | A | A | | | |
| `purchase.record.void` | A | | | | | A | | | |
| `purchase.price_history.read` | A | A | | | A | A | | | |
| `vendor.vendor.create` | A | | | | | A | | | |
| `vendor.vendor.read` | A | A | | | A | A | | | |
| `vendor.vendor.update` | A | | | | | A | | | |
| `vendor.vendor.deactivate` | A | | | | | A | | | |

### workforce

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `workforce.employee.create` | A | | | | | | A | | |
| `workforce.employee.read` | A | A | O | O | | | A | | |
| `workforce.employee.update` | A | | | | | | A | | |
| `workforce.attendance.punch_self` | S | S | S | S | S | S | S | S | S |
| `workforce.attendance.read` | A | A | O | O | S | S | A | S | S |
| `workforce.attendance.edit` | A | A | O | | | | A | | |
| `workforce.break.log_self` | S | S | S | S | S | S | S | S | S |
| `workforce.shift.create` | A | A | O | O | | | | | |
| `workforce.shift.read` | A | A | O | O | S | S | A | S | S |
| `workforce.leave.request` | S | S | S | S | S | S | S | S | S |
| `workforce.leave.read` | A | A | O | O | S | S | A | S | S |
| `workforce.leave.decide` | A | A | O | | | | A | | |
| `workforce.salary.read` | A | | | | | | A | | |
| `workforce.salary.write` | A | | | | | | A | | |
| `workforce.performance.read` | A | A | O | O | | | A | | |

### task

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `task.task.create` | A | A | O | O | | | | | |
| `task.task.read` | A | A | O | O | S | S | | S | S |
| `task.task.update_self` | S | S | S | S | S | S | S | S | S |
| `task.task.complete` | S | S | S | S | S | S | S | S | S |
| `task.task.verify` | A | A | O | O | | | | | |
| `task.task.cancel` | A | A | O | O | | | | | |
| `task.template.manage` | A | A | | | | | | | |
| `task.recurrence.manage` | A | A | | | | | | | |
| `task.comment.create` | S | S | S | S | S | S | S | S | S |

### sales

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `sales.entry.create` | A | | O | | | | | | O |
| `sales.entry.read` | A | A | O | | | | A | | O |
| `sales.entry.amend` | A | | O | | | | | | |
| `sales.entry.unlock` | A | | | | | | | | |

### analytics

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `analytics.dashboard.read` | A | A | O | O | A | A | A | | |
| `analytics.sales.read` | A | A | O | | | | A | | |
| `analytics.consumption.read` | A | A | O | O | A | | | | |
| `analytics.performance.read` | A | A | O | O | | | A | | |
| `analytics.waste.read` | A | A | O | O | A | | | | |
| `analytics.pnl.read` | A | | | | | | | | |
| `analytics.export.create` | A | A | | | | | A | | |

### messaging

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `messaging.direct.send` | A | A | O | O | O | O | O | O | O |
| `messaging.broadcast.send` | A | A | O | O | | | | | |
| `messaging.message.read` | A | A | O | O | O | O | O | O | O |

### notification

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `notification.own.read` | S | S | S | S | S | S | S | S | S |
| `notification.preference.update` | S | S | S | S | S | S | S | S | S |

### crm

| Permission key | OWN | OPS | STM | KIT | INV | PUR | HRA | KST | CSH |
|---|---|---|---|---|---|---|---|---|---|
| `crm.customer.read` | A | A | O | | | | | | |
| `crm.game.configure` | A | A | | | | | | | |
| `crm.game.publish` | A | | | | | | | | |
| `crm.reward.define` | A | A | | | | | | | |
| `crm.reward.issue` | A | A | | | | | | | |
| `crm.reward.redeem` | A | A | O | | | | | | O |
| `crm.analytics.read` | A | A | O | | | | | | |

That is 84 keys. The public game endpoints that a customer's browser hits carry
no key at all: they are unauthenticated, rate limited, and covered in the CRM
chapter.

## Per-role summary

### Owner

Bob holds all 84 keys at `ALL_OUTLETS`. Four of them are his alone:
`admin.user.assign_role`, `admin.outlet.manage`, `sales.entry.unlock` and
`analytics.pnl.read`. Everything a manager can do, he can do, at either outlet,
without asking. He will most likely complain that the dashboard opens on today
when he wants yesterday, because he looks at it after closing.

### Operations Manager

Everything except money and structure. Full cross-outlet reach on inventory,
purchase approvals, tasks, templates, recurrence, attendance edits, leave
decisions and broadcasts. No P&L, no salary, no role assignment, no sales
unlock, and notably no `purchase.record.create`, so they can approve a request
but cannot record the purchase and the price against it. That separation is
deliberate. They will complain about not seeing the P&L view, because they are
the person actually running cost control.

### Store Manager

The busiest permission set in the system, and every single grant is `OWN_OUTLET`
or `SELF`. Rosters, attendance edits with a reason, leave decisions, daily sales
entry and amendment, purchase requests, stock transactions and adjustments,
checklists, task creation and verification, outlet broadcasts, coupon
redemption. They cannot create items, cannot approve their own purchase
requests, cannot see salary and cannot transfer stock to the other outlet. They
will complain about the transfer restriction, because the other outlet has the
paneer and they can see it in the stock view but cannot move it.

### Kitchen Manager

Everything the kitchen touches. Issue stock, record wastage, read stock and item
master for their outlet, raise purchase requests, create and verify tasks for
kitchen staff, run and verify kitchen checklists, read their team's attendance
and leave. No adjustments, no sales, no salary, no leave decisions. They will
complain about not being able to approve a kitchen assistant's half-day leave
when the Store Manager is off, because the decision then waits.

### Inventory Manager

Owner of the item master and the ledger across both outlets. Create, update and
deactivate items, manage categories and units, set reorder levels, record any
transaction type including transfers and adjustments, read consumption and waste
analytics, read purchase records and price history. No workforce data, no tasks
beyond their own, no sales. They will complain that they cannot create the
purchase record for stock they physically received, because
`purchase.record.create` sits with the Purchase Manager.

### Purchase Manager

Vendors, approvals, purchases and prices, all outlets. They approve or reject
purchase requests, record the purchase with unit prices, void a purchase they
entered wrong, and read the full price history. They can read items and stock so
they know what to buy, but cannot record a stock transaction directly, because
recording a purchase already creates the `RECEIVED` rows. They will complain
about `PURCHASE_ALREADY_VOIDED` after trying to fix a mistake twice.

### HR and Accounts

Employee profiles, attendance across both outlets including edits, leave
decisions and history, salary records, performance metrics, sales reads for
reconciliation, and exports. The only non-owner role with salary access. No
inventory at all, no purchase, no tasks. They will complain that Phase 1 stores
salary structure but computes nothing, which is a scope decision documented in
ADR-006, not a bug.

### Kitchen Staff

Twelve to sixteen people whose entire permission set is `SELF` plus one
`OWN_OUTLET` grant for messaging. Punch in and out, log breaks, request leave,
read their own attendance, shifts, leave and tasks, update and complete the
tasks assigned to them, comment on those tasks, run checklists that arrive as
tasks, read and manage their own notifications. They cannot see another
employee's roster and cannot record wastage. That second one is the complaint:
they are the people who actually drop a tray of momo, and they have to tell the
Kitchen Manager rather than record it, because wastage moves stock value and
Phase 1 keeps value changes with managers.

### Counter Cashier

The kitchen staff set, plus `sales.entry.create` and `sales.entry.read` at their
own outlet and `crm.reward.redeem` for scanning a customer's coupon code at the
counter. They cannot amend a sales entry once submitted, which is the complaint,
because a typo in the UPI figure means finding the Store Manager. That is
intentional: sales entry is the one number the whole P&L rests on.

## Enforcement

Three guards run in a fixed order on every authenticated request. The order is
set by the array in `app.module.ts` and matters, because each guard depends on
what the previous one attached to the request.

```text
  HTTP request
       │
       ▼
  ┌──────────────┐   no bearer token          401 TOKEN_MISSING
  │ JwtAuthGuard │ ─ bad signature / expired ► 401 TOKEN_EXPIRED
  └──────┬───────┘
         │ attaches req.user = { sub, roleKey, employeeId,
         │                       outletIds, scope, permHash }
         ▼
  ┌──────────────────┐  key missing from role  403 FORBIDDEN
  │ PermissionsGuard │ ─ permHash mismatch   ► 401 PERMISSIONS_STALE
  └──────┬───────────┘
         │ attaches req.grant = { key, modifier }
         ▼
  ┌──────────────┐   outletId outside scope   404 NOT_FOUND
  │ OutletGuard  │ ─ SELF grant, other emp  ► 404 NOT_FOUND
  └──────┬───────┘
         │ attaches req.scope = { outletIds: string[],
         │                        selfEmployeeId: string | null }
         ▼
    controller ──► service ──► repository
                   (uses req.scope in every where clause)
```

### PermissionsGuard

```ts
// apps/api/src/common/guards/permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required?.length) return true;          // public route

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) throw new AppError('TOKEN_MISSING', 401);

    const grants = PERMISSIONS[user.roleKey];    // compiled constant
    if (user.permHash !== PERMISSION_HASHES[user.roleKey]) {
      throw new AppError('PERMISSIONS_STALE', 401);
    }

    const key = required.find((k) => k in grants);
    if (!key) throw new AppError('FORBIDDEN', 403, { required });

    req.grant = { key, modifier: grants[key] };  // A | O | S
    return true;
  }
}
```

The decorator is a one liner:

```ts
// apps/api/src/common/decorators/permissions.decorator.ts
export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...keys: string[]) =>
  SetMetadata(PERMISSIONS_KEY, keys);
```

And a controller reads:

```ts
@Post('transactions')
@Permissions('inventory.transaction.create')
@HttpCode(201)
record(@Body(new ZodValidationPipe(recordTxnSchema)) dto: RecordTxnDto,
       @CurrentUser() user: AuthedUser,
       @Scope() scope: RequestScope) {
  return this.service.record(dto, user, scope);
}
```

Listing more than one key in the decorator means "any of these". That is used
in exactly one place, on task reads, where either `task.task.read` at outlet
scope or the `SELF` grant is enough.

### OutletGuard

`OutletGuard` reads the modifier that `PermissionsGuard` attached and turns it
into a concrete outlet id list. It has three jobs: reject a request naming an
outlet the caller cannot reach, narrow an unqualified query to the caller's
outlets, and hand the service a scope object it can drop straight into a Prisma
`where`.

```ts
// apps/api/src/common/guards/outlet.guard.ts
@Injectable()
export class OutletGuard implements CanActivate {
  constructor(private readonly outlets: OutletCacheService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const grant = req.grant;
    if (!grant) return true;

    const allowed =
      grant.modifier === 'A'
        ? await this.outlets.activeOutletIds()   // cached 5 min in Redis
        : req.user.outletIds;

    // an explicit outletId anywhere in the request must be inside the set
    const asked =
      req.body?.outletId ?? req.query?.outletId ?? req.params?.outletId;

    if (asked) {
      if (!allowed.includes(asked)) throw new AppError('NOT_FOUND', 404);
      req.scope = { outletIds: [asked], selfEmployeeId: null };
    } else {
      req.scope = { outletIds: allowed, selfEmployeeId: null };
    }

    if (grant.modifier === 'S') {
      if (!req.user.employeeId) throw new AppError('FORBIDDEN', 403);
      req.scope.selfEmployeeId = req.user.employeeId;
    }
    return true;
  }
}
```

Two details are load bearing. The out-of-scope response is `404`, not `403`,
because a `403` confirms that the resource exists somewhere. A Patia manager
probing ids should not be able to map the Saheed Nagar item catalogue by
watching status codes. And when no `outletId` is supplied, the guard narrows
rather than rejects, so `GET /inventory/stock` returns one outlet for a Store
Manager and both for the Inventory Manager without either of them passing a
parameter.

### SELF scope

`SELF` is finished in the service, because only the service knows which column
holds the employee id. The guard supplies `selfEmployeeId`, the repository
applies it.

```ts
// apps/api/src/modules/attendance/attendance.service.ts
async listDays(query: ListDaysQuery, scope: RequestScope) {
  const where: Prisma.AttendanceDayWhereInput = {
    outletId: { in: scope.outletIds },
    businessDate: { gte: query.from, lte: query.to },
    ...(scope.selfEmployeeId
      ? { employeeId: scope.selfEmployeeId }
      : query.employeeId
        ? { employeeId: query.employeeId }
        : {}),
  };
  return this.repo.findDays(where, query.page, query.pageSize);
}

// single-resource read, SELF grant
async getDay(id: string, scope: RequestScope) {
  const day = await this.repo.findDay(id);
  if (!day) throw new AppError('NOT_FOUND', 404);
  if (!scope.outletIds.includes(day.outletId)) {
    throw new AppError('NOT_FOUND', 404);
  }
  if (scope.selfEmployeeId && day.employeeId !== scope.selfEmployeeId) {
    throw new AppError('NOT_FOUND', 404);
  }
  return day;
}
```

Note the `employeeId` comparison happens after the row is loaded and returns
`404`, not `403`, for the same reason as the outlet check. A kitchen assistant
guessing attendance ids learns nothing about whether an id is real.

### The layering rule

The API is the enforcement point. The UI hides things for convenience only.

The web app knows the caller's permission list (it comes back with the login
response and again on refresh) and uses it to hide nav items, disable buttons
and skip queries that would 403 anyway. That is a usability feature. It is not
security. Anybody can open the network tab, copy the bearer token and curl the
endpoint directly, and the only thing standing between them and another outlet's
salary data is `PermissionsGuard` and `OutletGuard`.

Practical consequence: a pull request that adds a controller method without a
`@Permissions` decorator does not fail the type checker, so it fails a test
instead. `apps/api/test/rbac-coverage.e2e-spec.ts` walks the Nest route table at
boot, and any handler that is neither marked `@Public()` nor decorated with
`@Permissions` fails the suite by name. That test is the reason an
under-protected endpoint cannot reach production quietly.

## Permission storage

Permissions live in one TypeScript constant, compiled into the API bundle,
versioned in git.

```ts
// packages/shared/src/rbac/permissions.ts
export type Modifier = 'A' | 'O' | 'S';
export type GrantMap = Readonly<Record<string, Modifier>>;

export const PERMISSIONS: Readonly<Record<RoleKey, GrantMap>> = {
  OWNER: {
    ...allKeysAt('A'),                       // every key, every outlet
    'auth.password.change': 'S',             // self-only keys stay self-only
    'workforce.attendance.punch_self': 'S',
    'workforce.break.log_self': 'S',
    'workforce.leave.request': 'S',
    'task.task.update_self': 'S',
    'task.task.complete': 'S',
    'task.comment.create': 'S',
    'notification.own.read': 'S',
    'notification.preference.update': 'S',
  },
  STORE_MANAGER: {
    'auth.session.create': 'A',
    'auth.password.change': 'S',
    'auth.password.reset_other': 'O',
    'admin.user.read': 'O',
    'inventory.item.read': 'O',
    'inventory.stock.read': 'O',
    'inventory.transaction.create': 'O',
    'inventory.adjustment.create': 'O',
    // ...
    'sales.entry.create': 'O',
    'sales.entry.amend': 'O',
    'crm.reward.redeem': 'O',
  },
  // ...seven more roles
} as const;

export const PERMISSION_HASHES: Record<RoleKey, string> =
  Object.fromEntries(
    Object.entries(PERMISSIONS).map(([role, grants]) => [
      role,
      sha256(Object.keys(grants).sort().join(',')).slice(0, 12),
    ]),
  ) as Record<RoleKey, string>;
```

`PERMISSION_HASHES` is what the `permHash` JWT claim is compared against, so a
release that edits this file invalidates every access token issued against the
old shape within one refresh cycle. No manual logout, no cache bust.

There is no database-driven permission editor in Phase 1, and that is a
decision, not an omission. Nine roles are fixed by the org chart of a two outlet
restaurant. A permission editor means a `Role` table, a `Permission` table, a
join table, seed data, a CRUD screen, a cache invalidation path when a row
changes, and a way to stop somebody removing their own admin rights at 23:00.
That is three or four days of the three week budget spent so that a change which
happens maybe twice a year can be made without a deploy. A deploy takes four
minutes. The constant also gives two things a table cannot: the compiler catches
a typo in a permission key, and `git log` on one file is the complete history of
who changed access to what.

Moving to a database later is additive, not a rewrite. Add the tables, seed them
from `PERMISSIONS`, and change `PermissionsGuard` to read a Redis-cached map
instead of the constant. The decorators, the keys, the modifiers, the guard
order and every test stay exactly as they are. Nothing above the guard knows
where the grant map came from.

## The RBAC test matrix requirement

Acceptance criterion 2 in the SRS says RBAC correctly restricts each defined
role to its intended modules and outlets. That is only testable if every
endpoint carries a negative test, so two rules apply to every pull request that
adds or changes an endpoint.

First, every endpoint gets an e2e test asserting `403 FORBIDDEN` for at least
one role that should not reach it, and the role chosen must be a plausible one.
Testing that `KITCHEN_STAFF` cannot read salary is nearly free and proves
little. Testing that `STORE_MANAGER` cannot read salary, or that
`OPERATIONS_MANAGER` cannot create a purchase record, catches the mistakes
people actually make while editing the constant.

Second, every outlet-scoped endpoint gets a test asserting `404 NOT_FOUND` for a
resource that exists in another outlet. The fixture seeds two outlets and one
manager per outlet precisely so this test is a two line assertion.

```ts
// apps/api/test/inventory.e2e-spec.ts
it('hides another outlet stock row from a store manager', async () => {
  const res = await api
    .get(`/api/v1/inventory/stock/${patiaStockId}`)
    .set('Authorization', bearer(saheedStoreManager));

  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('NOT_FOUND');
});

it('rejects salary read for a store manager', async () => {
  const res = await api
    .get(`/api/v1/employees/${employeeId}/salary`)
    .set('Authorization', bearer(saheedStoreManager));

  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('FORBIDDEN');
});
```

The seed script in `apps/api/prisma/seed.ts` creates one user per role, all with
the password `Test@12345` and `mustReset: false`, so the test helper
`bearer(role)` is a login call and nothing more. That helper is what makes
writing the negative test cheap enough that nobody skips it.
