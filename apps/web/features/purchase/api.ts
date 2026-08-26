import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import type { Paginated } from '@bobs-momo/shared';
import { qs } from '@/features/inventory/api';

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'FULFILLED';
export type PurchaseStatus = 'DRAFT' | 'RECORDED' | 'VOIDED';

export interface VendorRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  isActive: boolean;
  itemCount: number;
  lastPurchaseAt: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  isActive: boolean;
  itemIds: string[];
}

export interface RequestRow {
  id: string;
  requestNo: string;
  outletId: string;
  outletCode: string;
  status: RequestStatus;
  neededBy: string | null;
  lineCount: number;
  requestedById: string;
  createdAt: string;
}

export interface PurchaseRequest {
  id: string;
  requestNo: string;
  outletId: string;
  outletCode: string;
  status: RequestStatus;
  neededBy: string | null;
  note: string | null;
  lines: { id: string; itemId: string; name: string; unitCode: string; quantity: string; note: string | null }[];
  requestedById: string;
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface PurchaseRow {
  id: string;
  purchaseNo: string;
  outletId: string;
  outletCode: string;
  vendorId: string;
  vendorName: string;
  status: PurchaseStatus;
  purchaseDate: string;
  invoiceNo: string | null;
  lineCount: number;
  totalAmount: string;
}

export interface PriceWarning {
  itemId: string;
  name: string;
  unitPrice: string;
  lastUnitPrice: string;
  changePct: string;
}

export interface Purchase {
  id: string;
  purchaseNo: string;
  status: PurchaseStatus;
  outletId: string;
  outletCode: string;
  vendorId: string;
  vendorName: string;
  requestId: string | null;
  purchaseDate: string;
  invoiceNo: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  lines: {
    id: string;
    itemId: string;
    name: string;
    unitCode: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
    balanceAfter: string | null;
  }[];
  voidedAt: string | null;
  voidReason: string | null;
  recordedById: string;
  createdAt: string;
  priceWarnings?: PriceWarning[];
}

export interface PriceObservation {
  id: string;
  itemId: string;
  itemName: string;
  unitCode: string;
  vendorId: string;
  vendorName: string;
  unitPrice: string;
  observedOn: string;
  purchaseId: string;
}

export interface ListVendorsParams {
  page?: number;
  pageSize?: number;
  q?: string;
  isActive?: boolean;
}

export const listVendors = (p: ListVendorsParams = {}) =>
  apiGet<Paginated<VendorRow>>(`/vendors${qs({ ...p })}`);
export const getVendor = (id: string) => apiGet<Vendor>(`/vendors/${id}`);
export const createVendor = (body: unknown) => apiPost<Vendor>('/vendors', body);
export const updateVendor = (id: string, body: unknown) => apiPatch<Vendor>(`/vendors/${id}`, body);
export const deactivateVendor = (id: string) => apiPost<Vendor>(`/vendors/${id}/deactivate`, {});
export const setVendorItems = (id: string, itemIds: string[]) =>
  apiPut<Vendor>(`/vendors/${id}/items`, { itemIds });

export interface ListRequestsParams {
  page?: number;
  pageSize?: number;
  outletId?: string;
  status?: RequestStatus;
  requestedById?: string;
  from?: string;
  to?: string;
}

export const listRequests = (p: ListRequestsParams = {}) =>
  apiGet<Paginated<RequestRow>>(`/purchase-requests${qs({ ...p })}`);
export const getRequest = (id: string) => apiGet<PurchaseRequest>(`/purchase-requests/${id}`);
export const createRequest = (body: unknown) =>
  apiPost<PurchaseRequest>('/purchase-requests', body);
export const decideRequest = (
  id: string,
  decision: 'approve' | 'reject' | 'cancel',
  decisionNote?: string,
) =>
  apiPost<PurchaseRequest>(
    `/purchase-requests/${id}/${decision}`,
    decisionNote ? { decisionNote } : {},
  );

export interface ListPurchasesParams {
  page?: number;
  pageSize?: number;
  outletId?: string;
  vendorId?: string;
  status?: PurchaseStatus;
  from?: string;
  to?: string;
}

export const listPurchases = (p: ListPurchasesParams = {}) =>
  apiGet<Paginated<PurchaseRow>>(`/purchases${qs({ ...p })}`);
export const getPurchase = (id: string) => apiGet<Purchase>(`/purchases/${id}`);
export const createPurchase = (body: unknown, idempotencyKey: string) =>
  apiPost<Purchase>('/purchases', body, { headers: { 'Idempotency-Key': idempotencyKey } });
export const voidPurchase = (id: string, reason: string) =>
  apiPost<Purchase>(`/purchases/${id}/void`, { reason });

export interface PriceHistoryParams {
  page?: number;
  pageSize?: number;
  itemId?: string;
  vendorId?: string;
  from?: string;
  to?: string;
}

export const listPriceHistory = (p: PriceHistoryParams = {}) =>
  apiGet<Paginated<PriceObservation>>(`/purchases/price-history${qs({ ...p })}`);
