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

  const content = (
    <div
      className={`group relative h-full rounded-2xl border p-5 flex flex-col justify-between transition-all duration-200 ease-out ${
        alert
          ? 'border-red-200/90 bg-red-50/40 hover:bg-red-50/70 hover:border-red-300'
          : 'border-zinc-200/80 bg-white hover:border-zinc-300 hover:shadow-md'
      } ${link ? 'hover:-translate-y-0.5 cursor-pointer' : ''}`}
    >
      <div>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div
            className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${iconBg}`}
          >
            <Icon name={icon} className={`h-5 w-5 ${iconColor}`} />
          </div>
          {link ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400 group-hover:text-red-600 transition-colors">
              {linkLabel}
              <Icon name="arrowUpRight" className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          ) : null}
        </div>

        {/* Title & Value */}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">{title}</p>
        <p className={`text-2xl sm:text-3xl font-bold tracking-tight ${alert && value !== '0' ? 'text-red-700' : 'text-zinc-900'}`}>
          {value}
        </p>
      </div>

      {/* Footer info */}
      <div className="flex items-center gap-2 text-xs pt-3 mt-1 border-t border-zinc-100/80">
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
            {meta ? <span className="text-zinc-400 font-medium">{meta}</span> : null}
          </>
        ) : meta ? (
          <span className="text-zinc-400 font-medium">{meta}</span>
        ) : null}
      </div>
    </div>
  );

  if (link) {
    return (
      <Link href={link} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-2xl">
        {content}
      </Link>
    );
  }

  return content;
}

// ─── ACTION CARD ─────────────────────────────────────────────────────────────

interface ActionCardProps {
  title: string;
  description: string;
  href: string;
  icon: string;
  badge?: string;
  primary?: boolean;
  accentColor?: 'red' | 'emerald' | 'blue' | 'amber' | 'zinc';
}

function ActionCard({
  title,
  description,
  href,
  icon,
  badge,
  primary = false,
  accentColor = 'zinc',
}: ActionCardProps) {
  const colorMap = {
    red: {
      bg: 'bg-red-50',
      text: 'text-red-600',
      border: 'hover:border-red-300',
      badge: 'bg-red-100 text-red-700',
    },
    emerald: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-600',
      border: 'hover:border-emerald-300',
      badge: 'bg-emerald-100 text-emerald-700',
    },
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      border: 'hover:border-blue-300',
      badge: 'bg-blue-100 text-blue-700',
    },
    amber: {
      bg: 'bg-amber-50',
      text: 'text-amber-600',
      border: 'hover:border-amber-300',
      badge: 'bg-amber-100 text-amber-700',
    },
    zinc: {
      bg: 'bg-zinc-100',
      text: 'text-zinc-700',
      border: 'hover:border-zinc-300',
      badge: 'bg-zinc-200 text-zinc-700',
    },
  };

  const scheme = colorMap[accentColor];

  return (
    <Link
      href={href}
      className={`group relative flex flex-col justify-between rounded-2xl border p-4 sm:p-5 transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 hover:-translate-y-0.5 hover:shadow-md ${
        primary
          ? 'border-red-200 bg-gradient-to-br from-red-50/60 via-white to-white hover:border-red-300 shadow-sm'
          : `border-zinc-200/80 bg-white ${scheme.border} shadow-sm`
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div
            className={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${
              primary ? 'bg-red-600 text-white shadow-sm' : `${scheme.bg} ${scheme.text}`
            }`}
          >
            <Icon name={icon} className="h-5 w-5" />
          </div>
          {badge ? (
            <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold ${scheme.badge}`}>
              {badge}
            </span>
          ) : (
            <Icon
              name="arrowUpRight"
              className="h-4 w-4 text-zinc-300 group-hover:text-zinc-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          )}
        </div>

        <h3 className="text-sm sm:text-base font-bold text-zinc-900 group-hover:text-red-600 transition-colors">
          {title}
        </h3>
        <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">{description}</p>
      </div>

      <div className="mt-4 pt-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-400 group-hover:text-zinc-700 transition-colors">
        <span>Open action</span>
        <Icon name="arrowRight" className="h-3 w-3 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

// ─── SKELETON GRID ───────────────────────────────────────────────────────────

function DashboardSkeletons() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[140px] rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[148px] rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="lg:col-span-2 h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-zinc-100 flex items-center justify-center text-sm flex-shrink-0">
            🏪
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-800 truncate">{name}</p>
            <p className="text-[11px] text-zinc-400">Store location</p>
          </div>
        </div>
        <p className="text-sm font-bold text-zinc-900 tabular-nums flex-shrink-0">{sales}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-2 flex-1 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${color}`}
            style={{ width: `${Math.min(100, Math.max(3, pct))}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold text-zinc-400 w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

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
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── PAGE HEADER ─────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
              Operations Control
            </span>
            <p className="text-xs font-medium text-zinc-400">· {greeting}</p>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 tracking-tight mt-1">
            {user?.fullName ? `${user.fullName.split(' ')[0]}'s Workspace` : 'Operations Dashboard'}
          </h1>
          {data?.businessDate ? (
            <p className="text-xs sm:text-sm text-zinc-500 mt-1 flex items-center gap-1.5">
              <Icon name="calendar" className="h-3.5 w-3.5 text-zinc-400" />
              <span>
                Business Date:{' '}
                <strong className="text-zinc-700 font-semibold">
                  {new Date(data.businessDate).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </strong>
              </span>
            </p>
          ) : null}
        </div>

        {/* Status Indicators & Fast Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {data?.todaysSalesEntry ? (
            <div
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold border shadow-sm ${
                data.todaysSalesEntry.entered
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <Icon
                name={data.todaysSalesEntry.entered ? 'check' : 'warning'}
                className="h-4 w-4 flex-shrink-0"
              />
              <span>{data.todaysSalesEntry.entered ? "Today's sales recorded" : 'Daily sales pending'}</span>
            </div>
          ) : null}

          {can('purchase.record.create') || can('inventory.transaction.create') ? (
            <Link
              href="/inventory/receive"
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <Icon name="plus" className="h-4 w-4" />
              <span>Record New Stock</span>
            </Link>
          ) : null}
        </div>
      </div>

      {/* ── LOADING ─────────────────────────────────────────── */}
      {query.isPending ? (
        <DashboardSkeletons />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !data ? null : (
        <>
          {/* ── WARNING ALERTS ──────────────────────────────── */}
          {data.errors && data.errors.length > 0 ? (
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3.5 text-sm text-amber-900 shadow-sm">
              <Icon name="warning" className="h-5 w-5 mt-0.5 flex-shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-950">Some metrics could not be fully calculated</p>
                <p className="text-xs text-amber-800 mt-0.5">{data.errors.join(', ')}. Remaining figures are accurate.</p>
              </div>
            </div>
          ) : null}

          {/* ── BLANK STATE ─────────────────────────────────── */}
          {isBlank(data) ? (
            <div className="rounded-2xl border border-zinc-200/80 bg-white shadow-sm p-10 flex flex-col items-center text-center">
              <div className="h-14 w-14 rounded-2xl bg-zinc-100 flex items-center justify-center mb-4">
                <Icon name="chart" className="h-7 w-7 text-zinc-400" />
              </div>
              <h2 className="text-lg font-bold text-zinc-900 mb-1">No activity recorded for this period</h2>
              <p className="text-sm text-zinc-500 max-w-md leading-relaxed">
                There are no sales, stock movements, or tasks recorded yet. Start by recording a new delivery or entering sales.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {can('purchase.record.create') || can('inventory.transaction.create') ? (
                  <Link
                    href="/inventory/receive"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-red-700 transition-colors"
                  >
                    <Icon name="package" className="h-4 w-4" />
                    Record New Stock
                  </Link>
                ) : null}
                {can('sales.entry.create') ? (
                  <Link
                    href="/sales/entry"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-semibold shadow-sm hover:bg-zinc-800 transition-colors"
                  >
                    Enter today&apos;s sales
                    <Icon name="arrowRight" className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ── 1. CORE OPERATIONAL QUICK ACTIONS ───────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Quick Actions & Workflows</h2>
                <p className="text-xs text-zinc-400">Direct access to daily operational tasks</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              {/* Primary Action: Record New Stock */}
              {(can('purchase.record.create') || can('inventory.transaction.create')) && (
                <ActionCard
                  title="Record New Stock"
                  description="Receive stock from supplier with invoice & items in one flow."
                  href="/inventory/receive"
                  icon="package"
                  badge="Primary"
                  primary={true}
                  accentColor="red"
                />
              )}

              {/* Check Stock */}
              {can('inventory.stock.read') && (
                <ActionCard
                  title="Check Stock"
                  description="View current inventory quantities & low-stock items."
                  href="/inventory/stock"
                  icon="warehouse"
                  accentColor="amber"
                />
              )}

              {/* Stock History */}
              {can('inventory.stock.read') && (
                <ActionCard
                  title="Stock History"
                  description="Track audit log of stock received, usage & wastage."
                  href="/inventory/history"
                  icon="history"
                  accentColor="blue"
                />
              )}

              {/* Purchases */}
              {can('purchase.record.read') && (
                <ActionCard
                  title="Purchases"
                  description="View and verify supplier purchase invoices & slips."
                  href="/purchases/records"
                  icon="receipt"
                  accentColor="emerald"
                />
              )}

              {/* Suppliers */}
              {can('vendor.read') && (
                <ActionCard
                  title="Suppliers"
                  description="Manage vendor details, phone numbers, and GSTIN."
                  href="/vendors"
                  icon="building"
                  accentColor="zinc"
                />
              )}

              {/* Manage Items */}
              {can('inventory.item.read') && (
                <ActionCard
                  title="Manage Items"
                  description="View master catalog, units, categories & reorder levels."
                  href="/inventory/items"
                  icon="layers"
                  accentColor="zinc"
                />
              )}
            </div>
          </section>

          {/* ── 2. KPI OVERVIEW CARDS ──────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Key Business Metrics</h2>
                <p className="text-xs text-zinc-400">Live operational & sales telemetry</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {/* Net Sales Today */}
              {data.netSalesToday !== undefined ? (
                <KpiTile
                  title="Net Sales Today"
                  value={money(data.netSalesToday.total)}
                  changePct={data.netSalesToday.changePctVsSameDayLastWeek ?? null}
                  meta="vs same day last week"
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
                      ? `${data.netSalesMtd.daysEntered}/${data.netSalesMtd.daysExpected} days entered`
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

              {/* Low Stock Items */}
              {data.lowStock !== undefined ? (
                <KpiTile
                  title="Low Stock Items"
                  value={String(data.lowStock.count)}
                  meta="items below reorder level"
                  icon="box"
                  iconBg={data.lowStock.count > 0 ? 'bg-amber-100' : 'bg-emerald-50'}
                  iconColor={data.lowStock.count > 0 ? 'text-amber-600' : 'text-emerald-600'}
                  alert={data.lowStock.count > 0}
                  link={can('inventory.stock.read') ? '/inventory/stock' : undefined}
                  linkLabel="Restock"
                />
              ) : null}

              {/* Wastage Value */}
              {data.wastage !== undefined ? (
                <KpiTile
                  title="Wastage Value"
                  value={money(data.wastage.value)}
                  meta="total recorded wastage"
                  icon="package"
                  iconBg="bg-zinc-100"
                  iconColor="text-zinc-600"
                  link={can('analytics.wastage.read') ? '/reports/wastage' : undefined}
                />
              ) : null}

              {/* Missing Sales Entries */}
              {data.missingSalesEntries !== undefined ? (
                <KpiTile
                  title="Missing Entries"
                  value={String(data.missingSalesEntries.count)}
                  meta="outlets pending entry"
                  icon="warning"
                  iconBg={data.missingSalesEntries.count > 0 ? 'bg-red-100' : 'bg-emerald-50'}
                  iconColor={data.missingSalesEntries.count > 0 ? 'text-red-600' : 'text-emerald-600'}
                  alert={data.missingSalesEntries.count > 0}
                  link={can('sales.entry.create') ? '/sales/entry' : undefined}
                  linkLabel="Fix"
                />
              ) : null}

              {/* Overdue Tasks */}
              {data.overdueTasks !== undefined ? (
                <KpiTile
                  title="Overdue Tasks"
                  value={String(data.overdueTasks.count)}
                  meta={data.openTasks?.count ? `${data.openTasks.count} total open tasks` : 'checklist items'}
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
                    .join(', ') || 'requests pending'}
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
          </section>

          {/* ── 3. ANALYTICS & OUTLET DISTRIBUTION ────────────── */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Sales Chart */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-200/80 shadow-sm p-5 sm:p-6 flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 gap-2 pb-3 border-b border-zinc-100">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                      <Icon name="chart" className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-zinc-900">Sales Overview</h2>
                      <p className="text-xs text-zinc-400">Daily net sales trend for active period</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold text-zinc-500">
                    <span className="flex items-center gap-1.5 bg-zinc-50 px-2.5 py-1 rounded-lg border border-zinc-100">
                      <span className="w-2 h-2 rounded-full bg-red-600 inline-block" />
                      Net Sales (₹)
                    </span>
                    {can('analytics.sales.read') ? (
                      <Link
                        href="/reports/sales"
                        className="text-red-600 hover:text-red-700 flex items-center gap-0.5 transition-colors"
                      >
                        Detailed report <Icon name="chevronRight" className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="w-full min-h-[240px]">
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
                      <p className="text-sm font-medium text-zinc-400">No sales trend recorded for this period</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sales by Outlet */}
            <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm p-5 sm:p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-5 pb-3 border-b border-zinc-100">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                      <Icon name="building" className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-zinc-900">By Store Outlet</h2>
                      <p className="text-xs text-zinc-400">Today&apos;s revenue contribution</p>
                    </div>
                  </div>
                </div>

                {data.netSalesToday?.byOutlet && data.netSalesToday.byOutlet.length > 0 ? (
                  <div className="space-y-4">
                    {(() => {
                      const outlets = data.netSalesToday!.byOutlet!;
                      const totalSales = outlets.reduce((sum, o) => sum + num(o.netSales), 0);
                      const barColors = ['bg-red-600', 'bg-amber-500', 'bg-blue-600', 'bg-emerald-600'];
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
                  <div className="flex flex-col items-center justify-center h-48 text-zinc-300 gap-2">
                    <Icon name="building" className="h-8 w-8" />
                    <p className="text-xs text-zinc-400 font-medium">No store sales recorded today</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── 4. OPERATIONAL DETAIL SECTIONS ─────────────────── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Low stock items detail */}
            {data.lowStock && data.lowStock.count > 0 && data.lowStock.items && data.lowStock.items.length > 0 ? (
              <div className="bg-white rounded-2xl border border-amber-200/90 shadow-sm overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-amber-50/40">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                        <Icon name="warning" className="h-4 w-4 text-amber-700" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                          Low Stock Alerts
                          <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            {data.lowStock.count} items
                          </span>
                        </h2>
                        <p className="text-[11px] text-zinc-500">Inventory levels requiring restock</p>
                      </div>
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
                        <tr className="text-left text-[11px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-100 bg-zinc-50/50">
                          <th className="px-5 py-2.5">Item</th>
                          <th className="px-5 py-2.5 text-right">On Hand</th>
                          <th className="px-5 py-2.5 text-right">Reorder Level</th>
                          <th className="px-5 py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {data.lowStock.items.slice(0, 5).map((item) => (
                          <tr key={item.itemId} className="hover:bg-amber-50/30 transition-colors">
                            <td className="px-5 py-3">
                              <p className="font-semibold text-zinc-800">{item.itemName}</p>
                              {item.outletCode ? <p className="text-[11px] text-zinc-400">{item.outletCode}</p> : null}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums font-bold text-red-600">
                              {num(item.qtyOnHand).toFixed(2)} {item.unitCode}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-zinc-500 text-xs">
                              {num(item.reorderLevel).toFixed(2)} {item.unitCode}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {(can('purchase.record.create') || can('inventory.transaction.create')) ? (
                                <Link
                                  href={`/inventory/receive?itemId=${encodeURIComponent(item.itemId)}`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-semibold transition-colors"
                                >
                                  <Icon name="plus" className="h-3 w-3" />
                                  <span>Receive</span>
                                </Link>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm p-6 flex flex-col items-center justify-center text-center">
                <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center mb-3">
                  <Icon name="check" className="h-6 w-6 text-emerald-600" />
                </div>
                <h3 className="text-sm font-bold text-zinc-900">Inventory Levels Healthy</h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                  No items are currently below their configured reorder thresholds.
                </p>
                {can('inventory.stock.read') ? (
                  <Link
                    href="/inventory/stock"
                    className="mt-4 text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
                  >
                    Check Stock List <Icon name="chevronRight" className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
            )}

            {/* Top Wastage Items */}
            {data.wastage && num(data.wastage.value) > 0 && data.wastage.topItems && data.wastage.topItems.length > 0 ? (
              <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50/50">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-zinc-100 flex items-center justify-center flex-shrink-0">
                        <Icon name="package" className="h-4 w-4 text-zinc-600" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-zinc-900">
                          Top Wastage Items
                        </h2>
                        <p className="text-[11px] text-zinc-500">Total Period Loss: {money(data.wastage.value)}</p>
                      </div>
                    </div>
                    {can('analytics.wastage.read') ? (
                      <Link
                        href="/reports/wastage"
                        className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-0.5 transition-colors"
                      >
                        Full report <Icon name="chevronRight" className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>

                  <ul className="divide-y divide-zinc-100">
                    {data.wastage.topItems.slice(0, 5).map((item) => (
                      <li key={item.itemId} className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50 transition-colors">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800">{item.itemName}</p>
                          <p className="text-[11px] text-zinc-400">
                            {num(item.quantity).toFixed(2)} {item.unitCode} wasted
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-zinc-900 tabular-nums">{money(item.approxValue)}</p>
                          <p className="text-[11px] text-zinc-400">approx cost</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-sm p-6 flex flex-col items-center justify-center text-center">
                <div className="h-12 w-12 rounded-2xl bg-zinc-100 flex items-center justify-center mb-3">
                  <Icon name="package" className="h-6 w-6 text-zinc-400" />
                </div>
                <h3 className="text-sm font-bold text-zinc-900">No Wastage Recorded</h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                  Zero wastage or spoilage items reported for this operating period.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
