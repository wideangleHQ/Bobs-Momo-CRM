// Response shapes for /analytics/* and the sales report family, chapter 31.
// Money and quantity arrive as decimal strings and stay strings until they are
// formatted. Every dashboard section is optional because the server chooses the
// tile set from the caller's role, so a screen renders what it was sent.

export type Decimal = string;

export interface OutletRef {
  outletId: string;
  outletCode: string;
}

export interface DashboardOutletSales extends OutletRef {
  netSales: Decimal;
}

export interface DashboardResponse {
  variant?: 'OWNER' | 'MANAGER' | 'STAFF';
  businessDate?: string;
  netSalesToday?: {
    total: Decimal;
    byOutlet?: DashboardOutletSales[];
    changePctVsSameDayLastWeek?: number | null;
  };
  netSalesMtd?: {
    total: Decimal;
    changePctVsLastMonth?: number | null;
    daysEntered?: number;
    daysExpected?: number;
  };
  missingSalesEntries?: {
    count: number;
    entries?: Array<OutletRef & { businessDate: string }>;
  };
  grossMargin?: {
    netSales: Decimal;
    purchaseCost: Decimal;
    grossMarginApprox: Decimal;
    grossMarginPct?: number | null;
    caveat?: string;
    caveats?: string[];
  };
  lowStock?: {
    count: number;
    items?: Array<{
      itemId: string;
      itemName: string;
      outletCode?: string;
      qtyOnHand: Decimal;
      reorderLevel: Decimal;
      unitCode: string;
    }>;
  };
  overdueTasks?: { count: number; byOutlet?: Array<{ outletCode: string; count: number }> };
  openTasks?: { count: number };
  checklistsDueToday?: { count: number };
  failedAuditItems?: { count: number };
  wastage?: {
    value: Decimal;
    topItems?: Array<{
      itemId: string;
      itemName: string;
      quantity: Decimal;
      unitCode: string;
      approxValue: Decimal;
    }>;
  };
  pendingApprovals?: { purchaseRequests: number; leaveRequests: number };
  attendance?: {
    byOutlet?: Array<{ outletCode: string; present: number; expected: number }>;
  };
  todaysSalesEntry?: {
    entered: boolean;
    entryId?: string | null;
    netSales?: Decimal | null;
    outletId?: string | null;
  };
  salesSeries?: Array<{ businessDate: string; netSales: Decimal }>;
  errors?: string[];
}

export interface SalesReportRow {
  businessDate: string;
  outletId?: string;
  outletCode?: string;
  netSales: Decimal;
  grossSales: Decimal;
  discounts: Decimal;
  orderCount: number | null;
  avgOrderValue: Decimal | null;
  paymentMix?: { cash: Decimal; upi: Decimal; card: Decimal; other: Decimal };
  prevDayNet: Decimal | null;
  prevDayChangePct: number | null;
  sameDayLastWeekNet: Decimal | null;
  sameDayLastWeekChangePct: number | null;
}

export interface SalesReportResponse {
  range: { from: string; to: string };
  rows: SalesReportRow[];
  missingDates: string[];
}

export interface ConsumptionRow {
  itemId: string;
  itemName: string;
  sku: string;
  unitCode: string;
  categoryName: string;
  outletId?: string;
  outletCode?: string;
  issuedQty: Decimal;
  wastageQty: Decimal;
  consumedQty: Decimal;
}

export interface ConsumptionSeriesPoint {
  businessDate: string;
  issuedQty: Decimal;
  wastageQty: Decimal;
}

export interface ConsumptionResponse {
  range?: { from: string; to: string };
  rows?: ConsumptionRow[];
  series?: ConsumptionSeriesPoint[];
}

export interface WasteRow {
  itemId?: string;
  sku?: string;
  itemName?: string;
  categoryName?: string;
  unitCode?: string;
  outletCode?: string;
  reason?: string;
  wastageQty: Decimal;
  approxValue: Decimal | null;
  eventCount: number;
  hasUnpricedRows?: boolean;
}

export interface WasteResponse {
  range?: { from: string; to: string };
  rows: WasteRow[];
  totals?: { approxValue: Decimal; unpricedRowCount?: number };
}

export interface PerformanceRow {
  id: string;
  employeeCode: string;
  fullName: string;
  outletCode?: string;
  tasksAssigned: number;
  tasksCompleted: number;
  completionRate: number | null;
  onTimeRate: number | null;
  avgDelayMins: number | null;
  attendanceConsistency: number | null;
  lateCount: number;
}

export interface PerformanceResponse {
  range?: { from: string; to: string };
  rows: PerformanceRow[];
}

export interface PnlRow {
  id: string;
  code: string;
  netSales: Decimal;
  purchaseCost: Decimal;
  grossMarginApprox: Decimal;
  grossMarginPct: number | null;
  wastageValue: Decimal;
  daysWithEntry: number;
  daysInRange?: number;
}

export interface PnlResponse {
  range?: { from: string; to: string };
  rows: PnlRow[];
  // The API sends the approximation warning. The screen must show it, so it is
  // never inferred locally when the server omits it.
  caveat?: string;
  caveats?: string[];
}

export interface PriceHistoryRow {
  id: string;
  observedOn: string;
  itemId: string;
  itemName: string;
  unitCode: string;
  vendor: { id: string; name: string } | null;
  unitPrice: Decimal;
  purchaseId?: string;
  purchaseNo?: string;
  purchaseVoided?: boolean;
}

export interface PriceHistoryResponse {
  data: PriceHistoryRow[];
  meta: { page: number; pageSize: number; total: number };
}

export interface OutletOption {
  id: string;
  code: string;
  name?: string;
}
