'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';
import { longDate, money, shortDate } from '@/lib/format';
import {
  ReportFilters,
  errorMessage,
  useReportRange,
} from '@/features/analytics/report-frame';
import { fetchSalesSummary, listSales, salesKeys } from './api';

export default function SalesListPage() {
  const can = useCan();
  const range = useReportRange(29, 92);
  const filters = {
    from: range.from,
    to: range.to,
    outletId: range.outletId || undefined,
  };
  const enabled = range.rangeError === null;

  const summary = useQuery({
    queryKey: salesKeys.summary(filters),
    queryFn: () => fetchSalesSummary({ from: range.from, to: range.to, outletId: filters.outletId }),
    enabled,
    staleTime: 2 * 60 * 1000,
  });

  const list = useQuery({
    queryKey: salesKeys.list({ ...filters, pageSize: 100 }),
    queryFn: () => listSales({ ...filters, pageSize: 100 }),
    enabled,
    staleTime: 2 * 60 * 1000,
  });

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Sales" description="One entry per outlet per business day" />

      <ReportFilters
        range={range}
        actions={
          can('sales.entry.create') ? (
            <Link href="/sales/entry">
              <Button type="button" className="min-h-[44px]">
                Enter a day
              </Button>
            </Link>
          ) : null
        }
      />

      {summary.data ? (
        <Card className="p-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure label="Net sales" value={money(summary.data.totals.netSales)} />
            <Figure label="Gross sales" value={money(summary.data.totals.grossSales)} />
            <Figure label="Discounts" value={money(summary.data.totals.discounts)} />
            <Figure
              label="Days entered"
              value={`${summary.data.totals.entryCount} of ${summary.data.totals.expectedEntryCount}`}
            />
          </div>
          {summary.data.totals.entryCount < summary.data.totals.expectedEntryCount ? (
            <p className="mt-3 text-sm text-warning">
              {summary.data.totals.expectedEntryCount - summary.data.totals.entryCount} day
              {summary.data.totals.expectedEntryCount - summary.data.totals.entryCount === 1
                ? ' has'
                : 's have'}{' '}
              no entry in this range, so the total above is lower than the business actually did.
            </p>
          ) : null}
        </Card>
      ) : null}

      {!enabled ? (
        <EmptyState
          title="Nothing to show yet"
          description="Fix the date range above and the days will load."
        />
      ) : list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          title="No sales entered for this range"
          description="Nobody has closed a day between these dates. Open the entry screen and type the day's takings from the counter printout."
        />
      ) : (
        <ul className="space-y-2">
          {list.data.data.map((entry) => (
            <li key={entry.id}>
              <Card className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">
                      {longDate(`${entry.businessDate}T00:00:00.000Z`)}
                    </p>
                    <p className="text-sm text-text-muted">
                      {entry.outletCode ?? ''}
                      {entry.orderCount !== null ? ` · ${entry.orderCount} orders` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold tabular-nums text-text">
                      {money(entry.netSales)}
                    </p>
                    {entry.lockedAt ? (
                      <Badge>Locked {shortDate(entry.lockedAt)}</Badge>
                    ) : (
                      <Badge>Editable</Badge>
                    )}
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                  <Figure label="Cash" value={money(entry.cashAmount)} small />
                  <Figure label="UPI" value={money(entry.upiAmount)} small />
                  <Figure label="Card" value={money(entry.cardAmount)} small />
                  <Figure label="Other" value={money(entry.otherAmount)} small />
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={small ? 'tabular-nums text-text' : 'text-lg font-semibold tabular-nums text-text'}>
        {value}
      </dd>
    </div>
  );
}
