import type { DashboardResponse } from './types';

/**
 * The screens were written against a flat shape before the endpoint existed.
 * The endpoint nests its tiles under `tiles` and its chart data under `series`.
 * This maps one onto the other in one place, rather than threading the server's
 * nesting through every tile component.
 *
 * ponytail: delete this and flatten the DTO on the server if the shape settles.
 * It exists because two lanes agreed a contract in prose and one of them was
 * guessing.
 */
interface ApiDashboard {
  variant?: string;
  businessDate?: string;
  tiles?: Record<string, Record<string, unknown>>;
  series?: { netSalesLast14Days?: Array<{ businessDate: string; netSales: string }> };
}

const VARIANTS: Record<string, 'OWNER' | 'MANAGER' | 'STAFF'> = {
  owner: 'OWNER',
  outlet: 'MANAGER',
  functional: 'STAFF',
};

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** `{ "BM-SAHEED": 5 }` on the wire, `[{ outletCode, count }]` on the screen. */
function byOutletCounts(v: unknown): Array<{ outletCode: string; count: number }> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  return Object.entries(v as Record<string, number>).map(([outletCode, count]) => ({
    outletCode,
    count,
  }));
}

export function adaptDashboard(raw: unknown): DashboardResponse {
  const api = (raw ?? {}) as ApiDashboard;
  const t = api.tiles ?? {};
  const out: DashboardResponse = {
    businessDate: api.businessDate,
    variant: api.variant ? VARIANTS[api.variant] : undefined,
  };

  const today = t['netSalesToday'];
  if (today) {
    out.netSalesToday = {
      total: str(today['combined']) ?? str(today['netSales']) ?? '0.00',
      byOutlet: Array.isArray(today['byOutlet'])
        ? (today['byOutlet'] as DashboardResponse['netSalesToday'] extends undefined
            ? never
            : NonNullable<DashboardResponse['netSalesToday']>['byOutlet'])
        : undefined,
      changePctVsSameDayLastWeek: num(today['sameDayLastWeekChangePct']) ?? null,
    };
  }

  const mtd = t['netSalesMtd'];
  if (mtd) {
    out.netSalesMtd = {
      total: str(mtd['combined']) ?? '0.00',
      changePctVsLastMonth: num(mtd['changePctVsLastMonth']) ?? null,
      daysEntered: num(mtd['daysEntered']),
      daysExpected: num(mtd['daysExpected']),
    };
  }

  const missing = t['missingEntries'];
  if (missing) {
    out.missingSalesEntries = {
      count: num(missing['count']) ?? 0,
      entries: Array.isArray(missing['entries'])
        ? (missing['entries'] as NonNullable<DashboardResponse['missingSalesEntries']>['entries'])
        : undefined,
    };
  }

  const margin = t['grossMarginApprox'];
  if (margin) {
    out.grossMargin = {
      netSales: str(margin['netSales']) ?? '0.00',
      purchaseCost: str(margin['purchaseCost']) ?? '0.00',
      grossMarginApprox: str(margin['grossMarginApprox']) ?? '0.00',
      grossMarginPct: num(margin['grossMarginPct']) ?? null,
      caveat: str(margin['caveat']),
    };
  }

  const lowStock = t['lowStock'];
  if (lowStock) out.lowStock = { count: num(lowStock['count']) ?? 0 };

  const overdue = t['overdueTasks'];
  if (overdue) {
    out.overdueTasks = {
      count: num(overdue['count']) ?? 0,
      byOutlet: byOutletCounts(overdue['byOutlet']),
    };
  }

  const openTasks = t['openTasks'];
  if (openTasks) out.openTasks = { count: num(openTasks['count']) ?? 0 };

  const checklists = t['checklistsDueToday'];
  if (checklists) out.checklistsDueToday = { count: num(checklists['count']) ?? 0 };

  const wastage = t['wastageValueMtd'];
  if (wastage) out.wastage = { value: str(wastage['value']) ?? '0.00' };

  const approvals = t['pendingApprovals'];
  if (approvals) {
    out.pendingApprovals = {
      purchaseRequests: num(approvals['purchaseRequests']) ?? 0,
      leaveRequests: num(approvals['leaveRequests']) ?? 0,
    };
  }

  const entry = t['todaysSalesEntry'];
  if (entry) {
    out.todaysSalesEntry = {
      entered: entry['entered'] === true,
      netSales: str(entry['netSales']) ?? null,
      entryId: str(entry['entryId']) ?? null,
      outletId: str(entry['outletId']) ?? null,
    };
  }

  const series = api.series?.netSalesLast14Days;
  if (Array.isArray(series)) out.salesSeries = series;

  return out;
}
