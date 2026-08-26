import { z } from 'zod';
import { EVENT_KEYS, type EventKey } from './enums';
import { pageQuerySchema } from './pagination';

/** Mirrors the Prisma NotificationChannel enum. */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'WHATSAPP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Which channels an event may ever use. WhatsApp needs a Meta-approved template
 * and chapter 22 lists eleven, so the three keys without one cannot offer it.
 * REWARD_ISSUED addresses a Customer rather than a User, so it has no inbox row.
 * A channel absent here cannot be enabled by a preference either.
 */
export const EVENT_CHANNELS: Record<EventKey, readonly NotificationChannel[]> = {
  LOW_STOCK: ['IN_APP', 'WHATSAPP'],
  TASK_ASSIGNED: ['IN_APP', 'WHATSAPP'],
  TASK_OVERDUE: ['IN_APP', 'WHATSAPP'],
  CHECKLIST_MISSED: ['IN_APP'],
  AUDIT_ITEM_FAILED: ['IN_APP', 'WHATSAPP'],
  LEAVE_REQUESTED: ['IN_APP', 'WHATSAPP'],
  LEAVE_DECIDED: ['IN_APP', 'WHATSAPP'],
  PURCHASE_REQUESTED: ['IN_APP', 'WHATSAPP'],
  PURCHASE_DECIDED: ['IN_APP'],
  PURCHASE_RECORDED: ['IN_APP'],
  SALES_ENTRY_MISSING: ['IN_APP', 'WHATSAPP'],
  BROADCAST: ['IN_APP', 'WHATSAPP'],
  REWARD_ISSUED: ['WHATSAPP'],
  OPERATIONAL_ALERT: ['IN_APP', 'WHATSAPP'],
};

/** The in-app row is the record, not just an alert, so it cannot be muted. */
export const UNDISABLEABLE_CHANNEL: NotificationChannel = 'IN_APP';

export const NOTIFICATION_ERRORS = {
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  INVALID_EVENT_KEY: 'INVALID_EVENT_KEY',
  CHANNEL_NOT_DISABLEABLE: 'CHANNEL_NOT_DISABLEABLE',
  CHANNEL_NOT_AVAILABLE: 'CHANNEL_NOT_AVAILABLE',
} as const;

export function isEventKey(value: unknown): value is EventKey {
  return typeof value === 'string' && (EVENT_KEYS as readonly string[]).includes(value);
}

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return (
    typeof value === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(value)
  );
}

// z.coerce.boolean() turns the string "false" into true, which is the wrong
// answer for a query string. Only the literal "true" means true here.
const queryFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const listNotificationsQuery = pageQuerySchema.extend({
  unreadOnly: queryFlag,
  eventKey: z.enum(EVENT_KEYS).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

// Defaulted so a POST with no body at all means "mark everything read".
export const readAllSchema = z
  .object({ eventKey: z.enum(EVENT_KEYS).optional() })
  .strict()
  .default({});
export type ReadAllDto = z.infer<typeof readAllSchema>;

// eventKey and channel stay loose strings so an unknown value returns
// INVALID_EVENT_KEY or CHANNEL_NOT_AVAILABLE rather than a generic zod rejection.
export const updatePreferencesSchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            eventKey: z.string().trim().min(1).max(64),
            channel: z.string().trim().min(1).max(32),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type UpdatePreferencesDto = z.infer<typeof updatePreferencesSchema>;

export interface NotificationView {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface PreferenceView {
  eventKey: EventKey;
  channel: NotificationChannel;
  enabled: boolean;
  locked: boolean;
}
