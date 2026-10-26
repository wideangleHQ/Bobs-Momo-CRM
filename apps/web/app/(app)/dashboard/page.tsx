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

// ─── EYEBROW LABEL ───────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-[#D9362B]">{children}</p>
  );
}

// ─── KPI CARD VARIANTS ───────────────────────────────────────────────────────

/** White card — standard KPI */
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
}: {
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
}) {
  const isPositive = (changePct ?? 0) >= 0;

  const content = (
    <div
      className={`group relative h-full rounded-xl border p-3.5 sm:p-4 flex flex-col justify-between transition-all duration-200 ease-out ${
        alert
          ? 'border-[#D9362B]/20 bg-[#FFF0EE]/60 hover:bg-[#FFF0EE] hover:border-[#D9362B]/30'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:shadow-sm'
      } ${link ? 'hover:-translate-y-0.5 cursor-pointer' : ''}`}
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
            <Icon name={icon} className={`h-4 w-4 ${iconColor}`} />
          </div>
          {link ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--color-text-muted)] group-hover:text-[#D9362B] transition-colors">
              {linkLabel}
              <Icon name="arrowUpRight" className="h-3 w-3" />
            </span>
          ) : null}
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-1">{title}</p>
        <p className={`text-2xl font-extrabold tracking-tight leading-none ${alert && value !== '0' ? 'text-[#D9362B]' : 'text-[var(--color-text)]'}`}>
          {value}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] pt-2.5 mt-2 border-t border-[var(--color-border)]">
        {changePct !== null && changePct !== undefined ? (
          <>
            <span className={`flex items-center gap-0.5 font-bold ${isPositive ? 'text-[var(--color-success)]' : 'text-[#D9362B]'}`}>
              <Icon name={isPositive ? 'arrowUp' : 'arrowDown'} className="h-2.5 w-2.5" />
              {Math.abs(changePct).toFixed(1)}%
            </span>
            {meta ? <span className="text-[var(--color-text-muted)] font-medium truncate">{meta}</span> : null}
          </>
        ) : meta ? (
          <span className="text-[var(--color-text-muted)] font-medium truncate">{meta}</span>
        ) : null}
      </div>
    </div>
  );

  if (link) {
    return (
      <Link href={link} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D9362B] rounded-xl">
        {content}
      </Link>
    );
  }
  return content;
}

/** Red hero card — primary metric */
function HeroKpiCard({
  title,
  value,
  meta,
  changePct,
  icon,
  link,
}: {
  title: string;
  value: string;
  meta?: string;
  changePct?: number | null;
  icon: string;
  link?: string;
}) {
  const isPositive = (changePct ?? 0) >= 0;
  const content = (
    <div className="group relative h-full rounded-xl p-4 sm:p-5 flex flex-col justify-between bg-[#D9362B] overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer">
      <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/5 pointer-events-none" />
      <div className="absolute -right-2 -bottom-4 h-18 w-18 rounded-full bg-white/5 pointer-events-none" />

      <div>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="h-9 w-9 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
            <Icon name={icon} className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-white/60 group-hover:text-white transition-colors">
            View report
            <Icon name="arrowUpRight" className="h-3 w-3" />
          </span>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{title}</p>
        <p className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-none">{value}</p>
      </div>

      <div className="flex items-center gap-2 text-[10px] pt-3 mt-2 border-t border-white/15">
        {changePct !== null && changePct !== undefined ? (
          <>
            <span className={`flex items-center gap-0.5 font-bold px-1.5 py-0.5 rounded ${isPositive ? 'bg-white/15 text-white' : 'bg-white/10 text-white/70'}`}>
              <Icon name={isPositive ? 'arrowUp' : 'arrowDown'} className="h-2.5 w-2.5" />
              {Math.abs(changePct).toFixed(1)}%
            </span>
            {meta ? <span className="text-white/55 font-medium">{meta}</span> : null}
          </>
        ) : meta ? (
          <span className="text-white/55 font-medium">{meta}</span>
        ) : null}
      </div>
    </div>
  );

  if (link) {
    return (
      <Link href={link} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-xl">
        {content}
      </Link>
    );
  }
  return content;
}

