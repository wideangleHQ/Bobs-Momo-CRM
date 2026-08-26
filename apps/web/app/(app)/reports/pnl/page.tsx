'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { money } from '@/lib/format';
import { fetchPnl } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { BarChart } from '@/features/analytics/charts';
import { csvFilename, downloadCsv, toCsv } from '@/features/analytics/csv';
import {
  ReportBody,
  ReportFilters,
  outletCodeFor,
  useOutletOptions,
  useReportRange,
} from '@/features/analytics/report-frame';
import { ReportTable, pct } from '@/features/analytics/table';
import type { PnlResponse, PnlRow } from '@/features/analytics/types';

function num(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

// The API sends the caveat. This stands in only when it does not, because a
// margin figure with no warning next to it is the failure this screen exists
// to prevent: a manager reading an approximation as profit.
const FALLBACK_CAVEAT =
  'Approximation. Net sales entered by the outlet, less purchases recorded in the same period. Excludes labour, rent, utilities, taxes, aggregator commission and inventory valuation. Not an accounting P&L.';

export default function GrossMarginReportPage() {
  const range = useReportRange(29, 366);
  const outlets = useOutletOptions();
  const filters = { from: range.from, to: range.to, outletId: range.outletId || undefined };

  const query = useQuery({
    queryKey: analyticsKeys.pnl(filters),
    queryFn: () => fetchPnl(filters),
    enabled: range.rangeError === null,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  function exportCsv(data: PnlResponse) {
    const csv = toCsv(
      [
        'outlet_code',
        'from',
        'to',
        'net_sales',
        'purchase_cost',
        'gross_margin_approx',
        'gross_margin_pct',
        'wastage_value',
        'days_with_entry',
      ],
      data.rows.map((row) => [
        row.code,
        range.from,
        range.to,
        row.netSales,
        row.purchaseCost,
        row.grossMarginApprox,
        row.grossMarginPct,
        row.wastageValue,
        row.daysWithEntry,
      ]),
    );
    downloadCsv(
      csvFilename('pnl', outletCodeFor(outlets.data?.data, range.outletId), range.from, range.to),
      csv,
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Gross margin"
        description="Net sales less recorded purchases, per outlet"
      />

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
        isEmpty={(data: PnlResponse) => data.rows.length === 0}
        emptyTitle="No outlets in scope"
        emptyDescription="There are no outlets you can read a margin for. Ask an administrator about your outlet assignment."
      >
        {(data: PnlResponse) => {
          const caveats = data.caveats ?? (data.caveat ? [data.caveat] : [FALLBACK_CAVEAT]);
          return (
            <div className="space-y-4">
              {data.rows.map((row) => (
                <Card key={row.id} className="overflow-hidden">
                  <div className="border-b border-border px-3 py-2">
                    <h2 className="font-semibold text-text">{row.code}</h2>
                  </div>

                  {/* The caveat sits beside the figure at the same size, not under it. */}
                  <div className="grid gap-0 lg:grid-cols-2">
                    <div className="p-3">
                      <p className="text-xs uppercase tracking-wide text-text-muted">
                        Gross margin (approximate)
                      </p>
                      <p className="text-2xl font-semibold tabular-nums text-text">
                        {money(row.grossMarginApprox)}
                      </p>
                      <p className="text-base text-text">
                        {row.grossMarginPct === null
                          ? 'No margin percentage, there are no net sales in this range'
                          : `${pct(row.grossMarginPct)} of net sales`}
                      </p>
                    </div>

                    <div className="border-t border-warning/40 bg-warning-bg p-3 lg:border-l lg:border-t-0">
                      <p className="text-base font-semibold text-warning">
                        This is an approximation, not profit
                      </p>
                      {caveats.map((line) => (
                        <p key={line} className="mt-1 text-base text-warning">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 border-t border-border p-3 lg:grid-cols-4">
                    <Figure label="Net sales" value={money(row.netSales)} />
                    <Figure label="Purchases recorded" value={money(row.purchaseCost)} />
                    <Figure
                      label="Wastage value (approx)"
                      value={money(row.wastageValue)}
                    />
                    <Figure
                      label="Days with an entry"
                      value={
                        row.daysInRange
                          ? `${row.daysWithEntry} of ${row.daysInRange}`
                          : String(row.daysWithEntry)
                      }
                    />
                  </dl>

                  {row.daysInRange && row.daysWithEntry < row.daysInRange ? (
                    <p className="px-3 pb-3 text-sm text-warning">
                      {row.daysInRange - row.daysWithEntry} day
                      {row.daysInRange - row.daysWithEntry === 1 ? '' : 's'} in this range have no
                      sales entry, so the margin above is understated on the revenue side.
                    </p>
                  ) : null}
                </Card>
              ))}

              <Card className="p-3">
                <h2 className="mb-2 text-sm font-semibold text-text">
                  Sales against purchases
                </h2>
                <BarChart
                  title="Net sales and recorded purchases per outlet"
                  rows={data.rows.map((row) => ({
                    label: row.code,
                    values: {
                      sales: num(row.netSales),
                      purchases: num(row.purchaseCost),
                    },
                  }))}
                  series={[
                    { key: 'sales', label: 'Net sales' },
                    { key: 'purchases', label: 'Purchases recorded' },
                  ]}
                  formatValue={(v) => money(v.toFixed(2))}
                  height={220}
                />
                <p className="mt-2 text-sm text-text">
                  The gap between the two bars is the approximate margin. A single large delivery
                  on the last day of a window pushes that window down and the next one up without
                  anything about the business changing, so month windows read more honestly than
                  week windows.
                </p>
              </Card>

              <ReportTable<PnlRow>
                caption="Margin per outlet"
                rows={data.rows}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'code', header: 'Outlet', cell: (row) => row.code },
                  {
                    key: 'net',
                    header: 'Net sales',
                    align: 'right',
                    cell: (row) => money(row.netSales),
                  },
                  {
                    key: 'purchases',
                    header: 'Purchases',
                    align: 'right',
                    cell: (row) => money(row.purchaseCost),
                  },
                  {
                    key: 'margin',
                    header: 'Margin (approx)',
                    align: 'right',
                    cell: (row) => money(row.grossMarginApprox),
                  },
                  {
                    key: 'pct',
                    header: 'Margin %',
                    align: 'right',
                    cell: (row) => pct(row.grossMarginPct),
                  },
                  {
                    key: 'waste',
                    header: 'Wastage (approx)',
                    align: 'right',
                    cell: (row) => money(row.wastageValue),
                  },
                  {
                    key: 'days',
                    header: 'Days entered',
                    align: 'right',
                    cell: (row) => String(row.daysWithEntry),
                  },
                ]}
              />
            </div>
          );
        }}
      </ReportBody>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tabular-nums text-text">{value}</dd>
    </div>
  );
}
