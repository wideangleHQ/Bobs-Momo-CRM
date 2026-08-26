'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { money } from '@/lib/format';
import { fetchSalesReport } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { BarChart, type ChartRow, type ChartSeries } from '@/features/analytics/charts';
import { csvFilename, downloadCsv, toCsv } from '@/features/analytics/csv';
import {
  ReportBody,
  ReportFilters,
  outletCodeFor,
  useOutletOptions,
  useReportRange,
} from '@/features/analytics/report-frame';
import { ReportTable, orDash, signedPct } from '@/features/analytics/table';
import type { SalesReportResponse, SalesReportRow } from '@/features/analytics/types';

function num(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function SalesReportPage() {
  const range = useReportRange(13, 366);
  const outlets = useOutletOptions();
  const filters = { from: range.from, to: range.to, outletId: range.outletId || undefined };

  const query = useQuery({
    queryKey: analyticsKeys.sales(filters),
    queryFn: () => fetchSalesReport(filters),
    enabled: range.rangeError === null,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const chart = useMemo(() => {
    const rows = query.data?.rows ?? [];
    const codes = Array.from(new Set(rows.map((r) => r.outletCode ?? 'All')));
    const series: ChartSeries[] = codes.map((code) => ({ key: code, label: code }));
    const byDate = new Map<string, ChartRow>();
    for (const row of rows) {
      const label = row.businessDate.slice(5);
      const existing = byDate.get(row.businessDate) ?? { label, values: {} };
      existing.values[row.outletCode ?? 'All'] = num(row.netSales);
      byDate.set(row.businessDate, existing);
    }
    const ordered = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, value]) => value);
    return { series, rows: ordered };
  }, [query.data]);

  const mix = useMemo(() => {
    const rows = query.data?.rows ?? [];
    const byDate = new Map<string, ChartRow>();
    for (const row of rows) {
      const label = row.businessDate.slice(5);
      const existing = byDate.get(row.businessDate) ?? { label, values: {} };
      for (const key of ['cash', 'upi', 'card', 'other'] as const) {
        existing.values[key] = (existing.values[key] ?? 0) + num(row.paymentMix?.[key]);
      }
      byDate.set(row.businessDate, existing);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, value]) => value);
  }, [query.data]);

  function exportCsv(data: SalesReportResponse) {
    const csv = toCsv(
      [
        'business_date',
        'outlet_code',
        'gross_sales',
        'discounts',
        'net_sales',
        'order_count',
        'avg_order_value',
        'cash',
        'upi',
        'card',
        'other',
      ],
      data.rows.map((row) => [
        row.businessDate,
        row.outletCode ?? '',
        row.grossSales,
        row.discounts,
        row.netSales,
        row.orderCount,
        row.avgOrderValue,
        row.paymentMix?.cash,
        row.paymentMix?.upi,
        row.paymentMix?.card,
        row.paymentMix?.other,
      ]),
    );
    downloadCsv(
      csvFilename('sales', outletCodeFor(outlets.data?.data, range.outletId), range.from, range.to),
      csv,
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Sales report" description="Net sales by business day and outlet" />

      <ReportFilters
        range={range}
        actions={
          query.data ? (
            <Button type="button" variant="secondary" onClick={() => exportCsv(query.data)}>
              Download CSV
            </Button>
          ) : null
        }
      />

      <ReportBody
        query={query}
        blocked={range.rangeError}
        onRetry={() => void query.refetch()}
        isEmpty={(data: SalesReportResponse) => data.rows.length === 0}
        emptyTitle="No sales entered for this range"
        emptyDescription="Nobody has closed a day between these dates. Enter a day on the sales screen and it appears here."
      >
        {(data: SalesReportResponse) => (
          <div className="space-y-4">
            {data.missingDates.length > 0 ? (
              <p className="rounded-md bg-warning-bg p-3 text-sm text-warning">
                {data.missingDates.length} day{data.missingDates.length === 1 ? '' : 's'} in this
                range have no entry ({data.missingDates.join(', ')}), so the totals below are lower
                than the business actually did.
              </p>
            ) : null}

            <Card className="p-3">
              <h2 className="mb-2 text-sm font-semibold text-text">Net sales by day</h2>
              <BarChart
                title="Net sales by business day"
                rows={chart.rows}
                series={chart.series}
                formatValue={(v) => money(v.toFixed(2))}
                height={240}
              />
            </Card>

            <Card className="p-3">
              <h2 className="mb-2 text-sm font-semibold text-text">Payment mix</h2>
              <BarChart
                title="Payment mix by business day"
                stacked
                rows={mix}
                series={[
                  { key: 'cash', label: 'Cash' },
                  { key: 'upi', label: 'UPI' },
                  { key: 'card', label: 'Card' },
                  { key: 'other', label: 'Other' },
                ]}
                formatValue={(v) => money(v.toFixed(2))}
                height={200}
              />
            </Card>

            <ReportTable<SalesReportRow>
              caption="Net sales per day with comparisons"
              rows={data.rows}
              rowKey={(row, index) => `${row.businessDate}-${row.outletCode ?? index}`}
              columns={[
                { key: 'date', header: 'Business date', cell: (row) => row.businessDate },
                { key: 'outlet', header: 'Outlet', cell: (row) => row.outletCode ?? 'All' },
                { key: 'gross', header: 'Gross', align: 'right', cell: (row) => money(row.grossSales) },
                {
                  key: 'discounts',
                  header: 'Discounts',
                  align: 'right',
                  cell: (row) => money(row.discounts),
                },
                { key: 'net', header: 'Net', align: 'right', cell: (row) => money(row.netSales) },
                {
                  key: 'orders',
                  header: 'Orders',
                  align: 'right',
                  cell: (row) => orDash(row.orderCount),
                },
                {
                  key: 'aov',
                  header: 'Avg order',
                  align: 'right',
                  cell: (row) => (row.avgOrderValue ? money(row.avgOrderValue) : 'no data'),
                },
                {
                  key: 'prev',
                  header: 'vs previous day',
                  align: 'right',
                  cell: (row) => signedPct(row.prevDayChangePct),
                },
                {
                  key: 'lw',
                  header: 'vs same day last week',
                  align: 'right',
                  cell: (row) => signedPct(row.sameDayLastWeekChangePct),
                },
              ]}
            />
          </div>
        )}
      </ReportBody>
    </div>
  );
}