/** Dark/black card — secondary hero metric */
function DarkKpiCard({
  title,
  value,
  meta,
  changePct,
  icon,
  link,
}: {
  title: string;
  value: string;
  meta?: string;
  changePct?: number | null;
  icon: string;
  link?: string;
}) {
  const isPositive = (changePct ?? 0) >= 0;
  const content = (
    <div className="group relative h-full rounded-xl p-4 sm:p-5 flex flex-col justify-between bg-[#171717] overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer">
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/[0.03] pointer-events-none" />

      <div>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="h-9 w-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <Icon name={icon} className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-white/40 group-hover:text-[#FFC928] transition-colors">
            Details
            <Icon name="arrowUpRight" className="h-3 w-3" />
          </span>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">{title}</p>
        <p className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-none">{value}</p>
      </div>

      <div className="flex items-center gap-2 text-[10px] pt-3 mt-2 border-t border-white/10">
        {changePct !== null && changePct !== undefined ? (
          <>
            <span className={`flex items-center gap-0.5 font-bold ${isPositive ? 'text-[#FFC928]' : 'text-[#D9362B]'}`}>
              <Icon name={isPositive ? 'arrowUp' : 'arrowDown'} className="h-2.5 w-2.5" />
              {Math.abs(changePct).toFixed(1)}%
            </span>
            {meta ? <span className="text-white/35 font-medium">{meta}</span> : null}
          </>
        ) : meta ? (
          <span className="text-white/35 font-medium">{meta}</span>
        ) : null}
      </div>
    </div>
  );

  if (link) {
    return (
      <Link href={link} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFC928] rounded-xl">
        {content}
      </Link>
    );
  }
  return content;
}

// ─── COMPACT QUICK ACTION ROW ────────────────────────────────────────────────

