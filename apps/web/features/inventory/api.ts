import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Paginated } from '@bobs-momo/shared';

export type TxnType = 'OPENING' | 'RECEIVED' | 'ISSUED' | 'WASTAGE' | 'ADJUSTMENT';
export type AnyTxnType = TxnType | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'CLOSING';

export interface Item {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  categoryName: string;
  unitId: string;
  unitCode: string;
  isPerishable: boolean;
  isActive: boolean;
}

export interface StockRow {
  itemId: string;
  sku: string;
  name: string;
  unitCode: string;
  categoryId: string;
  categoryName: string;
  outletId: string;
  outletCode: string;
  qtyOnHand: string;
  reorderLevel: string | null;
  isNegative: boolean;
  isBelowReorder: boolean;
  lastAlertAt: string | null;
}

export interface Txn {
  id: string;
  businessDate: string;
  type: AnyTxnType;
  item: { id: string; name: string; unitCode: string };
  outletCode: string;
  quantity: string;
  signedQty: string;
  balanceAfter: string;
  reason: string | null;
  note: string | null;
  createdById: string;
  createdAt: string;
}

export interface RecordedTxn {
  id: string;
  itemId: string;
  outletId: string;
  type: TxnType;
  quantity: string;
  signedQty: string;
  balanceAfter: string;
  businessDate: string;
  reason: string | null;
  note: string | null;
  sourceType: string | null;
  createdById: string;
  createdAt: string;
  lowStockRaised: boolean;
}

export interface ReorderLevelResult {
  itemId: string;
  outletId: string;
  qtyOnHand: string;
  reorderLevel: string | null;
}

/** Drops undefined and empty values so a blank filter never reaches the API. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

export interface ListItemsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  categoryId?: string;
  includeInactive?: boolean;
}

export const listItems = (p: ListItemsParams = {}) =>
  apiGet<Paginated<Item>>(`/inventory/items${qs({ ...p })}`);

export const getItem = (id: string) => apiGet<Item>(`/inventory/items/${id}`);

export const createItem = (body: unknown) => apiPost<Item>('/inventory/items', body);

export const updateItem = (id: string, body: unknown) =>
  apiPatch<Item>(`/inventory/items/${id}`, body);

export const deactivateItem = (id: string) =>
  apiPost<Item>(`/inventory/items/${id}/deactivate`, {});

export interface ListStockParams {
  page?: number;
  pageSize?: number;
  outletId?: string;
  categoryId?: string;
  search?: string;
  belowReorder?: boolean;
}

export const listStock = (p: ListStockParams = {}) =>
  apiGet<Paginated<StockRow>>(`/inventory/stock${qs({ ...p })}`);

export const setReorderLevel = (itemId: string, body: { outletId: string; reorderLevel: number | null }) =>
  apiPatch<ReorderLevelResult>(`/inventory/stock/${itemId}/reorder-level`, body);

export interface ListTxnParams {
  page?: number;
  pageSize?: number;
  outletId?: string;
  itemId?: string;
  categoryId?: string;
  type?: AnyTxnType;
  from?: string;
  to?: string;
  createdById?: string;
}

export const listTransactions = (p: ListTxnParams = {}) =>
  apiGet<Paginated<Txn>>(`/inventory/transactions${qs({ ...p })}`);

export const recordTransaction = (body: unknown, idempotencyKey: string) =>
  apiPost<RecordedTxn>('/inventory/transactions', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });

/** The backend writes its messages for staff to read, so show them verbatim. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}

export function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}
