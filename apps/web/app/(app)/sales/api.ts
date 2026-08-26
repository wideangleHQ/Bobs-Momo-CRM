import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { qs } from '@/features/analytics/api';

export interface SalesEntry {
  id: string;
  outletId: string;
  outletCode?: string;
  businessDate: string;
  grossSales: string;
  discounts: string;
  netSales: string;
  orderCount: number | null;
  cashAmount: string;
  upiAmount: string;
  cardAmount: string;
  otherAmount: string;
  note: string | null;
  enteredBy?: { id: string; fullName: string } | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesListResponse {
  data: SalesEntry[];
  meta: { page: number; pageSize: number; total: number };
}

export interface SalesSummaryResponse {
  from: string;
  to: string;
  totals: {
    netSales: string;
    grossSales: string;
    discounts: string;
    orderCount: number | null;
    entryCount: number;
    expectedEntryCount: number;
    paymentMix: { cash: string; upi: string; card: string; other: string };
  };
  byOutlet: Array<{
    outletId: string;
    outletCode: string;
    netSales: string;
    orderCount: number | null;
    entryCount: number;
  }>;
}

export interface CreateSalesBody {
  outletId: string;
  businessDate: string;
  grossSales: number;
  discounts: number;
  orderCount?: number | null;
  cashAmount: number;
  upiAmount: number;
  cardAmount: number;
  otherAmount: number;
  note?: string;
}

export const salesKeys = {
  all: () => ['sales'] as const,
  list: (f: Record<string, string | number | undefined>) => ['sales', 'list', f] as const,
  summary: (f: Record<string, string | undefined>) => ['sales', 'summary', f] as const,
  entry: (outletId: string, businessDate: string) =>
    ['sales', 'entry', outletId, businessDate] as const,
};

export const listSales = (f: {
  outletId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) => apiGet<SalesListResponse>(`/sales${qs({ ...f })}`);

export const fetchSalesSummary = (f: { from: string; to: string; outletId?: string }) =>
  apiGet<SalesSummaryResponse>(`/sales/summary${qs({ ...f })}`);

/** A day with no entry is 404 by design, which the entry screen reads as "new". */
export async function fetchSalesEntry(
  outletId: string,
  businessDate: string,
): Promise<SalesEntry | null> {
  try {
    return await apiGet<SalesEntry>(`/sales/${outletId}/${businessDate}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export const createSalesEntry = (body: CreateSalesBody) => apiPost<SalesEntry>('/sales', body);

export const updateSalesEntry = (id: string, body: Partial<Omit<CreateSalesBody, 'outletId' | 'businessDate'>>) =>
  apiPatch<SalesEntry>(`/sales/${id}`, body);

export const unlockSalesEntry = (id: string) => apiPost<SalesEntry>(`/sales/${id}/unlock`);