function QuickActionRow({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description?: string;
  href: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:border-[#D9362B]/40 hover:shadow-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D9362B]"
    >
      <div className="h-8 w-8 rounded-lg bg-[#FFF0EE] flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform duration-150">
        <Icon name={icon} className="h-4 w-4 text-[#D9362B]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--color-text)] group-hover:text-[#D9362B] transition-colors leading-tight">{title}</p>
        {description ? <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">{description}</p> : null}
      </div>
      <Icon name="chevronRight" className="h-4 w-4 text-[var(--color-text-muted)] group-hover:text-[#D9362B] flex-shrink-0 transition-colors" />
    </Link>
  );
}

// ─── OUTLET BAR ──────────────────────────────────────────────────────────────

function OutletBar({ name, sales, pct, color }: { name: string; sales: string; pct: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-[#FFF0EE] flex items-center justify-center flex-shrink-0">
            <Icon name="building" className="h-3 w-3 text-[#D9362B]" />
          </div>
          <p className="text-xs font-semibold text-[var(--color-text)] truncate">{name}</p>
        </div>
        <p className="text-xs font-bold text-[var(--color-text)] tabular-nums flex-shrink-0">{sales}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${color}`}
            style={{ width: `${Math.min(100, Math.max(3, pct))}%` }}
          />
        </div>
        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] w-8 text-right tabular-nums">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ─── SKELETON ────────────────────────────────────────────────────────────────

function DashboardSkeletons() {
  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Skeleton className="col-span-2 lg:col-span-3 h-[130px] rounded-xl" />
        <Skeleton className="col-span-1 lg:col-span-2 h-[130px] rounded-xl" />
        <Skeleton className="col-span-1 lg:col-span-1 h-[130px] rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[110px] rounded-xl" />
        <Skeleton className="h-[110px] rounded-xl" />
      </div>
      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
      </div>
      {/* Sales */}
      <Skeleton className="h-[280px] rounded-xl" />
      {/* Low stock + wastage */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Skeleton className="lg:col-span-3 h-[240px] rounded-xl" />
        <Skeleton className="lg:col-span-2 h-[240px] rounded-xl" />
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* ── PAGE HEADER ─────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#D9362B]">Operations</span>
            <span className="text-[10px] font-medium text-[var(--color-text-muted)]">· {greeting}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[var(--color-text)] tracking-tight leading-tight">
            {user?.fullName ? `${user.fullName.split(' ')[0]}'s Dashboard` : "Bob's Momo Dashboard"}
          </h1>
          {data?.businessDate ? (
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
              <Icon name="calendar" className="h-3 w-3" />
              Business date:{' '}
              <strong className="font-semibold text-[var(--color-text)]">
                {new Date(data.businessDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </strong>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data?.todaysSalesEntry ? (
            <div
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold border ${
                data.todaysSalesEntry.entered
                  ? 'bg-[var(--color-success-bg)] border-[var(--color-success-bg)] text-[var(--color-success)]'
                  : 'bg-[var(--color-warning-bg)] border-[var(--color-warning-bg)] text-[var(--color-warning)]'
              }`}
            >
              <Icon name={data.todaysSalesEntry.entered ? 'check' : 'warning'} className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{data.todaysSalesEntry.entered ? "Today's sales recorded" : 'Daily sales pending'}</span>
            </div>
          ) : null}

          {can('purchase.record.create') || can('inventory.transaction.create') ? (
            <Link
              href="/inventory/receive"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D9362B] px-3.5 py-1.5 text-[11px] sm:text-xs font-bold text-white shadow-sm hover:bg-[#A8201A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D9362B]"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              <span>Record New Stock</span>
            </Link>
          ) : null}
        </div>
      </div>

      {/* ── LOADING / ERROR ──────────────────────────────────────────────── */}
      {query.isPending ? (
        <DashboardSkeletons />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !data ? null : (
        <>
          {/* Partial-data warning */}
          {data.errors && data.errors.length > 0 ? (
            <div className="flex items-start gap-3 rounded-xl bg-[var(--color-warning-bg)] border border-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning)]">
              <Icon name="warning" className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Some metrics could not be fully calculated</p>
                <p className="text-[11px] mt-0.5 opacity-80">{data.errors.join(', ')}. Remaining figures are accurate.</p>
              </div>
            </div>
          ) : null}

          {/* Blank-state CTA */}
          {isBlank(data) ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-xl bg-[var(--color-surface-muted)] flex items-center justify-center mb-3">
                <Icon name="chart" className="h-6 w-6 text-[var(--color-text-muted)]" />
              </div>
              <h2 className="text-base font-bold text-[var(--color-text)] mb-1">No activity recorded yet</h2>
              <p className="text-xs text-[var(--color-text-muted)] max-w-sm">Start by recording a new delivery or entering today's sales.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {can('purchase.record.create') || can('inventory.transaction.create') ? (
                  <Link href="/inventory/receive" className="inline-flex items-center gap-2 px-4 py-2 bg-[#D9362B] text-white rounded-lg text-xs font-semibold hover:bg-[#A8201A] transition-colors">
                    <Icon name="package" className="h-3.5 w-3.5" />
                    Record New Stock
                  </Link>
                ) : null}
                {can('sales.entry.create') ? (
                  <Link href="/sales/entry" className="inline-flex items-center gap-2 px-4 py-2 bg-[#171717] text-white rounded-lg text-xs font-semibold hover:bg-[#292929] transition-colors">
                    Enter today&apos;s sales
                    <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ── 1. KEY BUSINESS METRICS ─────────────────────────────────── */}
          <section className="space-y-2.5">
            <div>
              <Eyebrow>Key Business Metrics</Eyebrow>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Live operational &amp; sales telemetry</p>
            </div>

            {/* Asymmetric row: hero(3) + dark(2) + alert(1) on 6-col */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5 sm:gap-3">
              {data.netSalesToday !== undefined ? (
                <div className="col-span-2 lg:col-span-3">
                  <HeroKpiCard
                    title="Net Sales Today"
                    value={money(data.netSalesToday.total)}
                    changePct={data.netSalesToday.changePctVsSameDayLastWeek ?? null}
                    meta="vs same day last week"
                    icon="currencyRupee"
                    link={can('analytics.sales.read') ? '/reports/sales' : undefined}
                  />
                </div>
              ) : null}

              {data.netSalesMtd !== undefined ? (
                <div className="col-span-2 lg:col-span-2">
                  <DarkKpiCard
                    title="Net Sales MTD"
                    value={money(data.netSalesMtd.total)}
                    changePct={data.netSalesMtd.changePctVsLastMonth ?? null}
                    meta={
                      data.netSalesMtd.daysEntered !== undefined && data.netSalesMtd.daysExpected !== undefined
                        ? `${data.netSalesMtd.daysEntered}/${data.netSalesMtd.daysExpected} days`
                        : 'vs last month'
                    }
                    icon="trendUp"
                    link={can('analytics.sales.read') ? '/reports/sales' : undefined}
                  />
                </div>
              ) : null}

              {data.lowStock !== undefined ? (
                <div className="col-span-1 lg:col-span-1">
                  <KpiTile
                    title="Low Stock"
                    value={String(data.lowStock.count)}
                    meta="below reorder"
                    icon="box"
                    iconBg={data.lowStock.count > 0 ? 'bg-[#FFF0EE]' : 'bg-[var(--color-success-bg)]'}
                    iconColor={data.lowStock.count > 0 ? 'text-[#D9362B]' : 'text-[var(--color-success)]'}
                    alert={data.lowStock.count > 0}
                    link={can('inventory.stock.read') ? '/inventory/stock' : undefined}
                    linkLabel="Restock"
                  />
                </div>
              ) : null}
            </div>

            {/* Secondary row: Pending Approvals + Overdue Tasks */}
            {(data.pendingApprovals !== undefined || data.overdueTasks !== undefined) ? (
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                {data.pendingApprovals !== undefined ? (
                  <KpiTile
                    title="Pending Approvals"
                    value={String((data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0))}
                    meta={
                      [
                        data.pendingApprovals.purchaseRequests ? `${data.pendingApprovals.purchaseRequests} purchase` : '',
                        data.pendingApprovals.leaveRequests ? `${data.pendingApprovals.leaveRequests} leave` : '',
                      ].filter(Boolean).join(', ') || 'requests pending'
                    }
                    icon="inbox"
                    iconBg={(data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0) > 0 ? 'bg-[#FFF0EE]' : 'bg-[var(--color-success-bg)]'}
                    iconColor={(data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0) > 0 ? 'text-[#D9362B]' : 'text-[var(--color-success)]'}
                    alert={(data.pendingApprovals.purchaseRequests ?? 0) + (data.pendingApprovals.leaveRequests ?? 0) > 0}
                    link={can('purchase.request.read') ? '/purchases/requests' : undefined}
                    linkLabel="Review"
                  />
                ) : null}

                {data.overdueTasks !== undefined ? (
                  <KpiTile
                    title="Overdue Tasks"
                    value={String(data.overdueTasks.count)}
                    meta={data.openTasks?.count ? `${data.openTasks.count} open total` : 'checklist items'}
                    icon="tasks"
                    iconBg={data.overdueTasks.count > 0 ? 'bg-[#FFF0EE]' : 'bg-[var(--color-success-bg)]'}
                    iconColor={data.overdueTasks.count > 0 ? 'text-[#D9362B]' : 'text-[var(--color-success)]'}
                    alert={data.overdueTasks.count > 0}
                    link={can('task.task.read') ? '/tasks' : undefined}
                  />
                ) : null}
              </div>
            ) : null}
          </section>

          {/* ── 2. QUICK ACTIONS ────────────────────────────────────────── */}
          <section className="space-y-2.5">
            <div>
              <Eyebrow>Quick Actions</Eyebrow>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Direct access to daily operational tasks</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {(can('purchase.record.create') || can('inventory.transaction.create')) && (
                <QuickActionRow title="Record New Stock" description="Receive stock from supplier" href="/inventory/receive" icon="package" />
              )}
              {can('inventory.stock.read') && (
                <QuickActionRow title="Check Stock" description="Current on-hand quantities" href="/inventory/stock" icon="warehouse" />
              )}
              {can('inventory.stock.read') && (
                <QuickActionRow title="Stock History" description="Audit log of movements" href="/inventory/history" icon="history" />
              )}
              {can('purchase.record.read') && (
                <QuickActionRow title="Purchases" description="Supplier invoices &amp; records" href="/purchases/records" icon="receipt" />
              )}
              {can('vendor.vendor.read') && (
                <QuickActionRow title="Suppliers" description="Vendor details &amp; contacts" href="/vendors" icon="building" />
              )}
              {can('inventory.item.read') && (
                <QuickActionRow title="Manage Items" description="Catalog, units &amp; categories" href="/inventory/items" icon="layers" />
              )}
            </div>
          </section>

          {/* ── 3. SALES OVERVIEW ───────────────────────────────────────── */}
          <section className="space-y-2.5">
            <div>
              <Eyebrow>Sales Overview</Eyebrow>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Daily net sales trend for active period</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Sales Chart — wide */}
              <div className="lg:col-span-2 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2 pb-3 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-[#FFF0EE] flex items-center justify-center flex-shrink-0">
                      <Icon name="chart" className="h-4 w-4 text-[#D9362B]" />
                    </div>
                    <h2 className="text-sm font-bold text-[var(--color-text)]">Net Sales Trend</h2>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-semibold text-[var(--color-text-muted)]">
                    <span className="flex items-center gap-1.5 bg-[var(--color-surface-muted)] px-2 py-1 rounded-lg border border-[var(--color-border)]">
                      <span className="w-2 h-2 rounded-full bg-[#D9362B] inline-block" />
                      Net Sales (₹)
                    </span>
                    {can('analytics.sales.read') ? (
                      <Link href="/reports/sales" className="text-[#D9362B] hover:text-[#A8201A] flex items-center gap-0.5 transition-colors">
                        Detailed report <Icon name="chevronRight" className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="w-full">
                  {data.salesSeries && data.salesSeries.length > 0 ? (
                    <LineChart
                      title="Net sales by business date"
                      rows={data.salesSeries.map((p) => ({
                        label: p.businessDate.slice(5),
                        values: { net: num(p.netSales) },
                      }))}
                      series={[{ key: 'net', label: 'Net sales' }]}
                      formatValue={(v) => money(v.toFixed(0))}
                      height={200}
                    />
                  ) : (
                    <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)]">
                      <Icon name="chart" className="h-7 w-7" />
                      <p className="text-xs font-medium">No sales trend recorded for this period</p>
                    </div>
                  )}
                </div>
              </div>

              {/* By Store — compact */}
              <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-[#FFF6D6] flex items-center justify-center flex-shrink-0">
                      <Icon name="building" className="h-4 w-4 text-[#171717]" />
                    </div>
                    <h2 className="text-sm font-bold text-[var(--color-text)]">By Store</h2>
                  </div>
                </div>

                {data.netSalesToday?.byOutlet && data.netSalesToday.byOutlet.length > 0 ? (
                  <div className="space-y-3">
                    {(() => {
                      const outlets = data.netSalesToday!.byOutlet!;
                      const totalSales = outlets.reduce((sum, o) => sum + num(o.netSales), 0);
                      const barColors = ['bg-[#D9362B]', 'bg-[#171717]', 'bg-[#FFC928]', 'bg-[#A8201A]'];
                      return outlets.map((outlet, idx) => (
                        <OutletBar
                          key={outlet.outletId}
                          name={outlet.outletCode}
                          sales={money(outlet.netSales)}
                          pct={totalSales > 0 ? (num(outlet.netSales) / totalSales) * 100 : 0}
                          color={barColors[idx % barColors.length] ?? 'bg-[#D9362B]'}
                        />
                      ));
                    })()}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-40 text-[var(--color-text-muted)] gap-2">
                    <Icon name="building" className="h-7 w-7" />
                    <p className="text-[11px] font-medium">No store sales recorded today</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── 4. LOW STOCK + WASTAGE ──────────────────────────────────── */}
          <section className="space-y-2.5">
            <div>
              <Eyebrow>Stock &amp; Wastage</Eyebrow>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
              {/* Low Stock Alerts — 60% (3/5) */}
              <div className="lg:col-span-3">
                {data.lowStock && data.lowStock.count > 0 && data.lowStock.items && data.lowStock.items.length > 0 ? (
                  <div className="bg-[var(--color-surface)] rounded-xl border border-[#D9362B]/20 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#D9362B]/10 bg-[#FFF0EE]/30">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-[#FFF0EE] flex items-center justify-center flex-shrink-0">
                          <Icon name="warning" className="h-3.5 w-3.5 text-[#D9362B]" />
                        </div>
                        <div>
                          <h2 className="text-xs font-bold text-[var(--color-text)]">
                            Low Stock Alerts
                            <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[#FFF0EE] text-[#D9362B]">
                              {data.lowStock.count}
                            </span>
                          </h2>
                          <p className="text-[10px] text-[var(--color-text-muted)]">Items requiring restock</p>
                        </div>
                      </div>
                      {can('inventory.stock.read') ? (
                        <Link href="/inventory/stock" className="text-[11px] font-semibold text-[#D9362B] hover:text-[#A8201A] flex items-center gap-0.5 transition-colors">
                          View all <Icon name="chevronRight" className="h-3 w-3" />
                        </Link>
                      ) : null}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                            <th className="px-4 py-2">Item</th>
                            <th className="px-4 py-2 text-right">On Hand</th>
                            <th className="px-4 py-2 text-right">Reorder</th>
                            {(can('purchase.record.create') || can('inventory.transaction.create')) ? <th className="px-4 py-2 text-right" /> : null}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                          {data.lowStock.items.slice(0, 4).map((item) => (
                            <tr key={item.itemId} className="hover:bg-[#FFF0EE]/20 transition-colors">
                              <td className="px-4 py-2.5">
                                <p className="text-xs font-semibold text-[var(--color-text)]">{item.itemName}</p>
                                {item.outletCode ? <p className="text-[10px] text-[var(--color-text-muted)]">{item.outletCode}</p> : null}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-xs font-bold text-[#D9362B]">
                                {num(item.qtyOnHand).toFixed(2)} {item.unitCode}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-[10px] text-[var(--color-text-muted)]">
                                {num(item.reorderLevel).toFixed(2)} {item.unitCode}
                              </td>
                              {(can('purchase.record.create') || can('inventory.transaction.create')) ? (
                                <td className="px-4 py-2.5 text-right">
                                  <Link
                                    href={`/inventory/receive?itemId=${encodeURIComponent(item.itemId)}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#FFF0EE] text-[#D9362B] hover:bg-[#D9362B] hover:text-white text-[10px] font-semibold transition-colors"
                                  >
                                    <Icon name="plus" className="h-2.5 w-2.5" />
                                    Receive
                                  </Link>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm p-6 flex flex-col items-center justify-center text-center h-full min-h-[160px]">
                    <div className="h-10 w-10 rounded-xl bg-[var(--color-success-bg)] flex items-center justify-center mb-2">
                      <Icon name="check" className="h-5 w-5 text-[var(--color-success)]" />
                    </div>
                    <h3 className="text-xs font-bold text-[var(--color-text)]">Inventory Levels Healthy</h3>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1 max-w-xs">No items below reorder thresholds.</p>
                    {can('inventory.stock.read') ? (
                      <Link href="/inventory/stock" className="mt-3 text-[11px] font-semibold text-[#D9362B] hover:text-[#A8201A] flex items-center gap-1">
                        Check Stock <Icon name="chevronRight" className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Wastage Summary — 40% (2/5) */}
              <div className="lg:col-span-2">
                {data.wastage && num(data.wastage.value) > 0 && data.wastage.topItems && data.wastage.topItems.length > 0 ? (
                  <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden h-full">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-[var(--color-surface)] flex items-center justify-center flex-shrink-0 border border-[var(--color-border)]">
                          <Icon name="package" className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                        </div>
                        <div>
                          <h2 className="text-xs font-bold text-[var(--color-text)]">Wastage</h2>
                          <p className="text-[10px] text-[var(--color-text-muted)]">Loss: {money(data.wastage.value)}</p>
                        </div>
                      </div>
                      {can('analytics.wastage.read') ? (
                        <Link href="/reports/wastage" className="text-[11px] font-semibold text-[#D9362B] hover:text-[#A8201A] flex items-center gap-0.5 transition-colors">
                          Report <Icon name="chevronRight" className="h-3 w-3" />
                        </Link>
                      ) : null}
                    </div>

                    <ul className="divide-y divide-[var(--color-border)]">
                      {data.wastage.topItems.slice(0, 4).map((item) => (
                        <li key={item.itemId} className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--color-surface-muted)] transition-colors">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-[var(--color-text)] truncate">{item.itemName}</p>
                            <p className="text-[10px] text-[var(--color-text-muted)]">{num(item.quantity).toFixed(2)} {item.unitCode}</p>
                          </div>
                          <p className="text-xs font-bold text-[var(--color-text)] tabular-nums ml-3">{money(item.approxValue)}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm p-6 flex flex-col items-center justify-center text-center h-full min-h-[160px]">
                    <div className="h-10 w-10 rounded-xl bg-[var(--color-surface-muted)] flex items-center justify-center mb-2">
                      <Icon name="package" className="h-5 w-5 text-[var(--color-text-muted)]" />
                    </div>
                    <h3 className="text-xs font-bold text-[var(--color-text)]">No Wastage Recorded</h3>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1">Zero wastage for this period.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
