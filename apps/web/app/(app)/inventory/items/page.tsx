'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/auth';
import { errorMessage, listItems } from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { useItemMaster } from '@/features/inventory/item-picker';
import { Chip, TextInput, useDebounced } from '@/features/inventory/fields';

export default function ItemsPage() {
  const can = useCan();
  const master = useItemMaster();
  const [rawSearch, setRawSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const search = useDebounced(rawSearch);

  const categories = [
    ...new Map((master.data ?? []).map((i) => [i.categoryId, i.categoryName])).entries(),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const params = {
    page,
    pageSize: 25,
    search: search || undefined,
    categoryId: categoryId || undefined,
    includeInactive: includeInactive || undefined,
  };
  const items = useQuery({
    queryKey: inventoryKeys.items(params),
    queryFn: () => listItems(params),
    placeholderData: (prev) => prev,
  });

  const filtered = Boolean(search || categoryId || includeInactive);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <PageHeader
        title="Item master"
        description="Every ingredient and packaging item you track."
        action={
          can('inventory.item.create') ? (
            <Link href="/inventory/items/new">
              <Button>Add item</Button>
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
        placeholder="Search by name or SKU"
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip
          active={includeInactive}
          onClick={() => {
            setIncludeInactive(!includeInactive);
            setPage(1);
          }}
        >
          Show retired
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

      {items.isPending ? (
        <div className="flex flex-col gap-px">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : items.isError ? (
        <ErrorState message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
      ) : items.data.data.length === 0 ? (
        <EmptyState
          title={filtered ? 'No items match this filter' : 'No items yet'}
          description={
            filtered
              ? 'Clear the filters to see the whole master list.'
              : 'Add the ingredients and packaging you buy, then stock entries can point at them.'
          }
          action={
            filtered ? (
              <Button
                onClick={() => {
                  setRawSearch('');
                  setCategoryId('');
                  setIncludeInactive(false);
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            ) : can('inventory.item.create') ? (
              <Link href="/inventory/items/new">
                <Button>Add item</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul
            className={`flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border ${
              items.isFetching ? 'opacity-60' : ''
            }`}
          >
            {items.data.data.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/inventory/items/${item.id}`}
                  className="flex min-h-[64px] items-center justify-between gap-3 bg-surface px-3 py-2"
                >
                  <span className="flex flex-col">
                    <span className="text-base font-medium text-text">{item.name}</span>
                    <span className="text-sm text-text-muted">
                      {item.categoryName} · {item.sku}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm text-text-muted">
                    {item.isActive ? null : (
                      <span className="rounded bg-border px-2 py-0.5 text-xs font-medium text-text">
                        Retired
                      </span>
                    )}
                    {item.unitCode}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={items.data.meta.page}
            pageSize={items.data.meta.pageSize}
            total={items.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
