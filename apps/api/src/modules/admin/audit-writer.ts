import type { Prisma } from '@prisma/client';
import type { AuthedRequest, AuthedUser } from '../../common/types/request';

/** Who did it and from where. Built once per request in the controller. */
export interface Actor {
  user: AuthedUser;
  ip: string | null;
  userAgent: string | null;
}

export function actorOf(req: AuthedRequest): Actor {
  if (!req.user) throw new Error('admin route reached without JwtAuthGuard');
  const agent = req.headers['user-agent'];
  return {
    user: req.user,
    ip: req.ip ?? null,
    userAgent: typeof agent === 'string' ? agent.slice(0, 200) : null,
  };
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  outletId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Always called with the transaction client that carries the change itself. An
 * admin action that rolls back must leave no audit row, and one that commits
 * must not be able to commit without it.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: actor.user.sub,
      actorLabel: await actorLabel(tx, actor.user),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      outletId: entry.outletId ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
      // Omitted rather than set to null: Prisma wants a sentinel for a null in
      // a nullable Json column, and an absent key reads the same downstream.
      ...(entry.before === undefined ? {} : { before: entry.before }),
      ...(entry.after === undefined ? {} : { after: entry.after }),
    },
  });
}

/**
 * "Priya Nayak (HR_ACCOUNTS)". Denormalised at write time so the row still
 * names a person after that user is disabled or renamed. One indexed read per
 * admin write, and admin writes are a handful a day.
 */
async function actorLabel(tx: Prisma.TransactionClient, user: AuthedUser): Promise<string> {
  const row = await tx.user.findUnique({
    where: { id: user.sub },
    select: { username: true, employee: { select: { fullName: true } } },
  });
  return `${row?.employee?.fullName ?? row?.username ?? user.sub} (${user.roleKey})`;
}
