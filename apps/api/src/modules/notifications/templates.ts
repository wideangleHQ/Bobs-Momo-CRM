import type { EventKey } from '@bobs-momo/shared';
import { str, type Payload } from './recipients';

export interface RenderedNotification {
  title: string;
  body: string;
  deepLink: string | null;
  whatsapp?: { templateName: string; variables: string[] };
}

export type Template = (payload: Payload) => RenderedNotification;

const enc = encodeURIComponent;

/** Free text goes in title and body, which the frontend renders as text nodes. */
function text(payload: Payload, key: string, fallback = ''): string {
  const value = payload[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

/**
 * Ids only, and every one escaped. A task title carrying `?outletId=other`
 * would otherwise rewrite the query string of the link it lands in.
 */
function link(path: string, params: Record<string, string | null> = {}): string {
  const pairs = Object.entries(params).filter((e): e is [string, string] => e[1] !== null);
  if (pairs.length === 0) return path;
  return `${path}?${pairs.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')}`;
}

/** A notification saying "due 14:30" has to mean 14:30 in Bhubaneswar. */
function fmtIst(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return 'the due time';
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return 'the due time';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

function fmtDate(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return fmtIst(value);
}

export const templates: Record<EventKey, Template> = {
  LOW_STOCK: (p) => ({
    title: `Low stock: ${text(p, 'itemName', 'an item')}`,
    body:
      `${text(p, 'itemName', 'An item')} at ${text(p, 'outletName', 'the outlet')} is down to ` +
      `${text(p, 'qtyOnHand', '0')} ${text(p, 'unitCode')}. Reorder level is ` +
      `${text(p, 'reorderLevel', '0')} ${text(p, 'unitCode')}.`,
    deepLink: link('/inventory/stock', {
      outletId: str(p, 'outletId'),
      itemId: str(p, 'itemId'),
    }),
    whatsapp: {
      templateName: 'low_stock_alert',
      variables: [
        text(p, 'itemName'),
        text(p, 'outletName'),
        `${text(p, 'qtyOnHand')} ${text(p, 'unitCode')}`.trim(),
        `${text(p, 'reorderLevel')} ${text(p, 'unitCode')}`.trim(),
      ],
    },
  }),

  TASK_ASSIGNED: (p) => ({
    title: 'New task assigned',
    body:
      `${text(p, 'title', 'A task')}. Due ${fmtIst(p['dueAt'])}. ` +
      `Priority ${text(p, 'priority', 'NORMAL')}.`,
    deepLink: link(`/tasks/${enc(str(p, 'taskId') ?? '')}`),
    whatsapp: {
      templateName: 'task_assigned',
      variables: [text(p, 'title'), text(p, 'outletName'), fmtIst(p['dueAt'])],
    },
  }),

  TASK_OVERDUE: (p) => ({
    title: 'Task overdue',
    body: `${text(p, 'title', 'A task')} was due ${fmtIst(p['dueAt'])} and is still open.`,
    deepLink: link(`/tasks/${enc(str(p, 'taskId') ?? '')}`),
    whatsapp: {
      templateName: 'task_overdue',
      variables: [
        text(p, 'title'),
        text(p, 'outletName'),
        fmtIst(p['dueAt']),
        text(p, 'assigneeName', 'nobody'),
      ],
    },
  }),

  CHECKLIST_MISSED: (p) => ({
    title: 'Checklist missed',
    body:
      `${text(p, 'title', 'A checklist')} at ${text(p, 'outletName', 'the outlet')} was not ` +
      `completed before ${fmtIst(p['dueAt'])}.`,
    deepLink: link(`/tasks/${enc(str(p, 'taskId') ?? '')}`),
  }),

  AUDIT_ITEM_FAILED: (p) => ({
    title: 'Audit item failed',
    body:
      `Checklist "${text(p, 'checklistName', 'audit')}" item "${text(p, 'itemLabel', 'an item')}" ` +
      `was marked FAIL at ${text(p, 'outletName', 'the outlet')} by ` +
      `${text(p, 'recordedByName', 'a staff member')}.`,
    deepLink: link(`/tasks/${enc(str(p, 'taskId') ?? '')}`),
    whatsapp: {
      templateName: 'audit_item_failed',
      variables: [
        text(p, 'outletName'),
        text(p, 'checklistName'),
        text(p, 'itemLabel'),
        text(p, 'recordedByName'),
      ],
    },
  }),

  LEAVE_REQUESTED: (p) => ({
    title: 'Leave requested',
    body:
      `${text(p, 'employeeName', 'An employee')} requested ${text(p, 'leaveType', 'leave')} ` +
      `from ${fmtDate(p['fromDate'])} to ${fmtDate(p['toDate'])}.`,
    deepLink: link(`/workforce/leave/${enc(str(p, 'leaveId') ?? '')}`),
    whatsapp: {
      templateName: 'leave_requested',
      variables: [
        text(p, 'employeeName'),
        text(p, 'leaveType'),
        fmtDate(p['fromDate']),
        fmtDate(p['toDate']),
        text(p, 'reason', 'not given'),
      ],
    },
  }),

  LEAVE_DECIDED: (p) => {
    const approved = text(p, 'status') === 'APPROVED';
    return {
      title: `Leave ${approved ? 'approved' : 'rejected'}`,
      body:
        `Your ${text(p, 'leaveType', 'leave')} from ${fmtDate(p['fromDate'])} to ` +
        `${fmtDate(p['toDate'])} was ${approved ? 'approved' : 'rejected'} by ` +
        `${text(p, 'decidedByName', 'your manager')}.` +
        (str(p, 'decisionNote') ? ` Note: ${text(p, 'decisionNote')}` : ''),
      deepLink: link(`/workforce/leave/${enc(str(p, 'leaveId') ?? '')}`),
      whatsapp: {
        templateName: 'leave_decision',
        variables: [
          approved ? 'approved' : 'rejected',
          fmtDate(p['fromDate']),
          fmtDate(p['toDate']),
          text(p, 'decidedByName'),
        ],
      },
    };
  },

  PURCHASE_REQUESTED: (p) => ({
    title: `Purchase request ${text(p, 'requestNo', 'raised')}`,
    body:
      `${text(p, 'requestNo', 'A request')} for ${text(p, 'outletName', 'an outlet')} with ` +
      `${text(p, 'lineCount', '0')} items is waiting for a decision.`,
    deepLink: link(`/purchase/requests/${enc(str(p, 'requestId') ?? '')}`),
    whatsapp: {
      templateName: 'purchase_requested',
      variables: [
        text(p, 'requestNo'),
        text(p, 'requesterName', 'a manager'),
        text(p, 'outletName'),
        text(p, 'lineCount', '0'),
        fmtDate(p['neededBy']),
      ],
    },
  }),

  PURCHASE_DECIDED: (p) => ({
    title: `Purchase request ${text(p, 'status', 'decided').toLowerCase()}`,
    body: `${text(p, 'requestNo', 'Your request')} was ${text(p, 'status', 'decided').toLowerCase()}.`,
    deepLink: link(`/purchase/requests/${enc(str(p, 'requestId') ?? '')}`),
  }),

  PURCHASE_RECORDED: (p) => ({
    title: 'Purchase recorded',
    body:
      `${text(p, 'purchaseNo', 'A purchase')} from ${text(p, 'vendorName', 'a vendor')} was ` +
      `received at ${text(p, 'outletName', 'the outlet')}.`,
    deepLink: link(`/purchase/records/${enc(str(p, 'purchaseId') ?? '')}`),
  }),

  SALES_ENTRY_MISSING: (p) => ({
    title: 'Sales entry missing',
    body:
      `No sales entry for ${text(p, 'outletName', 'the outlet')} on ` +
      `${fmtDate(p['businessDate'])}. Enter it before closing.`,
    deepLink: link('/sales/entries', { outletId: str(p, 'outletId') }),
    whatsapp: {
      templateName: 'sales_entry_missing',
      variables: [text(p, 'outletName'), fmtDate(p['businessDate'])],
    },
  }),

  BROADCAST: (p) => ({
    title: `Message from ${text(p, 'senderName', 'the team')}`,
    body: text(p, 'body', 'A new message is waiting for you.'),
    deepLink: link(`/messages/${enc(str(p, 'messageId') ?? '')}`),
    whatsapp: {
      templateName: 'broadcast_message',
      variables: [
        text(p, 'senderName'),
        text(p, 'scopeLabel', text(p, 'scope', 'everyone')),
        text(p, 'body'),
      ],
    },
  }),

  REWARD_ISSUED: (p) => ({
    title: 'Reward issued',
    body: `${text(p, 'rewardName', 'A reward')} was issued. Code ${text(p, 'couponCode', '-')}.`,
    deepLink: null,
    whatsapp: {
      templateName: 'reward_issued',
      variables: [
        text(p, 'rewardName'),
        text(p, 'couponCode'),
        fmtDate(p['expiresAt']),
      ],
    },
  }),

  OPERATIONAL_ALERT: (p) => ({
    title: text(p, 'title', 'Operational alert'),
    body: text(p, 'alertText', 'An operational alert needs your attention.'),
    deepLink: str(p, 'deepLink') ?? link('/dashboard', { outletId: str(p, 'outletId') }),
    whatsapp: {
      templateName: 'operational_alert',
      variables: [
        text(p, 'raisedByName', 'the system'),
        text(p, 'outletName'),
        text(p, 'alertText'),
      ],
    },
  }),
};
