import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALL_SCOPE_ROLES,
  MESSAGING_ERRORS,
  paginate,
  type ListMessagesQuery,
  type MessageView,
  type Paginated,
  type SendBroadcastDto,
  type SendDirectMessageDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';

// A message unread for a month is not going to be read, and the window bounds
// the candidate set the unread count has to scan.
const UNREAD_WINDOW_DAYS = 30;
const UNREAD_CACHE_TTL_SECONDS = 15;

const unreadKey = (userId: string): string => `msg:unread:${userId}`;

type MessageRow = Prisma.MessageGetPayload<Record<string, never>>;

/** The four target columns. One of them is set, matching the scope. */
interface Addressed {
  scope: MessageRow['scope'];
  senderId: string;
  recipientId: string | null;
  outletId: string | null;
  departmentId: string | null;
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async list(
    query: ListMessagesQuery,
    user: AuthedUser,
    scope: RequestScope,
  ): Promise<Paginated<MessageView>> {
    const departmentId = await this.departmentOf(user);

    if (query.departmentId && query.departmentId !== departmentId) throw this.notFound();

    const filters: Prisma.MessageWhereInput[] = [
      { OR: this.audience(user, scope.outletIds, departmentId) },
    ];

    if (query.scope === 'DIRECT' && query.withUserId) {
      const other = query.withUserId;
      filters.push({
        scope: 'DIRECT',
        OR: [
          { senderId: user.sub, recipientId: other },
          { senderId: other, recipientId: user.sub },
        ],
      });
    } else if (query.scope) {
      filters.push({ scope: query.scope });
    }
    if (query.outletId) filters.push({ outletId: query.outletId });
    if (query.departmentId) filters.push({ departmentId: query.departmentId });

    const where: Prisma.MessageWhereInput = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.message.count({ where }),
    ]);

    const names = await this.senderNames(rows.map((r) => r.senderId));
    return paginate(
      rows.map((r) => this.toView(r, names)),
      total,
      query,
    );
  }

  async sendDirect(dto: SendDirectMessageDto, user: AuthedUser): Promise<MessageView> {
    const recipient = await this.prisma.user.findUnique({
      where: { id: dto.recipientId },
      select: { id: true, status: true },
    });
    if (!recipient) throw this.notFound();
    if (recipient.status !== 'ACTIVE') {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        MESSAGING_ERRORS.RECIPIENT_NOT_ACTIVE,
        'That person can no longer receive messages',
      );
    }

    const senderName = (await this.senderNames([user.sub])).get(user.sub) ?? 'A colleague';

    // No outbox event and no WhatsApp. A direct message is conversational, and
    // pushing every line of a back and forth to a phone that already has the
    // app is how people learn to mute it.
    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { scope: 'DIRECT', senderId: user.sub, recipientId: dto.recipientId, body: dto.body },
      });
      await tx.notification.create({
        data: {
          userId: dto.recipientId,
          eventKey: 'DIRECT_MESSAGE',
          channel: 'IN_APP',
          title: `Message from ${senderName}`,
          body: dto.body,
          deepLink: `/messages?scope=DIRECT&withUserId=${user.sub}`,
        },
      });
      return message;
    });

    await this.redis.del(unreadKey(dto.recipientId));
    return this.toView(created, new Map([[user.sub, senderName]]));
  }

  async broadcast(
    dto: SendBroadcastDto,
    user: AuthedUser,
    scope: RequestScope,
  ): Promise<MessageView & { recipientEstimate: number }> {
    if (dto.scope === 'ALL' && !ALL_SCOPE_ROLES.some((r) => r === user.roleKey)) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        MESSAGING_ERRORS.BROADCAST_SCOPE_FORBIDDEN,
        'Only an owner or operations manager can message everyone',
      );
    }

    if (dto.scope === 'OUTLET' && !scope.outletIds.includes(dto.outletId ?? '')) throw this.notFound();

    if (dto.scope === 'DEPARTMENT') {
      const department = await this.prisma.department.findUnique({
        where: { id: dto.departmentId ?? '' },
        select: { outletId: true },
      });
      if (!department || !scope.outletIds.includes(department.outletId)) throw this.notFound();
    }

    const addressed: Addressed = {
      scope: dto.scope,
      senderId: user.sub,
      recipientId: null,
      outletId: dto.outletId ?? null,
      departmentId: dto.departmentId ?? null,
    };
    const recipients = await this.resolveRecipients(addressed);

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({ data: { ...addressed, body: dto.body } });
      // The engine expands the scope again at dispatch time. The count here is
      // an estimate for the confirm step, not the delivery list.
      await tx.outboxEvent.create({
        data: {
          eventKey: 'BROADCAST',
          aggregateType: 'Message',
          aggregateId: message.id,
          payload: {
            scope: dto.scope,
            outletId: addressed.outletId,
            departmentId: addressed.departmentId,
            senderId: user.sub,
            body: dto.body,
          },
        },
      });
      return message;
    });

    await this.redis.del(...recipients.map(unreadKey));
    const names = await this.senderNames([user.sub]);
    return { ...this.toView(created, names), recipientEstimate: recipients.length };
  }

  /**
   * Scope expanded to user ids, sender excluded. The outbox dispatcher calls
   * this to fan a BROADCAST out into notification rows.
   */
  async resolveRecipients(message: Addressed): Promise<string[]> {
    if (message.scope === 'DIRECT') {
      return message.recipientId ? [message.recipientId] : [];
    }

    const where: Prisma.EmployeeWhereInput = {
      status: 'ACTIVE',
      user: { is: { status: 'ACTIVE' } },
    };
    if (message.scope === 'OUTLET') where.outletId = message.outletId ?? undefined;
    if (message.scope === 'DEPARTMENT') where.departmentId = message.departmentId ?? undefined;

    const rows = await this.prisma.employee.findMany({ where, select: { userId: true } });
    return rows
      .map((r) => r.userId)
      .filter((id): id is string => id !== null && id !== message.senderId);
  }

  async markRead(id: string, user: AuthedUser, scope: RequestScope): Promise<void> {
    const departmentId = await this.departmentOf(user);
    const visible = await this.prisma.message.findFirst({
      where: { id, OR: this.audience(user, scope.outletIds, departmentId) },
      select: { id: true },
    });
    if (!visible) throw this.notFound();

    // Composite primary key, so a second call is a no-op rather than a duplicate.
    await this.prisma.messageRead.upsert({
      where: { messageId_userId: { messageId: id, userId: user.sub } },
      create: { messageId: id, userId: user.sub },
      update: {},
    });
    await this.redis.del(unreadKey(user.sub));
  }

  async unreadCount(user: AuthedUser, scope: RequestScope): Promise<{ count: number }> {
    const key = unreadKey(user.sub);
    const cached = await this.redis.get<number>(key);
    if (cached !== null) return { count: cached };

    const departmentId = await this.departmentOf(user);
    const since = new Date(Date.now() - UNREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const count = await this.prisma.message.count({
      where: {
        createdAt: { gt: since },
        senderId: { not: user.sub },
        OR: this.audience(user, scope.outletIds, departmentId),
        reads: { none: { userId: user.sub } },
      },
    });

    await this.redis.set(key, count, UNREAD_CACHE_TTL_SECONDS);
    return { count };
  }

  // ---- internals ---------------------------------------------------------

  /** Every message this user is entitled to see, as one OR clause. */
  private audience(
    user: AuthedUser,
    outletIds: string[],
    departmentId: string | null,
  ): Prisma.MessageWhereInput[] {
    const branches: Prisma.MessageWhereInput[] = [
      { scope: 'DIRECT', recipientId: user.sub },
      { scope: 'DIRECT', senderId: user.sub },
      { scope: 'OUTLET', outletId: { in: outletIds } },
      { scope: 'ALL' },
    ];
    if (departmentId) branches.push({ scope: 'DEPARTMENT', departmentId });
    return branches;
  }

  // The feed is membership-based, not history-based: a user who changes outlet
  // loses the old outlet's broadcasts. Documented behaviour, chapter 23.
  private async departmentOf(user: AuthedUser): Promise<string | null> {
    if (!user.employeeId) return null;
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: { departmentId: true },
    });
    return employee?.departmentId ?? null;
  }

  private async senderNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, username: true, employee: { select: { fullName: true } } },
    });
    return new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.username]));
  }

  private toView(row: MessageRow, names: Map<string, string>): MessageView {
    return {
      id: row.id,
      scope: row.scope,
      senderId: row.senderId,
      senderName: names.get(row.senderId) ?? 'Unknown',
      recipientId: row.recipientId,
      outletId: row.outletId,
      departmentId: row.departmentId,
      body: row.body,
      isPinned: row.isPinned,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      MESSAGING_ERRORS.MESSAGE_NOT_FOUND,
      'No such message',
    );
  }
}
