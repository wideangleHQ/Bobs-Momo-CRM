import { adaptDashboard } from './adapt-dashboard';
import { apiGet } from '@/lib/api';
import type {
  ConsumptionResponse,
  DashboardResponse,
  OutletOption,
  PerformanceResponse,
  PnlResponse,
  PriceHistoryResponse,
  SalesReportResponse,
  WasteResponse,
} from './types';
import type { ReportRange } from './keys';

export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

export const fetchDashboard = async (): Promise<DashboardResponse> =>
  adaptDashboard(await apiGet<unknown>('/analytics/dashboard'));

export const fetchSalesReport = (f: ReportRange & { groupBy?: string }) =>
  apiGet<SalesReportResponse>(`/analytics/sales${qs({ ...f })}`);

export const fetchConsumption = (
  f: ReportRange & { categoryId?: string; itemId?: string; type?: string },
) => apiGet<ConsumptionResponse>(`/analytics/consumption${qs({ ...f })}`);

export const fetchWaste = (f: ReportRange & { categoryId?: string; groupBy?: string }) =>
  apiGet<WasteResponse>(`/analytics/waste${qs({ ...f })}`);

export const fetchPerformance = (f: ReportRange) =>
  apiGet<PerformanceResponse>(`/analytics/performance${qs({ ...f })}`);

export const fetchPnl = (f: ReportRange) => apiGet<PnlResponse>(`/analytics/pnl${qs({ ...f })}`);

export const fetchPriceHistory = (f: ReportRange & { itemId?: string; vendorId?: string }) =>
  apiGet<PriceHistoryResponse>(
    `/purchases/price-history${qs({ ...f, outletId: undefined, pageSize: 100 })}`,
  );

export const fetchOutlets = () => apiGet<{ data: OutletOption[] }>('/outlets');
