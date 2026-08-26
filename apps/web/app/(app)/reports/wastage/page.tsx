'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import { money, qty } from '@/lib/format';
import { fetchWaste } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { HBarChart } from '@/features/analytics/charts';
import { csvFilename, downloadCsv, toCsv } from '@/features/analytics/csv';
import {
  ReportBody,
  ReportFilters,
  outletCodeFor,
  useOutletOptions,
  useReportRange,
} from '@/features/analytics/report-frame';
import { ReportTable, orDash } from '@/features/analytics/table';
import type { WasteResponse, WasteRow } from '@/features/analytics/types';

function num(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowLabel(row: WasteRow, groupBy: string): string {
  if (groupBy === 'reason') return row.reason ?? 'No reason given';
  if (groupBy === 'category') return row.categoryName ?? 'Uncategorised';
  return row.itemName ?? row.sku ?? 'Unknown item';
}

export default function WastageReportPage() {
  const range = useReportRange(29, 92);
  const outlets = useOutletOptions();
  const [groupBy, setGroupBy] = useState<'item' | 'category' | 'reason'>('item');

  const filters = {
    from: range.from,
    to: range.to,
    outletId: range.outletId || undefined,
    groupBy,
  };

  const query = useQuery({
    queryKey: analyticsKeys.waste(filters),
    queryFn: () => fetchWaste(filters),
    enabled: range.rangeError === null,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  function exportCsv(data: WasteResponse) {
    const csv = toCsv(
      [
        'sku',
        'item_name',
        'category_name',
        'unit_code',
        'outlet_code',
        'reason',
        'wastage_qty',
        'approx_value',
        'event_count',
      ],
      data.rows.map((row) => [
        row.sku,
        row.itemName,
        row.categoryName,
        row.unitCode,
        row.outletCode ?? '',
        row.reason,
        row.wastageQty,
        row.approxValue,
        row.eventCount,
      ]),
    );
    downloadCsv(
      csvFilename('waste', outletCodeFor(outlets.data?.data, range.outletId), range.from, range.to),
      csv,
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Wastage report" description="What is being thrown away, and what it cost" />

      <ReportFilters
        range={range}
        actions={
          query.data ? (
            <Button type="button" variant="secondary" onClick={() => exportCsv(query.data)}>
              Download CSV
            </Button>
          ) : null
        }
      >
        <div>
          <Label htmlFor="waste-group">Group by</Label>
          <Select
            id="waste-group"
            value={groupBy}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setGroupBy(e.target.value as 'item' | 'category' | 'reason')
            }
          >
            <option value="item">Item</option>
            <option value="category">Category</option>
            <option value="reason">Reason</option>
          </Select>
        </div>
      </ReportFilters>

      <p className="rounded-md bg-surface-muted p-3 text-sm text-text">
        Value is an approximation. It multiplies the wasted quantity by the most recent purchase
        price recorded for that item on or before the date of the wastage, from any vendor. It is
        not FIFO costing and it is not an accounting valuation.
      </p>

      <ReportBody
        query={query}
        blocked={range.rangeError}
        onRetry={() => void query.refetch()}
        isEmpty={(data: WasteResponse) => data.rows.length === 0}
        emptyTitle="No wastage recorded in this range"
        emptyDescription="Nothing was written off between these dates. Either the kitchen wasted nothing, or wastage is not being recorded on the stock entry screen."
      >
        {(data: WasteResponse) => (
          <div className="space-y-4">
            {data.totals ? (
              <Card className="p-3">
                <p className="text-xs uppercase tracking-wide text-text-muted">
                  Approximate value wasted
                </p>
                <p className="text-2xl font-semibold tabular-nums text-text">
                  {money(data.totals.approxValue)}
                </p>
                {data.totals.unpricedRowCount ? (
                  <p className="mt-1 text-sm text-warning">
                    {data.totals.unpricedRowCount} row
                    {data.totals.unpricedRowCount === 1 ? '' : 's'} could not be priced because the
                    item has never been purchased through the system, so the real figure is higher.
                  </p>
                ) : null}
              </Card>
            ) : null}

            <Card className="p-3">
              <h2 className="mb-2 text-sm font-semibold text-text">By approximate value</h2>
              <HBarChart
                title="Wastage by approximate value"
                rows={data.rows.slice(0, 15).map((row) => ({
                  label: rowLabel(row, groupBy),
                  value: num(row.approxValue),
                  sublabel: `${qty(row.wastageQty, row.unitCode)} over ${row.eventCount} event${
                    row.eventCount === 1 ? '' : 's'
                  }`,
                }))}
                formatValue={(v) => money(v.toFixed(2))}
              />
            </Card>

            <ReportTable<WasteRow>
              caption="Wastage rows"
              rows={data.rows}
              rowKey={(row, index) => `${row.itemId ?? row.categoryName ?? row.reason ?? ''}-${index}`}
              columns={[
                { key: 'group', header: 'Item', cell: (row) => rowLabel(row, groupBy) },
                { key: 'category', header: 'Category', cell: (row) => orDash(row.categoryName) },
                { key: 'outlet', header: 'Outlet', cell: (row) => row.outletCode ?? 'All' },
                { key: 'reason', header: 'Reason', cell: (row) => orDash(row.reason) },
                {
                  key: 'qty',
                  header: 'Quantity',
                  align: 'right',
                  cell: (row) => qty(row.wastageQty, row.unitCode),
                },
                {
                  key: 'value',
                  header: 'Approx value',
                  align: 'right',
                  cell: (row) => (row.approxValue === null ? 'not priced' : money(row.approxValue)),
                },
                {
                  key: 'events',
                  header: 'Events',
                  align: 'right',
                  cell: (row) => String(row.eventCount),
                },
              ]}
            />
          </div>
        )}
      </ReportBody>
    </div>
  );
}
