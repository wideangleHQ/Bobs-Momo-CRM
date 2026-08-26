import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EVENT_CHANNELS, isEventKey } from '@bobs-momo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolvers, type Payload } from './recipients';
import { templates } from './templates';

const CLAIM_LIMIT = 50;

/** Redelivery of the same outbox row must not produce a second inbox row. */
const SUPPRESSION_MINUTES = 5;

/** attempts increments at claim time, so a killed process leaves a counted row. */
const STUCK_MINUTES = 5;

/** One entry per surviving attempt. The fifth failure has nowhere left to go. */
export const BACKOFF_SECONDS = [30, 120, 600, 3600] as const;
export const MAX_ATTEMPTS = 5;

export function nextAvailableAt(attempts: number): Date | null {
  const seconds = BACKOFF_SECONDS[attempts - 1];
  if (attempts >= MAX_ATTEMPTS || seconds === undefined) return null;
  return new Date(Date.now() + seconds * 1000);
}

interface ClaimedRow {
  id: string;
  eventKey: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

function asPayload(value: Prisma.JsonValue): Payload {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Payload)
    : {};
}

@Injectable()
export class OutboxDispatcherService {
  private readonly log = new Logger(OutboxDispatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Returns the number of rows claimed this tick. Never throws per row. */
  async dispatch(): Promise<number> {
    await this.rescueStuck();
    const claimed = await this.claim();

    for (const row of claimed) {
      try {
        await this.deliver(row);
      } catch (err) {
        // A bad payload on one row must not stop the other forty nine.
        await this.reschedule(row, err);
      }
    }
    return claimed.length;
  }

  /**
   * A process killed between claim and completion leaves a row in PROCESSING
   * with nothing scheduled to touch it again. The predicate excludes rows
   * already moved, so running this repeatedly is free.
   */
  private async rescueStuck(): Promise<number> {
    const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000);
    const { count } = await this.prisma.outboxEvent.updateMany({
      where: { status: 'PROCESSING', createdAt: { lt: cutoff } },
      data: {
        status: 'PENDING',
        availableAt: new Date(),
        lastError: 'recovered from stuck PROCESSING',
      },
    });
    if (count > 0) this.log.warn(`rescued ${count} outbox rows stuck in PROCESSING`);
    return count;
  }

  /**
   * SKIP LOCKED is what makes a second replica safe: the two instances get
   * disjoint batches instead of one blocking and then reprocessing the same
   * fifty rows.
   *
   * `now() AT TIME ZONE 'UTC'` rather than `now()`, because availableAt is a
   * `timestamp` without a zone holding UTC wall clock, and comparing it to a
   * `timestamptz` makes Postgres reinterpret it in the session TimeZone. On a
   * container running Asia/Kolkata that shifts every row 5.5 hours into the
   * past, so every backoff is ignored and a failing row burns all five attempts
   * in five consecutive ticks.
   */
  private claim(): Promise<ClaimedRow[]> {
    return this.prisma.$queryRaw<ClaimedRow[]>`
      WITH claimed AS (
        SELECT id
        FROM   "OutboxEvent"
        WHERE  status = 'PENDING'
          AND  "availableAt" <= (now() AT TIME ZONE 'UTC')
        ORDER  BY "availableAt"
        LIMIT  ${CLAIM_LIMIT}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "OutboxEvent" o
      SET    status = 'PROCESSING',
             attempts = o.attempts + 1
      FROM   claimed
      WHERE  o.id = claimed.id
      RETURNING o.id, o."eventKey", o."aggregateType", o."aggregateId",
                o.payload, o.attempts`;
  }

  private async deliver(row: ClaimedRow): Promise<void> {
    if (!isEventKey(row.eventKey)) {
      throw new Error(`no resolver registered for event key ${row.eventKey}`);
    }
    const eventKey = row.eventKey;
    const payload = asPayload(row.payload);

    const userIds = [...new Set(await resolvers[eventKey](payload, this.prisma))];
    if (userIds.length === 0) {
      this.log.warn(`recipients=0 eventKey=${eventKey} aggregateId=${row.aggregateId}`);
    }

    const channels = EVENT_CHANNELS[eventKey];
    const [muted, alreadySent] = await Promise.all([
      this.mutedPairs(eventKey, userIds),
      this.recentPairs(eventKey, row.aggregateId, userIds),
    ]);

    const rendered = templates[eventKey](payload);
    const now = new Date();
    const rows: Prisma.NotificationCreateManyInput[] = [];

    for (const userId of userIds) {
      for (const channel of channels) {
        const pair = `${userId}:${channel}`;
        // Rule 4 of preference resolution: IN_APP is the record, so a stored
        // row disabling it is ignored rather than obeyed.
        if (channel !== 'IN_APP' && muted.has(pair)) continue;
        if (alreadySent.has(pair)) continue;
        rows.push({
          userId,
          eventKey,
          channel,
          // The in-app row is its own delivery. WhatsApp is queued for the
          // sender to pick up and stamp with a provider reference.
          status: channel === 'IN_APP' ? 'SENT' : 'QUEUED',
          sentAt: channel === 'IN_APP' ? now : null,
          title: rendered.title,
          body: rendered.body,
          deepLink: rendered.deepLink,
          payload: { ...payload, aggregateId: row.aggregateId } as Prisma.InputJsonValue,
        });
      }
    }

    if (rows.length > 0) await this.prisma.notification.createMany({ data: rows });

    await this.prisma.outboxEvent.update({
      where: { id: row.id },
      data: { status: 'DONE', processedAt: new Date(), lastError: null },
    });
  }

  /** One query for the whole recipient list rather than one per user. */
  private async mutedPairs(eventKey: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { eventKey, userId: { in: userIds }, enabled: false },
      select: { userId: true, channel: true },
    });
    return new Set(prefs.map((p) => `${p.userId}:${p.channel}`));
  }

  private async recentPairs(
    eventKey: string,
    aggregateId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const since = new Date(Date.now() - SUPPRESSION_MINUTES * 60_000);
    const existing = await this.prisma.notification.findMany({
      where: {
        eventKey,
        userId: { in: userIds },
        createdAt: { gt: since },
        payload: { path: ['aggregateId'], equals: aggregateId },
      },
      select: { userId: true, channel: true },
    });
    return new Set(existing.map((n) => `${n.userId}:${n.channel}`));
  }

  private async reschedule(row: ClaimedRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const availableAt = nextAvailableAt(row.attempts);
    this.log.error(
      `outbox ${row.id} (${row.eventKey}) failed on attempt ${row.attempts}: ${message}`,
    );
    try {
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data:
          availableAt === null
            ? { status: 'DEAD', lastError: message.slice(0, 500), processedAt: new Date() }
            : { status: 'PENDING', availableAt, lastError: message.slice(0, 500) },
      });
    } catch (updateErr) {
      // The row stays PROCESSING and rescueStuck picks it up. Nothing is lost.
      this.log.error(`could not reschedule outbox ${row.id}`, updateErr as Error);
    }
  }
}
