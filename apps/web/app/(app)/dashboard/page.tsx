'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan, useSession } from '@/lib/auth';
import { longDate, money, qty } from '@/lib/format';
import { fetchDashboard } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { BarChart, HBarChart } from '@/features/analytics/charts';
import { errorMessage } from '@/features/analytics/report-frame';
import type { DashboardResponse } from '@/features/analytics/types';

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ChangeNote({ pct, label }: { pct: number | null | undefined; label: string }) {
  if (pct === null || pct === undefined) {
    return <p className="mt-1 text-xs text-text-muted">No comparison, {label} has no entry</p>;
  }
  const tone = pct >= 0 ? 'text-success' : 'text-danger';
  return (
    <p className={`mt-1 text-xs ${tone}`}>
      {pct >= 0 ? '+' : ''}
      {pct.toFixed(1)}% vs {label}
    </p>
  );
}

function Tile({
  label,
  value,
  children,
  href,
  hrefLabel,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <Card className="flex min-h-[7.5rem] flex-col justify-between p-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-text">{value}</p>
        {children}
      </div>
      {href ? (
        <Link
          href={href}
          className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {hrefLabel ?? 'View'}
        </Link>
      ) : null}
    </Card>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
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

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Dashboard"
        description={
          data?.businessDate
            ? `Business day ${longDate(`${data.businessDate}T00:00:00.000Z`)}`
            : 'Today at a glance'
        }
      />

      {query.isPending ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Skeleton className="h-30 w-full" />
            <Skeleton className="h-30 w-full" />
            <Skeleton className="h-30 w-full" />
            <Skeleton className="h-30 w-full" />
          </div>
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !data ? null : (
        <>
          {data.errors && data.errors.length > 0 ? (
            <p role="status" className="rounded-md bg-warning-bg p-3 text-sm text-warning">
              Some tiles could not be calculated: {data.errors.join(', ')}. The rest of this page
              is correct.
            </p>
          ) : null}

          {isBlank(data) ? (
            <Card className="border-dashed p-4">
              <h2 className="text-base font-semibold text-text">
                Nothing has been recorded yet
              </h2>
              <p className="mt-1 text-sm text-text">
                This outlet has no sales, stock movements or tasks for the current period, so
                every figure below is a real zero rather than a loading failure. Enter the day&apos;s
                takings once the counter has closed and this page fills in.
              </p>
              {can('sales.entry.create') ? (
                <Link
                  href="/sales/entry"
                  className="mt-3 inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Enter today&apos;s sales
                </Link>
              ) : null}
            </Card>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.netSalesToday ? (
              <Tile
                label="Net sales today"
                value={money(data.netSalesToday.total)}
                href={can('analytics.sales.read') ? '/reports/sales' : undefined}
                hrefLabel="Sales report"
              >
                {(data.netSalesToday.byOutlet ?? []).map((o) => (
                  <p key={o.outletId} className="mt-0.5 text-xs text-text-muted">
                    {o.outletCode} {money(o.netSales)}
                  </p>
                ))}
                <ChangeNote
                  pct={data.netSalesToday.changePctVsSameDayLastWeek}
                  label="same day last week"
                />
              </Tile>
            ) : null}

            {data.netSalesMtd ? (
              <Tile label="Net sales month to date" value={money(data.netSalesMtd.total)}>
                <ChangeNote pct={data.netSalesMtd.changePctVsLastMonth} label="last month" />
                {data.netSalesMtd.daysExpected !== undefined ? (
                  <p className="mt-1 text-xs text-text-muted">
                    {data.netSalesMtd.daysEntered ?? 0} of {data.netSalesMtd.daysExpected} days
                    entered
                  </p>
                ) : null}
              </Tile>
            ) : null}

            {data.todaysSalesEntry ? (
              <Tile
                label="Today's sales entry"
                value={
                  data.todaysSalesEntry.entered
                    ? money(data.todaysSalesEntry.netSales ?? '0.00')
                    : 'Not entered'
                }
                href={can('sales.entry.create') ? '/sales/entry' : undefined}
                hrefLabel={data.todaysSalesEntry.entered ? 'Review' : 'Enter now'}
              >
                {!data.todaysSalesEntry.entered ? (
                  <p className="mt-1 text-xs text-warning">
                    The day is not closed until this is typed in
                  </p>
                ) : null}
              </Tile>
            ) : null}

            {data.missingSalesEntries ? (
              <Tile
                label="Missing sales entries"
                value={String(data.missingSalesEntries.count)}
                href={can('sales.entry.create') ? '/sales/entry' : undefined}
                hrefLabel="Enter now"
              >
                {(data.missingSalesEntries.entries ?? []).slice(0, 3).map((e) => (
                  <p key={`${e.outletId}-${e.businessDate}`} className="mt-0.5 text-xs text-text-muted">
                    {e.outletCode} {e.businessDate}
                  </p>
                ))}
              </Tile>
            ) : null}

            {data.grossMargin && can('analytics.pnl.read') ? (
              <Tile
                label="Gross margin (approx)"
                value={money(data.grossMargin.grossMarginApprox)}
                href="/reports/pnl"
                hrefLabel="Gross margin report"
              >
                {data.grossMargin.grossMarginPct !== null &&
                data.grossMargin.grossMarginPct !== undefined ? (
                  <p className="mt-1 text-xs text-text-muted">
                    {(data.grossMargin.grossMarginPct * 100).toFixed(1)}% of net sales
                  </p>
                ) : null}
                <p className="mt-1 text-xs font-medium text-warning">
                  Approximation, not profit
                </p>
              </Tile>
            ) : null}

            {data.lowStock && can('inventory.stock.read') ? (
              <Tile
                label="Low stock items"
                value={String(data.lowStock.count)}
                href="/inventory/stock"
                hrefLabel="View inventory"
              />
            ) : null}

            {data.overdueTasks ? (
              <Tile
                label="Overdue tasks"
                value={String(data.overdueTasks.count)}
                href={can('task.task.read') ? '/tasks?status=OVERDUE' : undefined}
                hrefLabel="View tasks"
              >
                {(data.overdueTasks.byOutlet ?? []).map((o) => (
                  <p key={o.outletCode} className="mt-0.5 text-xs text-text-muted">
                    {o.outletCode} {o.count}
                  </p>
                ))}
              </Tile>
            ) : null}

            {data.openTasks ? (
              <Tile
                label="Open tasks"
                value={String(data.openTasks.count)}
                href={can('task.task.read') ? '/tasks' : undefined}
                hrefLabel="View tasks"
              />
            ) : null}

            {data.checklistsDueToday ? (
              <Tile label="Checklists due today" value={String(data.checklistsDueToday.count)} />
            ) : null}

            {data.failedAuditItems ? (
              <Tile label="Failed audit items, 7 days" value={String(data.failedAuditItems.count)} />
            ) : null}

            {data.wastage && can('analytics.waste.read') ? (
              <Tile
                label="Wastage value"
                value={money(data.wastage.value)}
                href="/reports/wastage"
                hrefLabel="Wastage report"
              >
                <p className="mt-1 text-xs text-text-muted">Approximate, latest purchase price</p>
              </Tile>
            ) : null}

            {data.pendingApprovals ? (
              <Tile
                label="Pending approvals"
                value={String(
                  data.pendingApprovals.purchaseRequests + data.pendingApprovals.leaveRequests,
                )}
                href={can('purchase.request.approve') ? '/purchases/requests' : undefined}
                hrefLabel="Review"
              >
                <p className="mt-1 text-xs text-text-muted">
                  {data.pendingApprovals.purchaseRequests} purchase,{' '}
                  {data.pendingApprovals.leaveRequests} leave
                </p>
              </Tile>
            ) : null}
          </div>

          {data.salesSeries ? (
            <Panel
              title="Net sales, recent days"
              action={
                can('analytics.sales.read') ? (
                  <Link
                    href="/reports/sales"
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Sales report
                  </Link>
                ) : null
              }
            >
              {data.salesSeries.length === 0 ||
              data.salesSeries.every((p) => num(p.netSales) === 0) ? (
                <p className="py-8 text-center text-sm text-text-muted">
                  No sales recorded for this range.
                </p>
              ) : (
                <BarChart
                  title="Net sales by business date"
                  rows={data.salesSeries.map((p) => ({
                    label: p.businessDate.slice(8),
                    values: { net: num(p.netSales) },
                  }))}
                  series={[{ key: 'net', label: 'Net sales' }]}
                  formatValue={(v) => money(v.toFixed(2))}
                />
              )}
            </Panel>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            {data.lowStock && can('inventory.stock.read') ? (
              <Panel
                title={`Low stock, ${data.lowStock.count} item${data.lowStock.count === 1 ? '' : 's'}`}
                action={
                  <Link
                    href="/inventory/stock"
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    View inventory
                  </Link>
                }
              >
                {(data.lowStock.items ?? []).length === 0 ? (
                  <p className="text-sm text-text-muted">
                    Every item is at or above its reorder level.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(data.lowStock.items ?? []).map((item) => (
                      <li key={`${item.itemId}-${item.outletCode ?? ''}`} className="py-2">
                        <Link
                          href={`/inventory/items/${item.itemId}`}
                          className="flex min-h-[44px] items-center justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0 truncate text-text">
                            {item.itemName}
                            {item.outletCode ? (
                              <span className="ml-1 text-text-muted">{item.outletCode}</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-text-muted">
                            {qty(item.qtyOnHand, item.unitCode)} / {qty(item.reorderLevel)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ) : null}

            {data.attendance && can('workforce.attendance.read') ? (
              <Panel
                title="Attendance"
                action={
                  <Link
                    href="/attendance/board"
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Attendance board
                  </Link>
                }
              >
                {(data.attendance.byOutlet ?? []).length === 0 ? (
                  <p className="text-sm text-text-muted">Nobody has punched in yet today.</p>
                ) : (
                  <ul className="space-y-2">
                    {(data.attendance.byOutlet ?? []).map((o) => (
                      <li key={o.outletCode} className="flex justify-between text-sm">
                        <span className="text-text">{o.outletCode}</span>
                        <span className="tabular-nums text-text-muted">
                          {o.present} of {o.expected} in
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ) : null}

            {data.wastage && can('analytics.waste.read') ? (
              <Panel
                title="Top wastage"
                action={
                  <Link
                    href="/reports/wastage"
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Wastage report
                  </Link>
                }
              >
                {(data.wastage.topItems ?? []).length === 0 ? (
                  <p className="text-sm text-text-muted">
                    No wastage has been recorded in this period.
                  </p>
                ) : (
                  <HBarChart
                    title="Wastage by approximate value"
                    rows={(data.wastage.topItems ?? []).map((item) => ({
                      label: item.itemName,
                      value: num(item.approxValue),
                      sublabel: `${qty(item.quantity, item.unitCode)} · ${money(item.approxValue)}`,
                    }))}
                    formatValue={(v) => money(v.toFixed(2))}
                  />
                )}
              </Panel>
            ) : null}
          </div>

          {user ? (
            <p className="pt-2 text-xs text-text-muted">
              Signed in as {user.fullName}{' '}
              <Badge>{user.roleKey.toLowerCase().replaceAll('_', ' ')}</Badge>. You are seeing the
              figures your role can read.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
