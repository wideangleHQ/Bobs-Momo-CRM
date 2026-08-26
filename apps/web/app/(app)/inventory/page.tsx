'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage, listStock } from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';

const LINKS: { href: string; label: string; blurb: string; permission: string }[] = [
  {
    href: '/inventory/entry',
    label: 'Record stock',
    blurb: 'Received, issued, wastage or an adjustment',
    permission: 'inventory.transaction.create',
  },
  {
    href: '/inventory/stock',
    label: 'Current stock',
    blurb: 'What is on hand right now',
    permission: 'inventory.stock.read',
  },
  {
    href: '/inventory/history',
    label: 'Stock ledger',
    blurb: 'Trace a quantity back to who moved it',
    permission: 'inventory.transaction.read',
  },
  {
    href: '/inventory/items',
    label: 'Item master',
    blurb: 'Add and edit the items you track',
    permission: 'inventory.item.read',
  },
];

export default function InventoryHomePage() {
  const can = useCan();
  const params = { belowReorder: true, pageSize: 100 };
  const low = useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => listStock(params),
    enabled: can('inventory.stock.read'),
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <PageHeader title="Inventory" description="Everything that comes in, goes out or gets thrown away." />

      {can('inventory.stock.read') ? (
        low.isPending ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : low.isError ? (
          <ErrorState message={errorMessage(low.error)} onRetry={() => void low.refetch()} />
        ) : (
          <Link
            href="/inventory/stock?low=1"
            className={`block rounded-lg border p-4 ${
              low.data.data.length > 0
                ? 'border-danger/30 bg-danger-bg text-danger'
                : 'border-border bg-surface text-text'
            }`}
          >
            <p className="text-3xl font-semibold tabular-nums">{low.data.data.length}</p>
            <p className="text-sm">
              {low.data.data.length === 0
                ? 'Nothing is below its reorder level'
                : 'items below their reorder level'}
            </p>
          </Link>
        )
      ) : null}

      <nav className="flex flex-col gap-3">
        {LINKS.filter((l) => can(l.permission)).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-[64px] flex-col justify-center rounded-lg border border-border bg-surface px-4 py-3"
          >
            <span className="text-base font-medium text-text">{l.label}</span>
            <span className="text-sm text-text-muted">{l.blurb}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
