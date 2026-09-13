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
import { Icon } from '@/components/ui/icons';

export default function VendorsPage() {
  const can = useCan();
  const [rawSearch, setRawSearch] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [page, setPage] = useState(1);
  const q = useDebounced(rawSearch);

  const params = { page, pageSize: 24, q: q || undefined, isActive };
  const vendors = useQuery({
    queryKey: purchaseKeys.vendors(params),
    queryFn: () => listVendors(params),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-100">
        <PageHeader
          title="Suppliers & Vendors"
          description="Directory of vendors, contact details, GSTIN information, and supplied items."
        />

        <div className="flex flex-wrap items-center gap-2.5">
          {(can('purchase.record.create') || can('inventory.transaction.create')) && (
            <Link href="/inventory/receive">
              <Button type="button" variant="secondary" className="min-h-[40px] text-xs sm:text-sm gap-1.5">
                <Icon name="package" className="h-3.5 w-3.5" />
                <span>Receive Stock</span>
              </Button>
            </Link>
          )}

          {can('vendor.vendor.create') && (
            <Link href="/vendors/new">
              <Button type="button" className="min-h-[40px] text-xs sm:text-sm gap-1.5 bg-red-600 hover:bg-red-700 text-white">
                <Icon name="plus" className="h-3.5 w-3.5" />
                <span>Add Supplier</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── SEARCH & FILTER CONTROLS ───────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-zinc-200/80 shadow-sm">
        <div className="flex-1 max-w-md">
          <TextInput
            type="search"
            value={rawSearch}
            onChange={(v) => {
              setRawSearch(v);
              setPage(1);
            }}
            placeholder="Search by supplier name, phone or GSTIN..."
          />
        </div>

        <div className="flex items-center gap-2">
          <Chip
            active={isActive}
            onClick={() => {
              setIsActive(true);
              setPage(1);
            }}
          >
            Active Suppliers
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
      </div>

      {/* ── SUPPLIERS GRID ─────────────────────────────────── */}
      {vendors.isPending ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      ) : vendors.isError ? (
        <ErrorState message={errorMessage(vendors.error)} onRetry={() => void vendors.refetch()} />
      ) : vendors.data.data.length === 0 ? (
        <EmptyState
          title={q ? 'No suppliers match your search' : isActive ? 'No suppliers registered yet' : 'No retired suppliers'}
          description="A purchase or stock receipt must belong to a supplier. Add your food and packaging vendors to start receiving stock."
          action={
            can('vendor.vendor.create') ? (
              <Link href="/vendors/new">
                <Button className="bg-red-600 hover:bg-red-700 text-white">Add Supplier</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {vendors.data.data.map((v) => (
              <div
                key={v.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-zinc-300"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="h-11 w-11 rounded-xl bg-zinc-100 text-zinc-700 flex items-center justify-center flex-shrink-0 group-hover:bg-red-50 group-hover:text-red-600 transition-colors">
                      <Icon name="building" className="h-5 w-5" />
                    </div>
                    <span className="inline-flex items-center rounded-lg bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
                      {v.itemCount} {v.itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  <Link href={`/vendors/${v.id}`} className="focus-visible:outline-none">
                    <h3 className="text-base sm:text-lg font-bold text-zinc-900 group-hover:text-red-600 transition-colors line-clamp-1">
                      {v.name}
                    </h3>
                  </Link>

                  <div className="mt-2 space-y-1 text-xs text-zinc-500">
                    {v.phone ? (
                      <p className="flex items-center gap-1.5">
                        <span className="text-zinc-400">Phone:</span>
                        <span className="font-medium text-zinc-700">{v.phone}</span>
                      </p>
                    ) : null}
                    <p className="flex items-center gap-1.5">
                      <span className="text-zinc-400">Last Bill:</span>
                      <span>{v.lastPurchaseAt ? longDate(v.lastPurchaseAt) : 'No purchases yet'}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-zinc-100 flex items-center justify-between">
                  <Link
                    href={`/vendors/${v.id}`}
                    className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 flex items-center gap-1 transition-colors"
                  >
                    <span>View details</span>
                    <Icon name="arrowRight" className="h-3 w-3" />
                  </Link>

                  {(can('purchase.record.create') || can('inventory.transaction.create')) && (
                    <Link
                      href={`/inventory/receive?supplierId=${encodeURIComponent(v.id)}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 text-xs font-semibold transition-colors"
                    >
                      <Icon name="plus" className="h-3 w-3" />
                      <span>Receive Stock</span>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          <Pagination
            page={vendors.data.meta.page}
            pageSize={vendors.data.meta.pageSize}
            total={vendors.data.meta.total}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
