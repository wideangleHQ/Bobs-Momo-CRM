import type { EventKey, RoleKey } from '@bobs-momo/shared';
import type { PrismaService } from '../../common/prisma/prisma.service';

export type Payload = Record<string, unknown>;

/** Turns an outbox row into the user ids that should hear about it. */
export type Resolver = (payload: Payload, db: PrismaService) => Promise<string[]>;

export function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function strArray(payload: Payload, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

// These two hold ALL_OUTLETS scope and are granted every active outlet at login
// instead of UserOutlet rows, so joining through UserOutlet returns nobody.
const ALL_OUTLET_ROLES: readonly RoleKey[] = ['OWNER', 'OPERATIONS_MANAGER'];

/**
 * Active users holding `roleKey`, narrowed to `outletId` when the role is
 * outlet-scoped. Pass a null outletId to reach every holder of the role.
 */
export async function usersWithRole(
  db: PrismaService,
  roleKey: RoleKey,
  outletId: string | null,
): Promise<string[]> {
  const scoped = outletId !== null && !ALL_OUTLET_ROLES.includes(roleKey);
  const rows = await db.user.findMany({
    where: {
      roleKey,
      status: 'ACTIVE',
      ...(scoped ? { outlets: { some: { outletId } } } : {}),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** The employee's login, or nothing if they have none or it is not active. */
export async function userForEmployee(
  db: PrismaService,
  employeeId: string | null,
): Promise<string[]> {
  if (employeeId === null) return [];
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true, user: { select: { status: true } } },
  });
  if (!employee?.userId || employee.user?.status !== 'ACTIVE') return [];
  return [employee.userId];
}

async function activeUserIds(db: PrismaService, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.user.findMany({
    where: { id: { in: ids }, status: 'ACTIVE' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function broadcastRecipients(payload: Payload, db: PrismaService): Promise<string[]> {
  const scope = str(payload, 'scope');
  const outletId = str(payload, 'outletId');
  const departmentId = str(payload, 'departmentId');
  const recipientId = str(payload, 'recipientId');

  let ids: string[] = [];
  if (scope === 'DIRECT') {
    ids = await activeUserIds(db, recipientId === null ? [] : [recipientId]);
  } else if (scope === 'OUTLET' && outletId !== null) {
    const rows = await db.user.findMany({
      where: { status: 'ACTIVE', outlets: { some: { outletId } } },
      select: { id: true },
    });
    ids = rows.map((r) => r.id);
  } else if (scope === 'DEPARTMENT' && departmentId !== null) {
    const rows = await db.user.findMany({
      where: { status: 'ACTIVE', employee: { departmentId, status: 'ACTIVE' } },
      select: { id: true },
    });
    ids = rows.map((r) => r.id);
  } else if (scope === 'ALL') {
    const rows = await db.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    ids = rows.map((r) => r.id);
  }

  // Nobody needs a notification about their own broadcast.
  const senderId = str(payload, 'senderId');
  return ids.filter((id) => id !== senderId);
}

async function union(...lists: Promise<string[]>[]): Promise<string[]> {
  const resolved = await Promise.all(lists);
  return [...new Set(resolved.flat())];
}

export const resolvers: Record<EventKey, Resolver> = {
  // The outlet comes from the ItemStock row that crossed the threshold, not
  // from whoever recorded the transaction. A transfer touches two outlets.
  LOW_STOCK: (p, db) =>
    union(
      usersWithRole(db, 'INVENTORY_MANAGER', str(p, 'outletId')),
      usersWithRole(db, 'STORE_MANAGER', str(p, 'outletId')),
    ),

  TASK_ASSIGNED: (p, db) => userForEmployee(db, str(p, 'assigneeId')),

  // The creator is frequently the outlet Store Manager. Without the union being
  // a set that person gets the same alert twice for one late task.
  TASK_OVERDUE: (p, db) =>
    union(
      userForEmployee(db, str(p, 'createdById')),
      usersWithRole(db, 'STORE_MANAGER', str(p, 'outletId')),
    ),

  CHECKLIST_MISSED: (p, db) => usersWithRole(db, 'STORE_MANAGER', str(p, 'outletId')),

  AUDIT_ITEM_FAILED: (p, db) =>
    union(
      usersWithRole(db, 'STORE_MANAGER', str(p, 'outletId')),
      usersWithRole(db, 'OPERATIONS_MANAGER', null),
    ),

  // HR is the fallback so a request at an outlet with no manager still lands
  // somewhere a human looks.
  LEAVE_REQUESTED: async (p, db) => {
    const managers = await usersWithRole(db, 'STORE_MANAGER', str(p, 'outletId'));
    if (managers.length > 0) return managers;
    return usersWithRole(db, 'HR_ACCOUNTS', null);
  },

  LEAVE_DECIDED: (p, db) => userForEmployee(db, str(p, 'employeeId')),

  // Purchasing is centralised across both outlets, so no outlet filter.
  PURCHASE_REQUESTED: (_p, db) => usersWithRole(db, 'PURCHASE_MANAGER', null),

  // requestedById is already a User.id, not an Employee.id.
  PURCHASE_DECIDED: (p, db) => {
    const requester = str(p, 'requestedById');
    return activeUserIds(db, requester === null ? [] : [requester]);
  },

  PURCHASE_RECORDED: (p, db) => usersWithRole(db, 'INVENTORY_MANAGER', str(p, 'outletId')),

  SALES_ENTRY_MISSING: (p, db) => usersWithRole(db, 'STORE_MANAGER', str(p, 'outletId')),

  BROADCAST: broadcastRecipients,

  // Notification.userId is a foreign key to User and this recipient is a
  // Customer, so there is no inbox row. Delivery is WhatsApp only.
  REWARD_ISSUED: () => Promise.resolve([]),

  OPERATIONAL_ALERT: (p, db) => activeUserIds(db, strArray(p, 'userIds')),
};
