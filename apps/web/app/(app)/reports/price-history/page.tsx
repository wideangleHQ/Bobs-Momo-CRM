'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { money } from '@/lib/format';
import { fetchPriceHistory } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { LineChart, type ChartRow, type ChartSeries } from '@/features/analytics/charts';
import { csvFilename, downloadCsv, toCsv } from '@/features/analytics/csv';
import {
  ReportBody,
  ReportFilters,
  useReportRange,
} from '@/features/analytics/report-frame';
import { ReportTable } from '@/features/analytics/table';
import type { PriceHistoryResponse, PriceHistoryRow } from '@/features/analytics/types';

function num(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function PriceTrendReportPage() {
  const range = useReportRange(89, 366);
  const [item, setItem] = useState<{ id: string; name: string; unitCode: string } | null>(null);

  const filters = { from: range.from, to: range.to, itemId: item?.id };

  const query = useQuery({
    queryKey: analyticsKeys.priceHistory(filters),
    queryFn: () => fetchPriceHistory(filters),
    enabled: range.rangeError === null,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const chart = useMemo(() => {
    const rows = (query.data?.data ?? []).filter((row) => !row.purchaseVoided);
    const vendors = Array.from(new Set(rows.map((row) => row.vendor?.name ?? 'No vendor')));
    const series: ChartSeries[] = vendors.map((name) => ({ key: name, label: name }));
    const byDate = new Map<string, ChartRow>();
    for (const row of rows) {
      const existing = byDate.get(row.observedOn) ?? {
        label: row.observedOn.slice(5),
        values: {},
      };
      existing.values[row.vendor?.name ?? 'No vendor'] = num(row.unitPrice);
      byDate.set(row.observedOn, existing);
    }
    const ordered = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, value]) => value);
    return { series, rows: ordered };
  }, [query.data]);

  function exportCsv(data: PriceHistoryResponse) {
    const csv = toCsv(
      ['observed_on', 'item_name', 'unit_code', 'vendor_name', 'unit_price', 'purchase_no', 'purchase_voided'],
      data.data.map((row) => [
        row.observedOn,
        row.itemName,
        row.unitCode,
        row.vendor?.name ?? '',
        row.unitPrice,
        row.purchaseNo ?? '',
        row.purchaseVoided ? 'true' : 'false',
      ]),
    );
    downloadCsv(
      csvFilename('price_history', item ? item.name.replaceAll(' ', '_') : 'all', range.from, range.to),
      csv,
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Price trend"
        description="What each item has cost, observation by observation"
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

      {item ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-muted p-3">
          <p className="text-sm text-text">Showing the price line for {item.name}</p>
          <Button type="button" variant="secondary" onClick={() => setItem(null)}>
            Back to all items
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Pick an item name in the table to draw its price line, one series per vendor.
        </p>
      )}

      <ReportBody
        query={query}
        blocked={range.rangeError}
        onRetry={() => void query.refetch()}
        isEmpty={(data: PriceHistoryResponse) => data.data.length === 0}
        emptyTitle="No price observations in this range"
        emptyDescription="Prices are recorded when a purchase is entered. Record a vendor bill on the purchase screen and the price appears here."
      >
        {(data: PriceHistoryResponse) => (
          <div className="space-y-4">
            {item && chart.rows.length > 0 ? (
              <Card className="p-3">
                <h2 className="mb-2 text-sm font-semibold text-text">
                  {item.name}, price per {item.unitCode}
                </h2>
                <LineChart
                  title={`Unit price observations for ${item.name}`}
                  rows={chart.rows}
                  series={chart.series}
                  formatValue={(v) => money(v.toFixed(2))}
                  height={240}
                />
                <p className="mt-2 text-xs text-text-muted">
                  Observations from voided purchases are left out of the line but still listed
                  below.
                </p>
              </Card>
            ) : null}

            <ReportTable<PriceHistoryRow>
              caption="Price observations"
              rows={data.data}
              rowKey={(row) => row.id}
              columns={[
                { key: 'date', header: 'Observed on', cell: (row) => row.observedOn },
                {
                  key: 'item',
                  header: 'Item',
                  cell: (row) => (
                    <button
                      type="button"
                      className="min-h-[44px] text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() =>
                        setItem({ id: row.itemId, name: row.itemName, unitCode: row.unitCode })
                      }
                    >
                      {row.itemName}
                    </button>
                  ),
                },
                { key: 'unit', header: 'Unit', cell: (row) => row.unitCode },
                { key: 'vendor', header: 'Vendor', cell: (row) => row.vendor?.name ?? 'No vendor' },
                {
                  key: 'price',
                  header: 'Unit price',
                  align: 'right',
                  cell: (row) => money(row.unitPrice),
                },
                {
                  key: 'purchase',
                  header: 'Purchase',
                  cell: (row) =>
                    row.purchaseVoided ? `${row.purchaseNo ?? ''} (voided)` : row.purchaseNo ?? '',
                },
              ]}
            />

            {data.meta.total > data.data.length ? (
              <p className="text-sm text-text-muted">
                Showing the {data.data.length} most recent of {data.meta.total} observations.
                Narrow the dates or pick an item to see the rest.
              </p>
            ) : null}
          </div>
        )}
      </ReportBody>
    </div>
  );
}
