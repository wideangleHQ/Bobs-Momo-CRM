import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type TaskStatus } from '@prisma/client';
import {
  ANALYTICS_ERRORS,
  EXPORT_ROW_CAP,
  GROSS_MARGIN_CAVEAT,
  GROSS_MARGIN_EXCLUDES,
  MAX_SPAN_DAYS,
  toBusinessDate,
  type ConsumptionQuery,
  type ExportQuery,
  type ReportQuery,
  type SalesReportQuery,
  type WasteQuery,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { lowStockWhere } from '../inventory/inventory.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';

const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

const DAY_MS = 86_400_000;
const ZERO = new Decimal(0);

// Consumption is what left the shelf: issued into the kitchen plus thrown away.
// ADJUSTMENT, TRANSFER_OUT and CLOSING are excluded on purpose. An adjustment
// corrects the count and a transfer moves stock rather than consuming it.
const CONSUMPTION_TYPES = ['ISSUED', 'WASTAGE'] as const;

export const CONSUMPTION_TOP_N = 20;
const DASHBOARD_TTL_SECONDS = 60;
const DASHBOARD_SERIES_DAYS = 14;

// "Late" is a business judgement the client will move after a fortnight of real
// data. It sits here until there is somewhere better than a magic number.
const LATE_THRESHOLD_MINS = 10;

const COMPLETED_STATUSES: TaskStatus[] = ['COMPLETED', 'VERIFIED'];

export type DashboardVariant = 'owner' | 'outlet' | 'functional';

interface PricedWasteGroup {
  itemId: string;
  outletId: string;
  reason: string | null;
  businessDate: string;
  quantity: Decimal;
  eventCount: number;
  unitPrice: Decimal | null;
  value: Decimal;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---- 1. daily sales summary -------------------------------------------

  async sales(query: SalesReportQuery, scope: RequestScope) {
    assertSpan(query.from, query.to, MAX_SPAN_DAYS.sales);

    // Seven days further back than asked for, then trimmed. Without it the
    // first day of every window shows two empty comparison columns for no
    // reason the reader can see.
    const lookbackFrom = shiftDate(query.from, -7);
    const rows = await this.prisma.dailySalesEntry.findMany({
      where: {
        outletId: { in: scope.outletIds },
        businessDate: { gte: dayUtc(lookbackFrom), lte: dayUtc(query.to) },
      },
      include: { outlet: { select: { code: true } } },
    });

    const combined = query.groupBy === 'combined';
    const buckets = new Map<string, SalesBucket>();
    for (const row of rows) {
      const date = isoDate(row.businessDate);
      const key = combined ? date : `${row.outletId}|${date}`;
      const bucket =
        buckets.get(key) ??
        emptyBucket(date, combined ? null : row.outletId, combined ? null : row.outlet.code);
      bucket.grossSales = bucket.grossSales.plus(row.grossSales);
      bucket.discounts = bucket.discounts.plus(row.discounts);
      bucket.netSales = bucket.netSales.plus(row.netSales);
      bucket.cash = bucket.cash.plus(row.cashAmount);
      bucket.upi = bucket.upi.plus(row.upiAmount);
      bucket.card = bucket.card.plus(row.cardAmount);
      bucket.other = bucket.other.plus(row.otherAmount);
      if (row.orderCount !== null) bucket.orderCount = (bucket.orderCount ?? 0) + row.orderCount;
      bucket.entryCount += 1;
      buckets.set(key, bucket);
    }

    const netAt = (outletId: string | null, date: string): Decimal | null =>
      buckets.get(combined ? date : `${outletId ?? ''}|${date}`)?.netSales ?? null;

    const out = [...buckets.values()]
      .filter((b) => b.businessDate >= query.from && b.businessDate <= query.to)
      .sort(
        (a, b) =>
          b.businessDate.localeCompare(a.businessDate) ||
          (a.outletCode ?? '').localeCompare(b.outletCode ?? ''),
      )
      .map((b) => {
        const prev = netAt(b.outletId, shiftDate(b.businessDate, -1));
        const lastWeek = netAt(b.outletId, shiftDate(b.businessDate, -7));
        return {
          businessDate: b.businessDate,
          outletId: b.outletId,
          outletCode: b.outletCode,
          grossSales: b.grossSales.toFixed(2),
          discounts: b.discounts.toFixed(2),
          netSales: b.netSales.toFixed(2),
          orderCount: b.orderCount,
          // Never an average of averages: combined divides combined net by
          // combined orders.
          avgOrderValue:
            b.orderCount && b.orderCount > 0
              ? b.netSales.dividedBy(b.orderCount).toDecimalPlaces(2).toFixed(2)
              : null,
          paymentMix: {
            cash: b.cash.toFixed(2),
            upi: b.upi.toFixed(2),
            card: b.card.toFixed(2),
            other: b.other.toFixed(2),
          },
          prevDayNet: prev?.toFixed(2) ?? null,
          prevDayChangePct: changePct(b.netSales, prev),
          sameDayLastWeekNet: lastWeek?.toFixed(2) ?? null,
          sameDayLastWeekChangePct: changePct(b.netSales, lastWeek),
        };
      });

    // A missing day is reported once at the top rather than as a row of zeros,
    // so the screen can say "three entries missing" instead of drawing a cliff.
    const entered = new Set(
      rows.map((r) => `${r.outletId}|${isoDate(r.businessDate)}`),
    );
    const missingDates = eachDate(query.from, query.to).filter((date) =>
      scope.outletIds.some((outletId) => !entered.has(`${outletId}|${date}`)),
    );

    return { range: { from: query.from, to: query.to }, groupBy: query.groupBy, rows: out, missingDates };
  }

  // ---- 2. inventory consumption -----------------------------------------

  /**
   * `limit` is the screen's concern, not the data's. The CSV export used to
   * reuse the screen's top-20 cut, so an owner exporting a month to reconcile
   * against purchases got exactly twenty rows with nothing saying the rest had
   * been dropped, and every reconciliation off that file was wrong.
   */
  async consumption(query: ConsumptionQuery, scope: RequestScope, limit?: number) {
    assertSpan(query.from, query.to, MAX_SPAN_DAYS.consumption);

    const types = query.type === 'ALL' ? [...CONSUMPTION_TYPES] : [query.type];
    const where: Prisma.StockTransactionWhereInput = {
      type: { in: types },
      businessDate: { gte: dayUtc(query.from), lte: dayUtc(query.to) },
      outletId: { in: scope.outletIds },
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.categoryId ? { item: { categoryId: query.categoryId } } : {}),
    };

    if (query.itemId) return this.consumptionSeries(query, where);

    const grouped = await this.prisma.stockTransaction.groupBy({
      by: ['itemId', 'outletId', 'type'],
      where,
      _sum: { quantity: true },
    });

    const [items, outlets] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { id: { in: [...new Set(grouped.map((g) => g.itemId))] } },
        select: {
          id: true,
          sku: true,
          name: true,
          category: { select: { name: true } },
          unit: { select: { code: true } },
        },
      }),
      this.outletCodes(scope.outletIds),
    ]);
    const byItem = new Map(items.map((i) => [i.id, i]));

    const rows = new Map<
      string,
      {
        itemId: string;
        sku: string;
        itemName: string;
        categoryName: string;
        unitCode: string;
        outletId: string;
        outletCode: string;
        issued: Decimal;
        wastage: Decimal;
      }
    >();
    for (const g of grouped) {
      const item = byItem.get(g.itemId);
      if (!item) continue;
      const key = `${g.itemId}|${g.outletId}`;
      const row = rows.get(key) ?? {
        itemId: g.itemId,
        sku: item.sku,
        itemName: item.name,
        categoryName: item.category.name,
        unitCode: item.unit.code,
        outletId: g.outletId,
        outletCode: outlets.get(g.outletId) ?? '',
        issued: ZERO,
        wastage: ZERO,
      };
      const qty = g._sum.quantity ?? ZERO;
      if (g.type === 'WASTAGE') row.wastage = row.wastage.plus(qty);
      else row.issued = row.issued.plus(qty);
      rows.set(key, row);
    }

    const all = [...rows.values()].map((r) => ({
      itemId: r.itemId,
      sku: r.sku,
      itemName: r.itemName,
      categoryName: r.categoryName,
      unitCode: r.unitCode,
      outletId: r.outletId,
      outletCode: r.outletCode,
      issuedQty: r.issued,
      wastageQty: r.wastage,
      consumedQty: r.issued.plus(r.wastage),
    }));
    all.sort((a, b) => b.consumedQty.comparedTo(a.consumedQty));

    // unitCode stays in the rollup key. Adding 40 kilograms of cabbage to 600
    // pieces of packaging produces 640, which means nothing.
    const categories = new Map<string, { categoryName: string; unitCode: string; qty: Decimal }>();
    for (const r of all) {
      const key = `${r.categoryName}|${r.unitCode}`;
      const bucket = categories.get(key) ?? {
        categoryName: r.categoryName,
        unitCode: r.unitCode,
        qty: ZERO,
      };
      bucket.qty = bucket.qty.plus(r.consumedQty);
      categories.set(key, bucket);
    }

    return {
      range: { from: query.from, to: query.to },
      type: query.type,
      rows: (limit === undefined ? all : all.slice(0, limit)).map((r) => ({
        ...r,
        issuedQty: r.issuedQty.toFixed(3),
        wastageQty: r.wastageQty.toFixed(3),
        consumedQty: r.consumedQty.toFixed(3),
      })),
      byCategory: [...categories.values()]
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.unitCode.localeCompare(b.unitCode))
        .map((c) => ({
          categoryName: c.categoryName,
          unitCode: c.unitCode,
          consumedQty: c.qty.toFixed(3),
        })),
    };
  }

  private async consumptionSeries(query: ConsumptionQuery, where: Prisma.StockTransactionWhereInput) {
    const grouped = await this.prisma.stockTransaction.groupBy({
      by: ['businessDate', 'type'],
      where,
      _sum: { quantity: true },
    });

    const days = new Map<string, { issued: Decimal; wastage: Decimal }>();
    for (const g of grouped) {
      const date = isoDate(g.businessDate);
      const day = days.get(date) ?? { issued: ZERO, wastage: ZERO };
      const qty = g._sum.quantity ?? ZERO;
      if (g.type === 'WASTAGE') day.wastage = day.wastage.plus(qty);
      else day.issued = day.issued.plus(qty);
      days.set(date, day);
    }

    const series = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([businessDate, d]) => ({
        businessDate,
        issuedQty: d.issued.toFixed(3),
        wastageQty: d.wastage.toFixed(3),
        consumedQty: d.issued.plus(d.wastage).toFixed(3),
      }));

    const totals = [...days.values()].reduce(
      (acc, d) => ({ issued: acc.issued.plus(d.issued), wastage: acc.wastage.plus(d.wastage) }),
      { issued: ZERO, wastage: ZERO },
    );

    return {
      range: { from: query.from, to: query.to },
      type: query.type,
      itemId: query.itemId ?? null,
      series,
      totals: {
        issuedQty: totals.issued.toFixed(3),
        wastageQty: totals.wastage.toFixed(3),
        consumedQty: totals.issued.plus(totals.wastage).toFixed(3),
      },
    };
  }

  // ---- 6. waste analysis -------------------------------------------------

  async waste(query: WasteQuery, scope: RequestScope) {
    assertSpan(query.from, query.to, MAX_SPAN_DAYS.waste);

    const groups = await this.pricedWastage(query.from, query.to, scope.outletIds, {
      itemId: query.itemId,
      categoryId: query.categoryId,
    });

    const [items, outlets] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { id: { in: [...new Set(groups.map((g) => g.itemId))] } },
        select: {
          id: true,
          sku: true,
          name: true,
          category: { select: { name: true } },
          unit: { select: { code: true } },
        },
      }),
      this.outletCodes(scope.outletIds),
    ]);
    const byItem = new Map(items.map((i) => [i.id, i]));

    interface WasteRow {
      sku: string | null;
      itemName: string | null;
      categoryName: string | null;
      unitCode: string | null;
      outletId: string | null;
      outletCode: string | null;
      reason: string | null;
      qty: Decimal;
      value: Decimal;
      eventCount: number;
      hasUnpricedRows: boolean;
    }

    const rows = new Map<string, WasteRow>();
    for (const g of groups) {
      const item = byItem.get(g.itemId);
      if (!item) continue;
      const key =
        query.groupBy === 'reason'
          ? (g.reason ?? '')
          : query.groupBy === 'category'
            ? `${item.category.name}|${item.unit.code}`
            : `${g.itemId}|${g.outletId}|${g.reason ?? ''}`;
      const base: WasteRow = rows.get(key) ?? {
        sku: query.groupBy === 'item' ? item.sku : null,
        itemName: query.groupBy === 'item' ? item.name : null,
        categoryName: query.groupBy === 'reason' ? null : item.category.name,
        unitCode: query.groupBy === 'reason' ? null : item.unit.code,
        outletId: query.groupBy === 'item' ? g.outletId : null,
        outletCode: query.groupBy === 'item' ? (outlets.get(g.outletId) ?? '') : null,
        reason: query.groupBy === 'category' ? null : g.reason,
        qty: ZERO,
        value: ZERO,
        eventCount: 0,
        hasUnpricedRows: false,
      };
      base.qty = base.qty.plus(g.quantity);
      base.value = base.value.plus(g.value);
      base.eventCount += g.eventCount;
      base.hasUnpricedRows = base.hasUnpricedRows || g.unitPrice === null;
      rows.set(key, base);
    }

    const out = [...rows.values()].sort((a, b) => b.value.comparedTo(a.value));
    const totalValue = out.reduce((acc, r) => acc.plus(r.value), ZERO);

    return {
      range: { from: query.from, to: query.to },
      groupBy: query.groupBy,
      // Latest observed purchase price on or before the wastage date, from any
      // vendor. Not FIFO, not an accounting valuation.
      approximation: true,
      rows: out.map((r) => ({
        sku: r.sku,
        itemName: r.itemName,
        categoryName: r.categoryName,
        unitCode: r.unitCode,
        outletId: r.outletId,
        outletCode: r.outletCode,
        reason: r.reason,
        wastageQty: r.qty.toFixed(3),
        approxValue: r.value.toFixed(2),
        eventCount: r.eventCount,
        hasUnpricedRows: r.hasUnpricedRows,
      })),
      totals: {
        approxValue: totalValue.toFixed(2),
        eventCount: out.reduce((acc, r) => acc + r.eventCount, 0),
        unpricedRowCount: groups.filter((g) => g.unitPrice === null).length,
      },
    };
  }

  /**
   * Wastage quantities valued at the most recent price observed on or before
   * the day they were binned. Pricing at today's price would re-price a six
   * month old report every time somebody opened it.
   */
  private async pricedWastage(
    from: string,
    to: string,
    outletIds: string[],
    filters: { itemId?: string | undefined; categoryId?: string | undefined } = {},
  ): Promise<PricedWasteGroup[]> {
    const grouped = await this.prisma.stockTransaction.groupBy({
      by: ['itemId', 'outletId', 'reason', 'businessDate'],
      where: {
        type: 'WASTAGE',
        businessDate: { gte: dayUtc(from), lte: dayUtc(to) },
        outletId: { in: outletIds },
        ...(filters.itemId ? { itemId: filters.itemId } : {}),
        ...(filters.categoryId ? { item: { categoryId: filters.categoryId } } : {}),
      },
      _sum: { quantity: true },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];

    const prices = await this.prisma.itemPriceHistory.findMany({
      where: {
        itemId: { in: [...new Set(grouped.map((g) => g.itemId))] },
        observedOn: { lte: dayUtc(to) },
      },
      select: { itemId: true, unitPrice: true, observedOn: true },
      orderBy: [{ observedOn: 'desc' }, { createdAt: 'desc' }],
    });
    const byItem = new Map<string, Array<{ unitPrice: Decimal; observedOn: string }>>();
    for (const p of prices) {
      const list = byItem.get(p.itemId) ?? [];
      list.push({ unitPrice: p.unitPrice, observedOn: isoDate(p.observedOn) });
      byItem.set(p.itemId, list);
    }

    return grouped.map((g) => {
      const businessDate = isoDate(g.businessDate);
      const quantity = g._sum.quantity ?? ZERO;
      const unitPrice =
        byItem.get(g.itemId)?.find((p) => p.observedOn <= businessDate)?.unitPrice ?? null;
      return {
        itemId: g.itemId,
        outletId: g.outletId,
        reason: g.reason,
        businessDate,
        quantity,
        eventCount: g._count._all,
        unitPrice,
        // An item never purchased through the system contributes zero rather
        // than blocking the report. hasUnpricedRows is what says so.
        value: unitPrice === null ? ZERO : quantity.mul(unitPrice).toDecimalPlaces(2),
      };
    });
  }

  // ---- 3. employee performance ------------------------------------------

  async performance(query: ReportQuery, scope: RequestScope) {
    assertSpan(query.from, query.to, MAX_SPAN_DAYS.performance);
    const range = { gte: dayUtc(query.from), lte: dayUtc(query.to) };

    const [employees, tasks, attendance, outlets] = await Promise.all([
      this.prisma.employee.findMany({
        where: { outletId: { in: scope.outletIds }, status: 'ACTIVE' },
        select: { id: true, employeeCode: true, fullName: true, outletId: true },
      }),
      this.prisma.task.findMany({
        where: {
          assigneeId: { not: null },
          businessDate: range,
          outletId: { in: scope.outletIds },
        },
        select: { assigneeId: true, status: true, dueAt: true, completedAt: true },
      }),
      this.prisma.attendanceDay.findMany({
        where: { businessDate: range, outletId: { in: scope.outletIds } },
        select: { employeeId: true, status: true, lateMins: true },
      }),
      this.outletCodes(scope.outletIds),
    ]);

    interface Stats {
      assigned: number;
      completed: number;
      dueBearing: number;
      onTime: number;
      delayMins: number[];
      expectedDays: number;
      presentDays: number;
      lateCount: number;
    }
    const stats = new Map<string, Stats>();
    const statsFor = (id: string): Stats => {
      const found = stats.get(id) ?? {
        assigned: 0,
        completed: 0,
        dueBearing: 0,
        onTime: 0,
        delayMins: [],
        expectedDays: 0,
        presentDays: 0,
        lateCount: 0,
      };
      stats.set(id, found);
      return found;
    };

    for (const task of tasks) {
      if (task.assigneeId === null) continue;
      const s = statsFor(task.assigneeId);
      // CANCELLED leaves both sides of the rate. A manager tidying their own
      // backlog must not push a staff member's score down.
      if (task.status === 'CANCELLED') continue;
      s.assigned += 1;
      if (!COMPLETED_STATUSES.includes(task.status)) continue;
      s.completed += 1;
      if (task.dueAt === null) continue;
      s.dueBearing += 1;
      if (task.completedAt === null) continue;
      if (task.completedAt <= task.dueAt) s.onTime += 1;
      else s.delayMins.push((task.completedAt.getTime() - task.dueAt.getTime()) / 60_000);
    }

    for (const day of attendance) {
      const s = statsFor(day.employeeId);
      if (day.lateMins > LATE_THRESHOLD_MINS) s.lateCount += 1;
      // Approved leave and weekly offs leave the denominator, so time off never
      // lowers the score.
      if (day.status === 'WEEKLY_OFF' || day.status === 'ON_LEAVE') continue;
      s.expectedDays += 1;
      if (day.status === 'PRESENT') s.presentDays += 1;
      else if (day.status === 'HALF_DAY') s.presentDays += 0.5;
    }

    const rows = employees
      .map((e) => {
        const s = stats.get(e.id);
        const completionRate = s && s.assigned > 0 ? s.completed / s.assigned : null;
        return {
          employeeId: e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          outletCode: outlets.get(e.outletId) ?? '',
          tasksAssigned: s?.assigned ?? 0,
          tasksCompleted: s?.completed ?? 0,
          completionRate: rate(completionRate),
          onTimeRate: rate(s && s.dueBearing > 0 ? s.onTime / s.dueBearing : null),
          avgDelayMins:
            s && s.delayMins.length > 0
              ? (s.delayMins.reduce((a, b) => a + b, 0) / s.delayMins.length).toFixed(1)
              : null,
          attendanceConsistency: rate(
            s && s.expectedDays > 0 ? s.presentDays / s.expectedDays : null,
          ),
          lateCount: s?.lateCount ?? 0,
          sortKey: completionRate,
        };
      })
      // An employee with no assigned tasks gets null rates, not zero, and sorts
      // last rather than bottom.
      .sort((a, b) => (b.sortKey ?? -1) - (a.sortKey ?? -1))
      .map(({ sortKey: _sortKey, ...row }) => row);

    return { range: { from: query.from, to: query.to }, lateThresholdMins: LATE_THRESHOLD_MINS, rows };
  }

  // ---- 5. gross margin approximation ------------------------------------

  async grossMargin(query: ReportQuery, scope: RequestScope) {
    assertSpan(query.from, query.to, MAX_SPAN_DAYS['gross-margin']);
    const range = { gte: dayUtc(query.from), lte: dayUtc(query.to) };

    const [sales, purchases, wastage, outlets] = await Promise.all([
      this.prisma.dailySalesEntry.groupBy({
        by: ['outletId'],
        where: { businessDate: range, outletId: { in: scope.outletIds } },
        _sum: { netSales: true },
        _count: { _all: true },
      }),
      this.prisma.purchase.groupBy({
        by: ['outletId'],
        // Voided and draft purchases are not cost.
        where: { status: 'RECORDED', purchaseDate: range, outletId: { in: scope.outletIds } },
        _sum: { totalAmount: true },
      }),
      this.pricedWastage(query.from, query.to, scope.outletIds),
      this.prisma.outlet.findMany({
        where: { id: { in: scope.outletIds } },
        select: { id: true, code: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    const netByOutlet = new Map(sales.map((s) => [s.outletId, s._sum.netSales ?? ZERO]));
    const daysByOutlet = new Map(sales.map((s) => [s.outletId, s._count._all]));
    const costByOutlet = new Map(purchases.map((p) => [p.outletId, p._sum.totalAmount ?? ZERO]));
    const wasteByOutlet = new Map<string, Decimal>();
    for (const g of wastage) {
      wasteByOutlet.set(g.outletId, (wasteByOutlet.get(g.outletId) ?? ZERO).plus(g.value));
    }

    const rows = outlets.map((o) => {
      const netSales = netByOutlet.get(o.id) ?? ZERO;
      const purchaseCost = costByOutlet.get(o.id) ?? ZERO;
      const margin = netSales.minus(purchaseCost);
      return {
        outletId: o.id,
        outletCode: o.code,
        netSales: netSales.toFixed(2),
        purchaseCost: purchaseCost.toFixed(2),
        grossMarginApprox: margin.toFixed(2),
        grossMarginPct: netSales.isZero()
          ? null
          : margin.dividedBy(netSales).toDecimalPlaces(4).toFixed(4),
        wastageValue: (wasteByOutlet.get(o.id) ?? ZERO).toFixed(2),
        daysWithEntry: daysByOutlet.get(o.id) ?? 0,
        expectedDays: eachDate(query.from, query.to).length,
      };
    });

    const totalNet = rows.reduce((acc, r) => acc.plus(r.netSales), ZERO);
    const totalCost = rows.reduce((acc, r) => acc.plus(r.purchaseCost), ZERO);

    // Every response says so, in the body, next to the number. The screen puts
    // it in the page header rather than a footnote.
    return {
      approximation: true,
      caveat: GROSS_MARGIN_CAVEAT,
      excludes: [...GROSS_MARGIN_EXCLUDES],
      range: { from: query.from, to: query.to },
      rows,
      totals: {
        netSales: totalNet.toFixed(2),
        purchaseCost: totalCost.toFixed(2),
        grossMarginApprox: totalNet.minus(totalCost).toFixed(2),
        grossMarginPct: totalNet.isZero()
          ? null
          : totalNet.minus(totalCost).dividedBy(totalNet).toDecimalPlaces(4).toFixed(4),
      },
    };
  }

  // ---- the dashboard -----------------------------------------------------

  async dashboard(user: AuthedUser, scope: RequestScope) {
    const businessDate = toBusinessDate();
    const variant = variantFor(user.roleKey);
    const outletHash = createHash('sha1').update([...scope.outletIds].sort().join(',')).digest('hex').slice(0, 12);
    const cacheKey = `analytics:dash:${variant}:${outletHash}:${businessDate}`;

    const cached = await this.redis.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const payload =
      variant === 'owner'
        ? await this.ownerDashboard(businessDate, scope)
        : variant === 'outlet'
          ? await this.outletDashboard(businessDate, scope)
          : await this.functionalDashboard(businessDate, scope);

    // Nothing invalidates this. A tile can be 60 seconds stale, and write
    // through invalidation for nine tiles buys less than it costs.
    await this.redis.set(cacheKey, payload, DASHBOARD_TTL_SECONDS);
    return payload;
  }

  private async ownerDashboard(businessDate: string, scope: RequestScope) {
    const monthStart = `${businessDate.slice(0, 7)}-01`;
    const lastMonth = previousMonthRange(businessDate);
    const seriesFrom = shiftDate(businessDate, -(DASHBOARD_SERIES_DAYS - 1));

    const [today, mtd, lastMonthNet, series, missing, purchases, wastage, stock, tasks, approvals, game] =
      await Promise.all([
        this.salesTotals(businessDate, businessDate, scope.outletIds),
        this.salesTotals(monthStart, businessDate, scope.outletIds),
        this.salesTotals(lastMonth.from, lastMonth.to, scope.outletIds),
        this.netSalesSeries(seriesFrom, businessDate, scope.outletIds),
        this.missingEntries(shiftDate(businessDate, -6), businessDate, scope.outletIds),
        this.prisma.purchase.aggregate({
          where: {
            status: 'RECORDED',
            purchaseDate: { gte: dayUtc(monthStart), lte: dayUtc(businessDate) },
            outletId: { in: scope.outletIds },
          },
          _sum: { totalAmount: true },
        }),
        this.pricedWastage(monthStart, businessDate, scope.outletIds),
        this.lowStock(scope.outletIds),
        this.taskCounts(scope.outletIds),
        this.pendingApprovals(scope.outletIds),
        this.gameActivity(shiftDate(businessDate, -6), businessDate),
      ]);

    const purchaseCost = purchases._sum.totalAmount ?? ZERO;
    const wastageValue = wastage.reduce((acc, g) => acc.plus(g.value), ZERO);
    const lastWeekSameDay = await this.salesTotals(
      shiftDate(businessDate, -7),
      shiftDate(businessDate, -7),
      scope.outletIds,
    );

    return {
      variant: 'owner' as const,
      businessDate,
      tiles: {
        netSalesToday: {
          combined: today.netSales.toFixed(2),
          byOutlet: today.byOutlet,
          sameDayLastWeekChangePct: changePct(today.netSales, lastWeekSameDay.netSales),
        },
        netSalesMtd: {
          combined: mtd.netSales.toFixed(2),
          changePctVsLastMonth: changePct(mtd.netSales, lastMonthNet.netSales),
          daysEntered: mtd.entryCount,
          daysExpected: eachDate(monthStart, businessDate).length * scope.outletIds.length,
        },
        missingEntries: { count: missing.length, entries: missing },
        grossMarginApprox: {
          approximation: true,
          caveat: GROSS_MARGIN_CAVEAT,
          netSales: mtd.netSales.toFixed(2),
          purchaseCost: purchaseCost.toFixed(2),
          grossMarginApprox: mtd.netSales.minus(purchaseCost).toFixed(2),
          grossMarginPct: mtd.netSales.isZero()
            ? null
            : mtd.netSales.minus(purchaseCost).dividedBy(mtd.netSales).toDecimalPlaces(4).toFixed(4),
        },
        lowStock: stock,
        overdueTasks: { count: tasks.overdue, byOutlet: tasks.overdueByOutlet },
        wastageValueMtd: { approximation: true, value: wastageValue.toFixed(2) },
        pendingApprovals: approvals,
        gameActivity: game,
      },
      series: { netSalesLast14Days: series },
    };
  }

  private async outletDashboard(businessDate: string, scope: RequestScope) {
    const weekStart = shiftDate(businessDate, -6);
    const [today, tasks, checklists, attendance, stock, leave, failures, wastage] = await Promise.all([
      this.salesTotals(businessDate, businessDate, scope.outletIds),
      this.taskCounts(scope.outletIds),
      this.prisma.task.count({
        where: {
          kind: 'CHECKLIST_RUN',
          businessDate: dayUtc(businessDate),
          outletId: { in: scope.outletIds },
          status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] },
        },
      }),
      this.prisma.attendanceDay.groupBy({
        by: ['status'],
        where: { businessDate: dayUtc(businessDate), outletId: { in: scope.outletIds } },
        _count: { _all: true },
      }),
      this.lowStock(scope.outletIds),
      this.prisma.leaveRequest.count({
        where: { status: 'PENDING', employee: { outletId: { in: scope.outletIds } } },
      }),
      this.prisma.taskChecklistResult.count({
        where: {
          result: 'FAIL',
          task: { outletId: { in: scope.outletIds }, businessDate: { gte: dayUtc(weekStart) } },
        },
      }),
      this.pricedWastage(weekStart, businessDate, scope.outletIds),
    ]);

    return {
      variant: 'outlet' as const,
      businessDate,
      tiles: {
        todaysSalesEntry: {
          entered: today.entryCount > 0,
          netSales: today.entryCount > 0 ? today.netSales.toFixed(2) : null,
          byOutlet: today.byOutlet,
        },
        tasks: { open: tasks.open, inProgress: tasks.inProgress, overdue: tasks.overdue },
        checklistsDueToday: { count: checklists },
        whoIsIn: Object.fromEntries(attendance.map((a) => [a.status, a._count._all])),
        lowStock: stock,
        pendingLeave: { count: leave },
        failedAuditItems: { count: failures, windowDays: 7 },
        wastageThisWeek: {
          approximation: true,
          value: wastage.reduce((acc, g) => acc.plus(g.value), ZERO).toFixed(2),
          eventCount: wastage.reduce((acc, g) => acc + g.eventCount, 0),
        },
      },
    };
  }

  /**
   * Kitchen, inventory and purchase managers run one function across the
   * outlets they hold. They get the operational tiles and no money field at
   * all, which is the same rule the staff home follows in chapter 31.
   */
  private async functionalDashboard(businessDate: string, scope: RequestScope) {
    const weekStart = shiftDate(businessDate, -6);
    const [stock, tasks, wastage, approvals] = await Promise.all([
      this.lowStock(scope.outletIds),
      this.taskCounts(scope.outletIds),
      this.prisma.stockTransaction.aggregate({
        where: {
          type: 'WASTAGE',
          businessDate: { gte: dayUtc(weekStart), lte: dayUtc(businessDate) },
          outletId: { in: scope.outletIds },
        },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      this.pendingApprovals(scope.outletIds),
    ]);

    return {
      variant: 'functional' as const,
      businessDate,
      tiles: {
        lowStock: stock,
        openTasks: { open: tasks.open, inProgress: tasks.inProgress, overdue: tasks.overdue },
        wastageThisWeek: {
          quantity: (wastage._sum.quantity ?? ZERO).toFixed(3),
          eventCount: wastage._count._all,
        },
        pendingApprovals: { purchaseRequests: approvals.purchaseRequests },
      },
    };
  }

  // ---- export ------------------------------------------------------------

  async exportCsv(query: ExportQuery, user: AuthedUser, scope: RequestScope) {
    // The report runs through the same service method the GET endpoint uses,
    // with the same guard derived outlet array. There is no path where the
    // export builds its own outlet list, which is what stops a CSV becoming
    // the leak the API is careful not to be.
    const { headers, rows } = await this.exportRows(query, scope);
    if (rows.length > EXPORT_ROW_CAP) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ANALYTICS_ERRORS.EXPORT_TOO_LARGE,
        'That export is too large. Narrow the date range.',
        { rowCount: rows.length, maxRows: EXPORT_ROW_CAP },
      );
    }

    const outlets = await this.outletCodes(scope.outletIds);
    const label =
      query.outletId && outlets.has(query.outletId)
        ? (outlets.get(query.outletId) ?? 'ALL')
        : scope.outletIds.length === 1
          ? ([...outlets.values()][0] ?? 'ALL')
          : 'ALL';

    // Exports are how data leaves the building.
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        actorLabel: user.sub,
        action: 'analytics.export.create',
        entityType: 'AnalyticsExport',
        outletId: scope.outletIds.length === 1 ? (scope.outletIds[0] ?? null) : null,
        after: {
          report: query.report,
          from: query.from,
          to: query.to,
          outletIds: scope.outletIds,
          rowCount: rows.length,
        },
      },
    });

    return {
      filename: `bobsmomo_${query.report}_${label}_${query.from}_${query.to}.csv`,
      // A byte order mark, so Excel on Windows opens Odia and Hindi names
      // correctly instead of as mojibake.
      csv: `\uFEFF${toCsv(headers, rows)}`,
    };
  }

  private async exportRows(
    query: ExportQuery,
    scope: RequestScope,
  ): Promise<{ headers: string[]; rows: CsvCell[][] }> {
    const base = { from: query.from, to: query.to, outletId: query.outletId };

    switch (query.report) {
      case 'sales': {
        const report = await this.sales(
          { ...base, groupBy: query.groupBy === 'combined' ? 'combined' : 'outlet' },
          scope,
        );
        return {
          headers: [
            'business_date', 'outlet_code', 'gross_sales', 'discounts', 'net_sales',
            'order_count', 'avg_order_value', 'cash', 'upi', 'card', 'other',
          ],
          rows: report.rows.map((r) => [
            r.businessDate, r.outletCode ?? 'ALL', money(r.grossSales), money(r.discounts),
            money(r.netSales), r.orderCount, money(r.avgOrderValue), money(r.paymentMix.cash),
            money(r.paymentMix.upi), money(r.paymentMix.card), money(r.paymentMix.other),
          ]),
        };
      }
      case 'consumption': {
        const report = await this.consumption(
          { ...base, type: 'ALL', categoryId: query.categoryId },
          scope,
        );
        const rows = 'rows' in report ? report.rows : [];
        return {
          headers: [
            'sku', 'item_name', 'category_name', 'unit_code', 'outlet_code',
            'issued_qty', 'wastage_qty', 'consumed_qty',
          ],
          rows: rows.map((r) => [
            r.sku, r.itemName, r.categoryName, r.unitCode, r.outletCode,
            r.issuedQty, r.wastageQty, r.consumedQty,
          ]),
        };
      }
      case 'waste': {
        const groupBy =
          query.groupBy === 'category' || query.groupBy === 'reason' ? query.groupBy : 'item';
        const report = await this.waste(
          { ...base, groupBy, categoryId: query.categoryId, itemId: query.itemId },
          scope,
        );
        return {
          headers: [
            'sku', 'item_name', 'category_name', 'unit_code', 'outlet_code', 'reason',
            'wastage_qty', 'approx_value', 'event_count',
          ],
          rows: report.rows.map((r) => [
            r.sku, r.itemName, r.categoryName, r.unitCode, r.outletCode, r.reason,
            r.wastageQty, money(r.approxValue), r.eventCount,
          ]),
        };
      }
      case 'performance': {
        const report = await this.performance(base, scope);
        return {
          headers: [
            'employee_code', 'full_name', 'outlet_code', 'tasks_assigned', 'tasks_completed',
            'completion_rate', 'on_time_rate', 'avg_delay_mins', 'attendance_consistency',
            'late_count',
          ],
          rows: report.rows.map((r) => [
            r.employeeCode, r.fullName, r.outletCode, r.tasksAssigned, r.tasksCompleted,
            r.completionRate, r.onTimeRate, r.avgDelayMins, r.attendanceConsistency, r.lateCount,
          ]),
        };
      }
      case 'gross-margin': {
        const report = await this.grossMargin(base, scope);
        return {
          headers: [
            'outlet_code', 'from', 'to', 'net_sales', 'purchase_cost', 'gross_margin_approx',
            'gross_margin_pct', 'wastage_value', 'days_with_entry',
          ],
          rows: report.rows.map((r) => [
            r.outletCode, query.from, query.to, money(r.netSales), money(r.purchaseCost),
            money(r.grossMarginApprox), r.grossMarginPct, money(r.wastageValue), r.daysWithEntry,
          ]),
        };
      }
    }
  }

  // ---- shared tile queries ----------------------------------------------

  private async salesTotals(from: string, to: string, outletIds: string[]) {
    const rows = await this.prisma.dailySalesEntry.findMany({
      where: {
        businessDate: { gte: dayUtc(from), lte: dayUtc(to) },
        outletId: { in: outletIds },
      },
      select: { outletId: true, netSales: true, outlet: { select: { code: true } } },
    });

    const byOutlet = new Map<string, { outletId: string; outletCode: string; netSales: Decimal }>();
    let netSales = ZERO;
    for (const row of rows) {
      netSales = netSales.plus(row.netSales);
      const bucket = byOutlet.get(row.outletId) ?? {
        outletId: row.outletId,
        outletCode: row.outlet.code,
        netSales: ZERO,
      };
      bucket.netSales = bucket.netSales.plus(row.netSales);
      byOutlet.set(row.outletId, bucket);
    }

    return {
      netSales,
      entryCount: rows.length,
      byOutlet: [...byOutlet.values()]
        .sort((a, b) => a.outletCode.localeCompare(b.outletCode))
        .map((o) => ({ outletId: o.outletId, outletCode: o.outletCode, netSales: o.netSales.toFixed(2) })),
    };
  }

  private async netSalesSeries(from: string, to: string, outletIds: string[]) {
    const rows = await this.prisma.dailySalesEntry.groupBy({
      by: ['businessDate'],
      where: { businessDate: { gte: dayUtc(from), lte: dayUtc(to) }, outletId: { in: outletIds } },
      _sum: { netSales: true },
    });
    const byDate = new Map(rows.map((r) => [isoDate(r.businessDate), r._sum.netSales ?? ZERO]));
    // Every day in the window, entered or not, so a quiet day and a missing
    // entry do not draw the same shape.
    return eachDate(from, to).map((businessDate) => ({
      businessDate,
      netSales: byDate.get(businessDate)?.toFixed(2) ?? null,
    }));
  }

  private async missingEntries(from: string, to: string, outletIds: string[]) {
    const [outlets, rows] = await Promise.all([
      this.prisma.outlet.findMany({
        where: { id: { in: outletIds }, isActive: true },
        select: { id: true, code: true },
      }),
      this.prisma.dailySalesEntry.findMany({
        where: { businessDate: { gte: dayUtc(from), lte: dayUtc(to) }, outletId: { in: outletIds } },
        select: { outletId: true, businessDate: true },
      }),
    ]);
    const entered = new Set(rows.map((r) => `${r.outletId}|${isoDate(r.businessDate)}`));
    return outlets.flatMap((o) =>
      eachDate(from, to)
        .filter((date) => !entered.has(`${o.id}|${date}`))
        .map((businessDate) => ({ outletId: o.id, outletCode: o.code, businessDate })),
    );
  }

  private async lowStock(outletIds: string[]) {
    // One definition of "below reorder", shared with the stock list and the
    // daily digest. This used to load every stock row and compare in JS on the
    // strength of a comment claiming Prisma could not express it, which the
    // digest job disproved on the next screen over.
    const below = await this.prisma.itemStock.findMany({
      where: {
        outletId: { in: outletIds },
        item: { isActive: true },
        ...lowStockWhere(this.prisma),
      },
      select: { outlet: { select: { code: true } } },
    });
    const byOutlet: Record<string, number> = {};
    for (const row of below) {
      byOutlet[row.outlet.code] = (byOutlet[row.outlet.code] ?? 0) + 1;
    }
    return { count: below.length, byOutlet };
  }

  private async taskCounts(outletIds: string[]) {
    const rows = await this.prisma.task.groupBy({
      by: ['status', 'outletId'],
      where: { outletId: { in: outletIds }, status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } },
      _count: { _all: true },
    });
    const outlets = await this.outletCodes(outletIds);
    const total = (status: TaskStatus): number =>
      rows.filter((r) => r.status === status).reduce((acc, r) => acc + r._count._all, 0);

    const overdueByOutlet: Record<string, number> = {};
    for (const row of rows.filter((r) => r.status === 'OVERDUE')) {
      const code = outlets.get(row.outletId) ?? row.outletId;
      overdueByOutlet[code] = (overdueByOutlet[code] ?? 0) + row._count._all;
    }
    return {
      open: total('OPEN'),
      inProgress: total('IN_PROGRESS'),
      overdue: total('OVERDUE'),
      overdueByOutlet,
    };
  }

  private async pendingApprovals(outletIds: string[]) {
    const [purchaseRequests, leaveRequests] = await Promise.all([
      this.prisma.purchaseRequest.count({
        where: { status: 'PENDING', outletId: { in: outletIds } },
      }),
      this.prisma.leaveRequest.count({
        where: { status: 'PENDING', employee: { outletId: { in: outletIds } } },
      }),
    ]);
    return { purchaseRequests, leaveRequests };
  }

  /**
   * The game buckets by IST calendar day rather than the 04:00 trading day.
   * A customer playing at 01:30 is not part of any outlet's trade.
   */
  private async gameActivity(from: string, to: string) {
    const start = new Date(dayUtc(from).getTime() - 5.5 * 60 * 60 * 1000);
    const end = new Date(dayUtc(to).getTime() + DAY_MS - 5.5 * 60 * 60 * 1000);
    const [plays, redeemed] = await Promise.all([
      this.prisma.gamePlay.count({ where: { playedAt: { gte: start, lt: end } } }),
      this.prisma.rewardIssue.count({
        where: { status: 'REDEEMED', createdAt: { gte: start, lt: end } },
      }),
    ]);
    return { plays, rewardsRedeemed: redeemed, windowDays: eachDate(from, to).length };
  }

  private async outletCodes(outletIds: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    return new Map(rows.map((r) => [r.id, r.code]));
  }
}

