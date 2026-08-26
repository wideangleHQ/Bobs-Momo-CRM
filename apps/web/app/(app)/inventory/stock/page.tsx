'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { qty as fmtQty } from '@/lib/format';
import { useCan } from '@/lib/auth';
import { errorMessage, listStock, type StockRow } from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { useItemMaster } from '@/features/inventory/item-picker';
import { Chip, SelectInput, TextInput, useDebounced } from "@/features/inventory/fields";
import { useOutlets } from '@/features/inventory/outlets';

function StockLine({ row }: { row: StockRow }) {
  const flagged = row.isNegative || row.isBelowReorder;
  return (
    <li>
      <Link
        href={`/inventory/items/${row.itemId}`}
        className={`flex min-h-[64px] flex-col justify-center gap-0.5 border-l-4 bg-surface px-3 py-2 ${
          flagged ? 'border-l-danger' : 'border-l-transparent'
        }`}
      >
        <span className="flex items-center gap-2">
          {flagged ? (
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-xs font-bold text-white"
            >
              !
            </span>
          ) : null}
          <span className="text-base font-medium text-text">{row.name}</span>
          {flagged ? <span className="sr-only">Low</span> : null}
        </span>
        <span className="text-sm">
          <span
            className={`font-medium tabular-nums ${
              row.isNegative ? 'text-danger' : 'text-text'
            }`}
          >
            {fmtQty(row.qtyOnHand, row.unitCode)}
          </span>
          <span className="text-text-muted">
            ·
            {row.reorderLevel === null
              ? 'no reorder level'
              : `reorder ${fmtQty(row.reorderLevel, row.unitCode)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

function StockList() {
  const search = useSearchParams();
  const can = useCan();
  const { options: outletOptions } = useOutlets();
  const master = useItemMaster();

  const [rawSearch, setRawSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [low, setLow] = useState(search.get('low') === '1');
  const [outletId, setOutletId] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(rawSearch);

  const categories = [...new Map((master.data ?? []).map((i) => [i.categoryId, i.categoryName])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const params = {
    page,
    pageSize: 25,
    search: term || undefined,
    categoryId: categoryId || undefined,
    belowReorder: low || undefined,
    outletId: outletId || undefined,
  };
  const stock = useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => listStock(params),
    placeholderData: (prev) => prev,
  });

  const filtered = Boolean(term || categoryId || low);
  const clear = () => {
    setRawSearch('');
    setCategoryId('');
    setLow(false);
    setPage(1);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <PageHeader
        title="Current stock"
        description="What is on hand at this outlet right now."
        action={
          can('inventory.transaction.create') ? (
            <Link href="/inventory/entry">
              <Button>Record stock</Button>
            </Link>
          ) : null
        }
      />

      <TextInput
        type="search"
        value={rawSearch}
        onChange={(v) => {
          setRawSearch(v);
          setPage(1);
        }}
        placeholder="Search items"
      />

      {outletOptions.length > 1 ? (
        <SelectInput
          value={outletId}
          onChange={(v) => {
            setOutletId(v);
            setPage(1);
          }}
          placeholder="All outlets"
          options={outletOptions}
        />
      ) : null}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip
          active={!filtered}
          onClick={clear}
        >
          All
        </Chip>
        <Chip
          tone="danger"
          active={low}
          onClick={() => {
            setLow(!low);
            setPage(1);
          }}
        >
          Low
        </Chip>
        {categories.map((c) => (
          <Chip
            key={c.value}
            active={categoryId === c.value}
            onClick={() => {
              setCategoryId(categoryId === c.value ? '' : c.value);
              setPage(1);
            }}
          >
            {c.label}
          </Chip>
        ))}
      </div>

      {stock.isPending ? (
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-16 w-full" />
            </li>
          ))}
        </ul>
      ) : stock.isError ? (
        <ErrorState message={errorMessage(stock.error)} onRetry={() => void stock.refetch()} />
      ) : stock.data.data.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No items match this filter"
            description="Widen the search or clear the filters to see everything on hand."
            action={<Button onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            title="No stock recorded yet"
            description="Record an opening or received entry and the balance shows up here."
            action={
              can('inventory.transaction.create') ? (
                <Link href="/inventory/entry">
                  <Button>Record stock</Button>
                </Link>
              ) : null
            }
          />
        )
      ) : (
        <>
          <ul
            className={`flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border ${
              stock.isFetching ? 'opacity-60' : ''
            }`}
          >
            {stock.data.data.map((row) => (
              <StockLine key={`${row.itemId}:${row.outletId}`} row={row} />
            ))}
          </ul>
          <Pagination
            page={stock.data.meta.page}
            pageSize={stock.data.meta.pageSize}
            total={stock.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64 rounded-lg" />}>
      <StockList />
    </Suspense>
  );
}
