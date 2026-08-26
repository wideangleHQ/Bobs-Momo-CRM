'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import { qty } from '@/lib/format';
import { fetchConsumption } from '@/features/analytics/api';
import { analyticsKeys } from '@/features/analytics/keys';
import { HBarChart, LineChart } from '@/features/analytics/charts';
import { csvFilename, downloadCsv, toCsv } from '@/features/analytics/csv';
import {
  ReportBody,
  ReportFilters,
  outletCodeFor,
  useOutletOptions,
  useReportRange,
} from '@/features/analytics/report-frame';
import { ReportTable } from '@/features/analytics/table';
import type { ConsumptionResponse, ConsumptionRow } from '@/features/analytics/types';

function num(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ConsumptionReportPage() {
  const range = useReportRange(29, 92);
  const outlets = useOutletOptions();
  const [type, setType] = useState<'ALL' | 'ISSUED' | 'WASTAGE'>('ALL');
  const [item, setItem] = useState<{ id: string; name: string; unitCode: string } | null>(null);

  const filters = {
    from: range.from,
    to: range.to,
    outletId: range.outletId || undefined,
    type,
    itemId: item?.id,
  };

  const query = useQuery({
    queryKey: analyticsKeys.consumption(filters),
    queryFn: () => fetchConsumption(filters),
    enabled: range.rangeError === null,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  function exportCsv(data: ConsumptionResponse) {
    const rows = data.rows ?? [];
    const csv = toCsv(
      [
        'sku',
        'item_name',
        'category_name',
        'unit_code',
        'outlet_code',
        'issued_qty',
        'wastage_qty',
        'consumed_qty',
      ],
      rows.map((row) => [
        row.sku,
        row.itemName,
        row.categoryName,
        row.unitCode,
        row.outletCode ?? '',
        row.issuedQty,
        row.wastageQty,
        row.consumedQty,
      ]),
    );
    downloadCsv(
      csvFilename(
        'consumption',
        outletCodeFor(outlets.data?.data, range.outletId),
        range.from,
        range.to,
      ),
      csv,
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Consumption report"
        description="Issued plus wastage, in each item's own unit"
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
      >
        <div>
          <Label htmlFor="consumption-type">Movement</Label>
          <Select
            id="consumption-type"
            value={type}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setType(e.target.value as 'ALL' | 'ISSUED' | 'WASTAGE')
            }
          >
            <option value="ALL">Issued and wastage</option>
            <option value="ISSUED">Issued only</option>
            <option value="WASTAGE">Wastage only</option>
          </Select>
        </div>
      </ReportFilters>

      <p className="text-sm text-text-muted">
        Consumption is what staff recorded leaving the shelf, not what the kitchen physically used.
        Quantities are never converted between units, so a kilogram row and a piece row are
        separate lines.
      </p>

      {item ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-muted p-3">
          <p className="text-sm text-text">Showing the daily series for {item.name}</p>
          <Button type="button" variant="secondary" onClick={() => setItem(null)}>
            Back to all items
          </Button>
        </div>
      ) : null}

      <ReportBody
        query={query}
        blocked={range.rangeError}
        onRetry={() => void query.refetch()}
        isEmpty={(data: ConsumptionResponse) =>
          (data.rows ?? []).length === 0 && (data.series ?? []).length === 0
        }
        emptyTitle="Nothing was issued or wasted in this range"
        emptyDescription="No stock movements of these types were recorded between these dates. Record issues and wastage on the stock entry screen and they appear here."
      >
        {(data: ConsumptionResponse) =>
          item && data.series ? (
            <Card className="p-3">
              <h2 className="mb-2 text-sm font-semibold text-text">
                {item.name}, per business day
              </h2>
              <LineChart
                title={`Issued and wastage per day for ${item.name}`}
                rows={data.series.map((point) => ({
                  label: point.businessDate.slice(5),
                  values: {
                    issued: num(point.issuedQty),
                    wastage: num(point.wastageQty),
                  },
                }))}
                series={[
                  { key: 'issued', label: 'Issued' },
                  { key: 'wastage', label: 'Wastage' },
                ]}
                formatValue={(v) => qty(v.toFixed(3), item.unitCode)}
                height={240}
              />
            </Card>
          ) : (
            <div className="space-y-4">
              <Card className="p-3">
                <h2 className="mb-2 text-sm font-semibold text-text">
                  Most consumed, top {Math.min(20, (data.rows ?? []).length)}
                </h2>
                <HBarChart
                  title="Consumed quantity by item"
                  rows={(data.rows ?? []).slice(0, 20).map((row) => ({
                    label: `${row.itemName} (${row.unitCode})`,
                    value: num(row.consumedQty),
                    sublabel: `issued ${qty(row.issuedQty)} · wasted ${qty(row.wastageQty)}`,
                  }))}
                  formatValue={(v) => v.toFixed(3)}
                />
              </Card>

              <ReportTable<ConsumptionRow>
                caption="Consumption per item"
                rows={data.rows ?? []}
                rowKey={(row, index) => `${row.itemId}-${row.outletCode ?? index}`}
                columns={[
                  { key: 'sku', header: 'SKU', cell: (row) => row.sku },
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
                  { key: 'category', header: 'Category', cell: (row) => row.categoryName },
                  { key: 'outlet', header: 'Outlet', cell: (row) => row.outletCode ?? 'All' },
                  {
                    key: 'issued',
                    header: 'Issued',
                    align: 'right',
                    cell: (row) => qty(row.issuedQty, row.unitCode),
                  },
                  {
                    key: 'wastage',
                    header: 'Wastage',
                    align: 'right',
                    cell: (row) => qty(row.wastageQty, row.unitCode),
                  },
                  {
                    key: 'consumed',
                    header: 'Consumed',
                    align: 'right',
                    cell: (row) => qty(row.consumedQty, row.unitCode),
                  },
                ]}
              />
            </div>
          )
        }
      </ReportBody>
    </div>
  );
}
