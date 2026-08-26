import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate, type ListAuditQuery } from '@bobs-momo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestScope } from '../../common/types/request';

// Asia/Kolkata. A day boundary read in UTC would file an 8pm entry under
// yesterday for the people reading the screen.
const IST = '+05:30';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read only, and that is the whole point of the table. There is no update and
 * no delete method here, and adding one would defeat the only record of what
 * an administrator did.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAuditQuery, scope: RequestScope) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.outletId
        ? { outletId: query.outletId }
        : {
            // Logins, user administration and reference data carry no outlet.
            // Filtering them out would leave the screen looking empty.
            OR: [{ outletId: { in: scope.outletIds } }, { outletId: null }],
          }),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000${IST}`) } : {}),
              ...(query.to
                ? { lt: new Date(new Date(`${query.to}T00:00:00.000${IST}`).getTime() + DAY_MS) }
                : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { username: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(
      rows.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorLabel: r.actorLabel,
        actorUsername: r.actor?.username ?? null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        outletId: r.outletId,
        before: r.before,
        after: r.after,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  /**
   * A DEAD outbox row is a notification that was owed to somebody and never
   * arrived: a low stock alert, a leave decision, an overdue task. The
   * dispatcher retries and then gives up, and without this screen nothing in
   * the product ever says so. Read only, same as the audit log: replaying a
   * dead row is a deploy-time decision, not a button.
   */
  async deadLetters(query: { page: number; pageSize: number }) {
    const where = { status: 'DEAD' as const };
    const [rows, total, pending] = await this.prisma.$transaction([
      this.prisma.outboxEvent.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.outboxEvent.count({ where }),
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      ...paginate(
        rows.map((r) => ({
          id: r.id,
          eventKey: r.eventKey,
          aggregateType: r.aggregateType,
          aggregateId: r.aggregateId,
          attempts: r.attempts,
          lastError: r.lastError,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        query,
      ),
      // A backlog that is growing means the dispatcher is behind or stopped,
      // which is a different problem from a row that failed on its own merits.
      pendingCount: pending,
    };
  }
}
