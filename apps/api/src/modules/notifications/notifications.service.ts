import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EVENT_CHANNELS,
  EVENT_KEYS,
  NOTIFICATION_ERRORS,
  UNDISABLEABLE_CHANNEL,
  isEventKey,
  isNotificationChannel,
  paginate,
  type EventKey,
  type ListNotificationsQuery,
  type NotificationChannel,
  type NotificationView,
  type PreferenceView,
  type ReadAllDto,
  type UpdatePreferencesDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';

// WhatsApp rows are delivery records, not inbox items.
const INBOX_CHANNEL = 'IN_APP';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      channel: INBOX_CHANNEL,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.eventKey ? { eventKey: query.eventKey } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    const data: NotificationView[] = rows.map((n) => ({
      id: n.id,
      eventKey: n.eventKey,
      title: n.title,
      body: n.body,
      deepLink: n.deepLink,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
    return paginate(data, total, query);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, channel: INBOX_CHANNEL, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<{ id: string; readAt: string }> {
    // Unknown id and another user's id are indistinguishable from outside on
    // purpose: a 403 would confirm the row exists.
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true, readAt: true },
    });
    if (!existing) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        NOTIFICATION_ERRORS.NOTIFICATION_NOT_FOUND,
        'That notification does not exist',
      );
    }
    if (existing.readAt) return { id, readAt: existing.readAt.toISOString() };

    const readAt = new Date();
    await this.prisma.notification.update({ where: { id }, data: { readAt } });
    return { id, readAt: readAt.toISOString() };
  }

  async readAll(userId: string, dto: ReadAllDto): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        userId,
        channel: INBOX_CHANNEL,
        readAt: null,
        ...(dto.eventKey ? { eventKey: dto.eventKey } : {}),
      },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /**
   * The full matrix with defaults filled in, so the UI can render checkboxes
   * without carrying a copy of the default table.
   */
  async getPreferences(userId: string): Promise<{ data: PreferenceView[] }> {
    const stored = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const byTriple = new Map(stored.map((p) => [`${p.eventKey}:${p.channel}`, p.enabled]));

    const data: PreferenceView[] = [];
    for (const eventKey of EVENT_KEYS) {
      for (const channel of EVENT_CHANNELS[eventKey]) {
        const locked = channel === UNDISABLEABLE_CHANNEL;
        data.push({
          eventKey,
          channel,
          enabled: locked ? true : (byTriple.get(`${eventKey}:${channel}`) ?? true),
          locked,
        });
      }
    }
    return { data };
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<{ data: PreferenceView[] }> {
    const validated: { eventKey: EventKey; channel: NotificationChannel; enabled: boolean }[] = [];
    for (const pref of dto.preferences) {
      if (!isEventKey(pref.eventKey)) {
        throw new DomainError(
          HttpStatus.BAD_REQUEST,
          NOTIFICATION_ERRORS.INVALID_EVENT_KEY,
          `${pref.eventKey} is not an event this system emits`,
        );
      }
      if (!isNotificationChannel(pref.channel)) {
        throw new DomainError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          NOTIFICATION_ERRORS.CHANNEL_NOT_AVAILABLE,
          `${pref.channel} is not a delivery channel`,
        );
      }
      if (pref.channel === UNDISABLEABLE_CHANNEL && !pref.enabled) {
        throw new DomainError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          NOTIFICATION_ERRORS.CHANNEL_NOT_DISABLEABLE,
          'The in-app notification is the record and cannot be turned off',
        );
      }
      // Opting in to a channel the event has no template for would create a
      // preference row that can never do anything.
      if (!EVENT_CHANNELS[pref.eventKey].includes(pref.channel)) {
        throw new DomainError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          NOTIFICATION_ERRORS.CHANNEL_NOT_AVAILABLE,
          `${pref.eventKey} is not delivered over ${pref.channel}`,
        );
      }
      validated.push({ eventKey: pref.eventKey, channel: pref.channel, enabled: pref.enabled });
    }

    await this.prisma.$transaction(
      validated.map((pref) =>
        this.prisma.notificationPreference.upsert({
          where: {
            userId_eventKey_channel: {
              userId,
              eventKey: pref.eventKey,
              channel: pref.channel,
            },
          },
          create: {
            userId,
            eventKey: pref.eventKey,
            channel: pref.channel,
            enabled: pref.enabled,
          },
          update: { enabled: pref.enabled },
        }),
      ),
    );

    return this.getPreferences(userId);
  }
}
