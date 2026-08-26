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
import { longDate } from '@/lib/format';
import { errorMessage } from '@/features/inventory/api';
import { Chip, TextInput, useDebounced } from '@/features/inventory/fields';
import { listVendors } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';

export default function VendorsPage() {
  const can = useCan();
  const [rawSearch, setRawSearch] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [page, setPage] = useState(1);
  const q = useDebounced(rawSearch);

  const params = { page, pageSize: 25, q: q || undefined, isActive };
  const vendors = useQuery({
    queryKey: purchaseKeys.vendors(params),
    queryFn: () => listVendors(params),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <PageHeader
        title="Vendors"
        description="The suppliers you buy from and the items each one sells."
        action={
          can('vendor.vendor.create') ? (
            <Link href="/vendors/new">
              <Button>Add vendor</Button>
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
        placeholder="Search vendors"
      />

      <div className="flex gap-2">
        <Chip
          active={isActive}
          onClick={() => {
            setIsActive(true);
            setPage(1);
          }}
        >
          Active
        </Chip>
        <Chip
          active={!isActive}
          onClick={() => {
            setIsActive(false);
            setPage(1);
          }}
        >
          Retired
        </Chip>
      </div>

      {vendors.isPending ? (
        <div className="flex flex-col gap-px">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : vendors.isError ? (
        <ErrorState message={errorMessage(vendors.error)} onRetry={() => void vendors.refetch()} />
      ) : vendors.data.data.length === 0 ? (
        <EmptyState
          title={q ? 'No vendors match that' : isActive ? 'No vendors yet' : 'No retired vendors'}
          description="A purchase has to belong to a vendor, so add your suppliers before keying in bills."
          action={
            can('vendor.vendor.create') ? (
              <Link href="/vendors/new">
                <Button>Add vendor</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul
            className={`flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border ${
              vendors.isFetching ? 'opacity-60' : ''
            }`}
          >
            {vendors.data.data.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/vendors/${v.id}`}
                  className="flex min-h-[64px] items-center justify-between gap-3 bg-surface px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-medium text-text">{v.name}</span>
                    <span className="truncate text-sm text-text-muted">
                      {v.itemCount} {v.itemCount === 1 ? 'item' : 'items'}
                      {v.phone ? ` · ${v.phone}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {v.lastPurchaseAt ? longDate(v.lastPurchaseAt) : 'no purchases'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={vendors.data.meta.page}
            pageSize={vendors.data.meta.pageSize}
            total={vendors.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