// ---- helpers -------------------------------------------------------------

interface SalesBucket {
  businessDate: string;
  outletId: string | null;
  outletCode: string | null;
  grossSales: Decimal;
  discounts: Decimal;
  netSales: Decimal;
  cash: Decimal;
  upi: Decimal;
  card: Decimal;
  other: Decimal;
  orderCount: number | null;
  entryCount: number;
}

function emptyBucket(businessDate: string, outletId: string | null, outletCode: string | null): SalesBucket {
  return {
    businessDate,
    outletId,
    outletCode,
    grossSales: ZERO,
    discounts: ZERO,
    netSales: ZERO,
    cash: ZERO,
    upi: ZERO,
    card: ZERO,
    other: ZERO,
    orderCount: null,
    entryCount: 0,
  };
}

type CsvCell = string | number | null;

function dayUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  return new Date(dayUtc(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = dayUtc(from).getTime(); t <= dayUtc(to).getTime(); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function previousMonthRange(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    from: `${prevYear}-${pad(prevMonth)}-01`,
    to: `${prevYear}-${pad(prevMonth)}-${pad(Math.min(day, lastDay))}`,
  };
}

/** Null rather than a minus 100 percent drop when there is nothing to compare to. */
function changePct(current: Decimal, previous: Decimal | null): number | null {
  if (previous === null || previous.isZero()) return null;
  return Number(current.minus(previous).dividedBy(previous).mul(100).toDecimalPlaces(2));
}

function rate(value: number | null): string | null {
  return value === null ? null : value.toFixed(4);
}

/** Rupees the way a printed total in Bhubaneswar reads. Empty stays empty. */
/**
 * A money cell in a CSV is a number, not a display string. Indian grouping put
 * commas inside the cell, toCsv then quoted it, and Excel imported the whole
 * column as text, so the owner could not sum the one column the export exists
 * for. Grouping belongs on the screen; formatIndianNumber still serves it.
 */
function money(value: string | null): string | null {
  return value;
}

function assertSpan(from: string, to: string, maxDays: number): void {
  const requested = Math.round((dayUtc(to).getTime() - dayUtc(from).getTime()) / DAY_MS) + 1;
  if (requested > maxDays) {
    throw new DomainError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ANALYTICS_ERRORS.DATE_RANGE_TOO_LARGE,
      `Pick a range of ${maxDays} days or fewer`,
      { requestedDays: requested, maxDays },
    );
  }
}

function variantFor(roleKey: string): DashboardVariant {
  if (roleKey === 'OWNER') return 'owner';
  if (roleKey === 'OPERATIONS_MANAGER' || roleKey === 'STORE_MANAGER') return 'outlet';
  return 'functional';
}

// A null is an empty cell, never the string "null" and never 0.
function toCsv(headers: string[], rows: CsvCell[][]): string {
  const cell = (value: CsvCell): string => {
    if (value === null) return '';
    const text = String(value);
    return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n') + '\r\n';
}
