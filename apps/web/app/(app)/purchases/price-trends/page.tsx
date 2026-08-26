'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import { longDate, money as fmtMoney } from '@/lib/format';
import { errorMessage } from '@/features/inventory/api';
import { useItemMaster } from '@/features/inventory/item-picker';
import { Chip, Field, SelectInput } from '@/features/inventory/fields';
import { listPriceHistory, listVendors, type PriceObservation } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import { changePct } from '@/features/purchase/decimal';

const RANGES = [30, 90, 180, 365];

/**
 * A sparkline of the observations, oldest to newest. Inline SVG rather than a
 * charting library, because the whole chart is one polyline.
 */
function Sparkline({ rows }: { rows: PriceObservation[] }) {
  if (rows.length < 2) return null;
  const prices = rows.map((r) => Number(r.unitPrice));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const width = 320;
  const height = 96;
  const points = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = height - ((p - min) / span) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-24 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Unit price moved between ${min.toFixed(2)} and ${max.toFixed(2)} over ${rows.length} purchases`}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function PriceTrendsPage() {
  const master = useItemMaster();
  const [itemId, setItemId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [days, setDays] = useState(90);
  const [page, setPage] = useState(1);

  const vendorParams = { isActive: true, pageSize: 100 };
  const vendors = useQuery({
    queryKey: purchaseKeys.vendors(vendorParams),
    queryFn: () => listVendors(vendorParams),
    staleTime: 5 * 60 * 1000,
  });

  const from = businessDateOffset(-days).toISOString().slice(0, 10);
  const params = {
    page,
    pageSize: 25,
    itemId: itemId || undefined,
    vendorId: vendorId || undefined,
    from,
    to: toBusinessDate(),
  };
  const history = useQuery({
    queryKey: purchaseKeys.prices(params),
    queryFn: () => listPriceHistory(params),
    placeholderData: (prev) => prev,
  });

  const itemOptions = (master.data ?? [])
    .map((i) => ({ value: i.id, label: i.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // The API returns newest first. The chart reads left to right in time.
  const rows = history.data?.data ?? [];
  const chronological = [...rows].reverse();
  const prices = rows.map((r) => Number(r.unitPrice));
  const stats =
    prices.length > 0
      ? {
          latest: rows[0]!,
          min: Math.min(...prices).toFixed(2),
          max: Math.max(...prices).toFixed(2),
          avg: (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2),
          drift:
            rows.length > 1 ? changePct(rows[rows.length - 1]!.unitPrice, rows[0]!.unitPrice) : null,
        }
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <PageHeader
        title="Prices"
        description="What an item costs now, and what it cost the last few times."
      />

      <Field label="Item" htmlFor="item">
        <SelectInput
          id="item"
          value={itemId}
          onChange={(v) => {
            setItemId(v);
            setPage(1);
          }}
          placeholder="All items"
          options={itemOptions}
        />
      </Field>

      <Field label="Vendor" htmlFor="vendor">
        <SelectInput
          id="vendor"
          value={vendorId}
          onChange={(v) => {
            setVendorId(v);
            setPage(1);
          }}
          placeholder="All vendors"
          options={(vendors.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
        />
      </Field>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {RANGES.map((d) => (
          <Chip
            key={d}
            active={days === d}
            onClick={() => {
              setDays(d);
              setPage(1);
            }}
          >
            {d} days
          </Chip>
        ))}
      </div>

      {history.isPending ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : history.isError ? (
        <ErrorState message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No purchases recorded for this"
          description="Prices show up here once a purchase is recorded against the item. Widen the range or pick another item."
        />
      ) : (
        <>
          {itemId && stats ? (
            <div className="rounded-lg border border-border bg-surface p-4 text-text">
              <p className="text-sm text-text-muted">
                Latest, {stats.latest.vendorName} on {longDate(stats.latest.observedOn)}
              </p>
              <p className="py-1 text-4xl font-semibold tabular-nums">
                {fmtMoney(stats.latest.unitPrice)}
                <span className="pl-2 text-base font-normal text-text-muted">
                  per {stats.latest.unitCode}
                </span>
              </p>
              {stats.drift !== null ? (
                <p
                  className={`text-sm font-medium ${
                    Number(stats.drift) > 0 ? 'text-danger' : 'text-success'
                  }`}
                >
                  {Number(stats.drift) > 0 ? 'Up' : 'Down'} {Math.abs(Number(stats.drift))}% across
                  this range
                </p>
              ) : null}
              <div className="text-text-muted">
                <Sparkline rows={chronological} />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 text-sm">
                <span className="text-text-muted">
                  Low
                  <span className="block tabular-nums text-text">{fmtMoney(stats.min)}</span>
                </span>
                <span className="text-text-muted">
                  Average
                  <span className="block tabular-nums text-text">{fmtMoney(stats.avg)}</span>
                </span>
                <span className="text-text-muted">
                  High
                  <span className="block tabular-nums text-text">{fmtMoney(stats.max)}</span>
                </span>
              </div>
              <p className="pt-2 text-xs text-text-muted">
                Worked out from the {rows.length} observations on this page.
              </p>
            </div>
          ) : null}

          <ul
            className={`flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border ${
              history.isFetching ? 'opacity-60' : ''
            }`}
          >
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 bg-surface px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-medium text-text">
                    {row.itemName}
                  </span>
                  <span className="truncate text-sm text-text-muted">
                    {row.vendorName} · {longDate(row.observedOn)}
                  </span>
                </span>
                <span className="shrink-0 text-base font-semibold tabular-nums text-text">
                  {fmtMoney(row.unitPrice)}
                </span>
              </li>
            ))}
          </ul>
          <Pagination
            page={history.data.meta.page}
            pageSize={history.data.meta.pageSize}
            total={history.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
