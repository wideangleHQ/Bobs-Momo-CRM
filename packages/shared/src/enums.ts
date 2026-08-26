// Mirrors of the Prisma enums. packages/shared never imports @prisma/client,
// so these are hand-kept. A mismatch is caught by the enum parity test in
// apps/api/test.

export const ROLE_KEYS = [
  'OWNER',
  'OPERATIONS_MANAGER',
  'STORE_MANAGER',
  'KITCHEN_MANAGER',
  'INVENTORY_MANAGER',
  'PURCHASE_MANAGER',
  'HR_ACCOUNTS',
  'KITCHEN_STAFF',
  'COUNTER_CASHIER',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const STOCK_TXN_TYPES = [
  'OPENING',
  'RECEIVED',
  'ISSUED',
  'WASTAGE',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CLOSING',
] as const;
export type StockTxnType = (typeof STOCK_TXN_TYPES)[number];

// Sign applied to `quantity` to produce `signedQty`. Chapter 10, sign rules.
export const STOCK_TXN_SIGN: Record<StockTxnType, 1 | -1> = {
  OPENING: 1,
  RECEIVED: 1,
  TRANSFER_IN: 1,
  ISSUED: -1,
  WASTAGE: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT: 1, // caller passes a signed delta; see InventoryService
  CLOSING: 1,    // variance row, signed delta
};

export const EVENT_KEYS = [
  'LOW_STOCK',
  'TASK_ASSIGNED',
  'TASK_OVERDUE',
  'CHECKLIST_MISSED',
  'AUDIT_ITEM_FAILED',
  'LEAVE_REQUESTED',
  'LEAVE_DECIDED',
  'PURCHASE_REQUESTED',
  'PURCHASE_DECIDED',
  'PURCHASE_RECORDED',
  'SALES_ENTRY_MISSING',
  'BROADCAST',
  'REWARD_ISSUED',
  'OPERATIONAL_ALERT',
] as const;
export type EventKey = (typeof EVENT_KEYS)[number];
