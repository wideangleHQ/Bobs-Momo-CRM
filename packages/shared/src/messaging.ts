import { z } from 'zod';
import type { EventKey } from './enums';
import { uuidSchema } from './inventory';
import { pageQuerySchema } from './pagination';

// ---- phone numbers -------------------------------------------------------

// Meta accepts E.164 without the plus. Anything else is rejected or, worse,
// delivered to the wrong country, so a number that fails every branch below is
// never handed to the API.
export function toE164India(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0091[6-9]\d{9}$/.test(digits)) return `+${digits.slice(2)}`;

  return null;
}

// Full phone numbers do not go in application logs.
export function maskPhone(value: string): string {
  if (value.length <= 5) return '***';
  return `${value.slice(0, -5)}***${value.slice(-2)}`;
}

// ---- WhatsApp templates --------------------------------------------------

export const WHATSAPP_TEMPLATE_LANGUAGE = 'en';

export interface WhatsAppTemplate {
  name: string;
  /** Placeholder count in the approved body. A mismatch is Meta error 132000. */
  variables: number;
}

// One template per WhatsApp-enabled event key, all category UTILITY.
// Chapter 22. Adding an entry here without submitting the template to Meta
// produces error 132001 at send time, not a compile error.
export const WHATSAPP_TEMPLATES = {
  LOW_STOCK: { name: 'low_stock_alert', variables: 4 },
  TASK_ASSIGNED: { name: 'task_assigned', variables: 3 },
  TASK_OVERDUE: { name: 'task_overdue', variables: 4 },
  LEAVE_REQUESTED: { name: 'leave_requested', variables: 5 },
  LEAVE_DECIDED: { name: 'leave_decision', variables: 4 },
  PURCHASE_REQUESTED: { name: 'purchase_requested', variables: 5 },
  AUDIT_ITEM_FAILED: { name: 'audit_item_failed', variables: 4 },
  SALES_ENTRY_MISSING: { name: 'sales_entry_missing', variables: 2 },
  BROADCAST: { name: 'broadcast_message', variables: 3 },
  REWARD_ISSUED: { name: 'reward_issued', variables: 3 },
  OPERATIONAL_ALERT: { name: 'operational_alert', variables: 3 },
} as const satisfies Partial<Record<EventKey, WhatsAppTemplate>>;

export type WhatsAppTemplateEventKey = keyof typeof WHATSAPP_TEMPLATES;
export type WhatsAppTemplateName =
  (typeof WHATSAPP_TEMPLATES)[WhatsAppTemplateEventKey]['name'];

export function whatsappTemplateFor(eventKey: string): WhatsAppTemplate | null {
  return (WHATSAPP_TEMPLATES as Record<string, WhatsAppTemplate | undefined>)[eventKey] ?? null;
}

// ---- messaging -----------------------------------------------------------

export const MESSAGE_SCOPES = ['DIRECT', 'OUTLET', 'DEPARTMENT', 'ALL'] as const;
export type MessageScope = (typeof MESSAGE_SCOPES)[number];

export const BROADCAST_SCOPES = ['OUTLET', 'DEPARTMENT', 'ALL'] as const;
export type BroadcastScope = (typeof BROADCAST_SCOPES)[number];

// Scope ALL reaches staff at an outlet the sender has never visited. That is a
// different act from telling your own kitchen the fryer is broken.
export const ALL_SCOPE_ROLES = ['OWNER', 'OPERATIONS_MANAGER'] as const;

const messageBodySchema = z.string().trim().min(1).max(2000);

export const sendDirectMessageSchema = z
  .object({ recipientId: uuidSchema, body: messageBodySchema })
  .strict();
export type SendDirectMessageDto = z.infer<typeof sendDirectMessageSchema>;

export const sendBroadcastSchema = z
  .object({
    scope: z.enum(BROADCAST_SCOPES),
    outletId: uuidSchema.optional(),
    departmentId: uuidSchema.optional(),
    body: messageBodySchema,
  })
  .strict()
  // Exactly one target column is set. The same invariant the database check
  // constraint enforces, so a DEPARTMENT message can never also carry an
  // outletId and be counted twice in the unread badge.
  .refine(
    (v) =>
      (v.scope === 'OUTLET' && v.outletId !== undefined && v.departmentId === undefined) ||
      (v.scope === 'DEPARTMENT' && v.departmentId !== undefined && v.outletId === undefined) ||
      (v.scope === 'ALL' && v.outletId === undefined && v.departmentId === undefined),
    { message: 'Set exactly the target that matches the scope' },
  );
export type SendBroadcastDto = z.infer<typeof sendBroadcastSchema>;

export const listMessagesQuery = pageQuerySchema.extend({
  scope: z.enum(MESSAGE_SCOPES).optional(),
  outletId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  withUserId: uuidSchema.optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;

export interface MessageView {
  id: string;
  scope: MessageScope;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  outletId: string | null;
  departmentId: string | null;
  body: string;
  isPinned: boolean;
  createdAt: string;
}

export const MESSAGING_ERRORS = {
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  BROADCAST_SCOPE_FORBIDDEN: 'BROADCAST_SCOPE_FORBIDDEN',
  RECIPIENT_NOT_ACTIVE: 'RECIPIENT_NOT_ACTIVE',
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
} as const;
export type MessagingErrorCode = (typeof MESSAGING_ERRORS)[keyof typeof MESSAGING_ERRORS];

/** `Notification.failReason` when a recipient's phone will not normalise. */
export const WHATSAPP_INVALID_PHONE = 'INVALID_PHONE';
