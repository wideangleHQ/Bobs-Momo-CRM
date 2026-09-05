'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useCan, useSession } from '@/lib/auth';
import { money } from '@/lib/format';
import { fetchDashboard } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { LineChart } from '@/features/analytics/charts';
import { errorMessage } from '@/features/analytics/report-frame';
import { Icon } from '@/components/ui/icons';
import type { DashboardResponse } from '@/features/analytics/types';

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBlank(data: DashboardResponse): boolean {
  const anySeries = (data.salesSeries ?? []).some((p) => num(p.netSales) > 0);
  return (
    !anySeries &&
    num(data.netSalesToday?.total) === 0 &&
    num(data.netSalesMtd?.total) === 0 &&
    (data.lowStock?.count ?? 0) === 0 &&
    (data.overdueTasks?.count ?? 0) === 0 &&
    (data.openTasks?.count ?? 0) === 0 &&
    num(data.wastage?.value) === 0
  );
}

// ─── KPI TILE ────────────────────────────────────────────────────────────────

interface TileProps {
  title: string;
  value: string;
  meta?: string;
  changePct?: number | null;
  icon: string;
  iconBg: string;
  iconColor: string;
  alert?: boolean;
  link?: string;
  linkLabel?: string;
}

function KpiTile({
  title,
  value,
  meta,
  changePct,
  icon,
  iconBg,
  iconColor,
  alert = false,
  link,
  linkLabel = 'View',
}: TileProps) {
  const isPositive = (changePct ?? 0) >= 0;

  return (
    <div
      className={`relative bg-white rounded-2xl border p-5 flex flex-col gap-3 transition-all duration-150 hover:shadow-md ${
        alert ? 'border-red-100 bg-red-50/30' : 'border-zinc-100 shadow-sm'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon name={icon} className={`h-4 w-4 ${iconColor}`} />
        </div>
        {link ? (
          <Link
            href={link}
            className="text-[11px] font-semibold text-red-600 hover:text-red-700 hover:underline transition-colors flex items-center gap-0.5 mt-0.5"
          >
            {linkLabel}
            <Icon name="chevronRight" className="h-3 w-3" />
          </Link>
        ) : null}
      </div>

      {/* Value */}
      <div>
        <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">{title}</p>
        <p className={`text-2xl font-bold tracking-tight ${alert && value !== '0' ? 'text-red-700' : 'text-zinc-900'}`}>
          {value}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 text-xs">
        {changePct !== null && changePct !== undefined ? (
          <>
            <span
              className={`flex items-center gap-0.5 font-semibold ${
                isPositive ? 'text-emerald-600' : 'text-red-500'
              }`}
            >
              <Icon name={isPositive ? 'arrowUp' : 'arrowDown'} className="h-3 w-3" />
              {Math.abs(changePct).toFixed(1)}%
            </span>
            {meta ? <span className="text-zinc-400">{meta}</span> : null}
          </>
        ) : meta ? (
          <span className="text-zinc-400">{meta}</span>
        ) : null}
      </div>
    </div>
  );
}

// ─── SKELETON GRID ───────────────────────────────────────────────────────────

function KpiSkeletons() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-[148px] rounded-2xl" />
      ))}
    </div>
  );
}

// ─── OUTLET BAR ──────────────────────────────────────────────────────────────

function OutletBar({
  name,
  sales,
  pct,
  color,
}: {
  name: string;
  sales: string;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center text-sm flex-shrink-0">
            🏪
          </div>
          <p className="text-sm font-semibold text-zinc-800 truncate">{name}</p>
        </div>
        <p className="text-sm font-semibold text-zinc-900 flex-shrink-0">{sales}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${color}`}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold text-zinc-400 w-9 text-right">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useSession();
  const can = useCan();

  const query = useQuery({
    queryKey: analyticsKeys.dashboard(),
    queryFn: fetchDashboard,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const data = query.data;

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      {/* ── PAGE HEADER ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-0.5">{greeting}</p>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">
            {user?.fullName ? `${user.fullName.split(' ')[0]}'s Dashboard` : 'Operations Dashboard'}
          </h1>
          {data?.businessDate ? (
            <p className="text-sm text-zinc-500 mt-0.5">
              Business date ·{' '}
              {new Date(data.businessDate).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          ) : null}
        </div>

        {/* Today's entry status pill */}
        {data?.todaysSalesEntry ? (
          <div
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold border ${
              data.todaysSalesEntry.entered
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <Icon
              name={data.todaysSalesEntry.entered ? 'check' : 'warning'}
              className="h-4 w-4"
            />
            {data.todaysSalesEntry.entered ? "Today's entry done" : "Entry pending"}
          </div>
        ) : null}
      </div>

      {/* ── LOADING ─────────────────────────────────────────── */}
      {query.isPending ? (
        <div className="space-y-6">
          <KpiSkeletons />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Skeleton className="lg:col-span-2 h-80 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !data ? null : (
        <>
          {/* ── ERRORS WARNING ──────────────────────────────── */}
          {data.errors && data.errors.length > 0 ? (
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              <Icon name="warning" className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <p>
                <span className="font-semibold">Some metrics could not be calculated: </span>
                {data.errors.join(', ')}. The remaining data is accurate.
              </p>
            </div>
          ) : null}

          {/* ── BLANK STATE ─────────────────────────────────── */}
          {isBlank(data) ? (
            <div className="rounded-2xl border border-zinc-100 bg-white shadow-sm p-10 flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-2xl bg-zinc-100 flex items-center justify-center mb-4">
                <Icon name="chart" className="h-6 w-6 text-zinc-400" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900 mb-1">No activity recorded</h2>
              <p className="text-sm text-zinc-500 max-w-sm leading-relaxed">
                There are no sales, stock movements or tasks recorded for this period.
              </p>
              {can('sales.entry.create') ? (
                <Link
                  href="/sales/entry"
                  className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-red-700 transition-colors"
                >
                  Enter today&apos;s sales
                  <Icon name="arrowRight" className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* ── KPI GRID ────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
            {/* Net Sales Today */}
            {data.netSalesToday !== undefined ? (
              <KpiTile
                title="Net Sales Today"
                value={money(data.netSalesToday.total)}
                changePct={data.netSalesToday.changePctVsSameDayLastWeek ?? null}
                meta="vs last week"
                icon="currencyRupee"
                iconBg="bg-red-600"
                iconColor="text-white"
                link={can('analytics.sales.read') ? '/reports/sales' : undefined}
              />
            ) : null}

            {/* Net Sales MTD */}
            {data.netSalesMtd !== undefined ? (
              <KpiTile
                title="Net Sales MTD"
                value={money(data.netSalesMtd.total)}
                changePct={data.netSalesMtd.changePctVsLastMonth ?? null}
                meta={
                  data.netSalesMtd.daysEntered !== undefined && data.netSalesMtd.daysExpected !== undefined
                    ? `${data.netSalesMtd.daysEntered}/${data.netSalesMtd.daysExpected} days`
                    : 'vs last month'
                }
                icon="trendUp"
                iconBg="bg-red-50"
                iconColor="text-red-600"
                link={can('analytics.sales.read') ? '/reports/sales' : undefined}
              />
            ) : null}

            {/* Gross Margin */}
            {data.grossMargin !== undefined ? (
              <KpiTile
                title="Gross Margin"
                value={
                  data.grossMargin.grossMarginPct !== null && data.grossMargin.grossMarginPct !== undefined
                    ? `${num(data.grossMargin.grossMarginPct).toFixed(1)}%`
                    : money(data.grossMargin.grossMarginApprox)
                }
                meta={data.grossMargin.caveat ?? 'approx, excl. overhead'}
                icon="chart"
                iconBg="bg-amber-50"
                iconColor="text-amber-600"
                link={can('analytics.pnl.read') ? '/reports/pnl' : undefined}
              />
            ) : null}

            {/* Wastage */}
            {data.wastage !== undefined ? (
              <KpiTile
                title="Wastage Value"
                value={money(data.wastage.value)}
                meta="this period"
                icon="package"
                iconBg="bg-zinc-100"
                iconColor="text-zinc-500"
                link={can('analytics.wastage.read') ? '/reports/wastage' : undefined}
              />
            ) : null}

            {/* Missing Sales Entries */}
            {data.missingSalesEntries !== undefined ? (
              <KpiTile
                title="Missing Entries"
                value={String(data.missingSalesEntries.count)}
                meta="outlets without entry"
                icon="warning"
                iconBg={data.missingSalesEntries.count > 0 ? 'bg-red-100' : 'bg-emerald-50'}
                iconColor={data.missingSalesEntries.count > 0 ? 'text-red-600' : 'text-emerald-600'}
                alert={data.missingSalesEntries.count > 0}
                link={can('sales.entry.create') ? '/sales/entry' : undefined}
                linkLabel="Fix"
              />
            ) : null}

            {/* Low Stock */}
            {data.lowStock !== undefined ? (
              <KpiTile
                title="Low Stock Items"
                value={String(data.lowStock.count)}
                meta="below reorder level"
                icon="box"
                iconBg={data.lowStock.count > 0 ? 'bg-amber-100' : 'bg-emerald-50'}
                iconColor={data.lowStock.count > 0 ? 'text-amber-600' : 'text-emerald-600'}
                alert={data.lowStock.count > 0}
                link={can('inventory.stock.read') ? '/inventory/stock' : undefined}
                linkLabel="View"
              />
            ) : null}

            {/* Overdue Tasks */}
            {data.overdueTasks !== undefined ? (
              <KpiTile
                title="Overdue Tasks"
                value={String(data.overdueTasks.count)}
                meta={data.openTasks?.count ? `${data.openTasks.count} open total` : 'tasks'}
                icon="tasks"
                iconBg={data.overdueTasks.count > 0 ? 'bg-red-100' : 'bg-emerald-50'}
                iconColor={data.overdueTasks.count > 0 ? 'text-red-600' : 'text-emerald-600'}
                alert={data.overdueTasks.count > 0}
                link={can('tasks.read') ? '/tasks' : undefined}
                linkLabel="View"
              />
            ) : null}

            {/* Pending Approvals */}
            {data.pendingApprovals !== undefined ? (
              <KpiTile
                title="Pending Approvals"
                value={String(
                  (data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0),
                )}
                meta={[
                  data.pendingApprovals.purchaseRequests ? `${data.pendingApprovals.purchaseRequests} purchase` : '',
                  data.pendingApprovals.leaveRequests ? `${data.pendingApprovals.leaveRequests} leave` : '',
                ]
                  .filter(Boolean)
                  .join(', ') || 'requests'}
                icon="inbox"
                iconBg={
                  (data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0) > 0
                    ? 'bg-red-100'
                    : 'bg-emerald-50'
                }
                iconColor={
                  (data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0) > 0
                    ? 'text-red-600'
                    : 'text-emerald-600'
                }
                alert={
                  (data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0) > 0
                }
                link={can('purchases.requests.read') ? '/purchases/requests' : undefined}
                linkLabel="Review"
              />
            ) : null}
          </div>

          {/* ── ANALYTICS ROW ───────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Sales Chart */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-100 shadow-sm p-5 flex flex-col">
              <div className="flex items-start justify-between mb-5 gap-2">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">Sales Overview</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">Daily net sales for this period</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-semibold text-zinc-500 flex-shrink-0">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-600 inline-block" />
                    This period
                  </span>
                </div>
              </div>
              <div className="flex-1 min-h-[220px]">
                {data.salesSeries && data.salesSeries.length > 0 ? (
                  <LineChart
                    title="Net sales by business date"
                    rows={data.salesSeries.map((p) => ({
                      label: p.businessDate.slice(5), // MM-DD
                      values: { net: num(p.netSales) },
                    }))}
                    series={[{ key: 'net', label: 'Net sales' }]}
                    formatValue={(v) => money(v.toFixed(0))}
                    height={240}
                  />
                ) : (
                  <div className="h-[240px] flex flex-col items-center justify-center gap-2 text-zinc-300">
                    <Icon name="chart" className="h-8 w-8" />
                    <p className="text-sm font-medium text-zinc-400">No sales data for this period</p>
                  </div>
                )}
              </div>
            </div>

            {/* Sales by Outlet */}
            <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">By Outlet</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">Today's breakdown</p>
                </div>
              </div>

              {data.netSalesToday?.byOutlet && data.netSalesToday.byOutlet.length > 0 ? (
                <div className="space-y-5">
                  {(() => {
                    const outlets = data.netSalesToday!.byOutlet!;
                    const totalSales = outlets.reduce((sum, o) => sum + num(o.netSales), 0);
                    const barColors = ['bg-red-600', 'bg-amber-400', 'bg-red-400', 'bg-amber-300'];
                    return outlets.map((outlet, idx) => {
                      const pct = totalSales > 0 ? (num(outlet.netSales) / totalSales) * 100 : 0;
                      return (
                        <OutletBar
                          key={outlet.outletId}
                          name={outlet.outletCode}
                          sales={money(outlet.netSales)}
                          pct={pct}
                          color={barColors[idx % barColors.length] ?? 'bg-red-600'}
                        />
                      );
                    });
                  })()}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-300 gap-2">
                  <Icon name="chart" className="h-7 w-7" />
                  <p className="text-xs text-zinc-400 font-medium">No outlet data today</p>
                </div>
              )}
            </div>
          </div>

          {/* ── OPERATIONAL ROW ─────────────────────────────── */}
          {/* Low stock items detail */}
          {data.lowStock && data.lowStock.count > 0 && data.lowStock.items && data.lowStock.items.length > 0 ? (
            <div className="bg-white rounded-2xl border border-amber-100 shadow-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Icon name="warning" className="h-3.5 w-3.5 text-amber-600" />
                  </div>
                  <h2 className="text-sm font-semibold text-zinc-900">
                    Low Stock Alert
                    <span className="ml-2 inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                      {data.lowStock.count} items
                    </span>
                  </h2>
                </div>
                {can('inventory.stock.read') ? (
                  <Link
                    href="/inventory/stock"
                    className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-0.5 transition-colors"
                  >
                    View all <Icon name="chevronRight" className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-50">
                      <th className="px-5 py-2.5">Item</th>
                      <th className="px-5 py-2.5 text-right">On Hand</th>
                      <th className="px-5 py-2.5 text-right">Reorder Level</th>
                      {data.lowStock.items[0]?.outletCode ? <th className="px-5 py-2.5">Outlet</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {data.lowStock.items.slice(0, 5).map((item) => (
                      <tr key={item.itemId} className="hover:bg-amber-50/30 transition-colors">
                        <td className="px-5 py-3 font-medium text-zinc-800">{item.itemName}</td>
                        <td className="px-5 py-3 text-right tabular-nums font-semibold text-red-600">
                          {num(item.qtyOnHand).toFixed(2)} {item.unitCode}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-zinc-500">
                          {num(item.reorderLevel).toFixed(2)} {item.unitCode}
                        </td>
                        {item.outletCode ? (
                          <td className="px-5 py-3 text-zinc-500">{item.outletCode}</td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Wastage top items */}
          {data.wastage && num(data.wastage.value) > 0 && data.wastage.topItems && data.wastage.topItems.length > 0 ? (
            <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Top Wastage Items
                  <span className="ml-2 text-xs font-medium text-zinc-400">
                    Total: {money(data.wastage.value)}
                  </span>
                </h2>
                {can('analytics.wastage.read') ? (
                  <Link
                    href="/reports/wastage"
                    className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-0.5 transition-colors"
                  >
                    Full report <Icon name="chevronRight" className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
              <ul className="divide-y divide-zinc-50">
                {data.wastage.topItems.slice(0, 5).map((item) => (
                  <li key={item.itemId} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 transition-colors">
                    <span className="text-sm font-medium text-zinc-800">{item.itemName}</span>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-zinc-900">{money(item.approxValue)}</p>
                      <p className="text-[11px] text-zinc-400">
                        {num(item.quantity).toFixed(2)} {item.unitCode}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
