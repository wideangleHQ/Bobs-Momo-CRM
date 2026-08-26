export interface ReportRange {
  from: string;
  to: string;
  outletId?: string;
}

const ana = ['analytics'] as const;

export const analyticsKeys = {
  all: () => ana,
  dashboard: () => [...ana, 'dashboard'] as const,
  sales: (f: ReportRange & { groupBy?: string }) => [...ana, 'sales', f] as const,
  consumption: (f: ReportRange & { categoryId?: string; itemId?: string; type?: string }) =>
    [...ana, 'consumption', f] as const,
  waste: (f: ReportRange & { categoryId?: string; groupBy?: string }) =>
    [...ana, 'waste', f] as const,
  performance: (f: ReportRange) => [...ana, 'performance', f] as const,
  pnl: (f: ReportRange) => [...ana, 'pnl', f] as const,
  priceHistory: (f: ReportRange & { itemId?: string; vendorId?: string }) =>
    [...ana, 'price-history', f] as const,
  outlets: () => [...ana, 'outlets'] as const,
};
