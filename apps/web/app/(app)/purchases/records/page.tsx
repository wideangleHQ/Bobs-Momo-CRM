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
import { longDate, money as fmtMoney } from '@/lib/format';
import { errorMessage } from '@/features/inventory/api';
import { Chip, Field, SelectInput } from '@/features/inventory/fields';
import { listPurchases, listVendors, type PurchaseStatus } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import { StatusPill } from '@/features/purchase/status';

const STATUSES: PurchaseStatus[] = ['RECORDED', 'VOIDED', 'DRAFT'];

export default function PurchaseRecordsPage() {
  const can = useCan();
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const [vendorId, setVendorId] = useState('');
  const [page, setPage] = useState(1);

  const vendorParams = { isActive: true, pageSize: 100 };
  const vendors = useQuery({
    queryKey: purchaseKeys.vendors(vendorParams),
    queryFn: () => listVendors(vendorParams),
    staleTime: 5 * 60 * 1000,
  });

  const params = {
    page,
    pageSize: 25,
    status: status || undefined,
    vendorId: vendorId || undefined,
  };
  const purchases = useQuery({
    queryKey: purchaseKeys.purchases(params),
    queryFn: () => listPurchases(params),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <PageHeader
        title="Purchases"
        description="Every vendor bill that was keyed in, voided ones included."
        action={
          can('purchase.record.create') ? (
            <Link href="/purchases/records/new">
              <Button>Record purchase</Button>
            </Link>
          ) : null
        }
      />

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
        <Chip
          active={status === ''}
          onClick={() => {
            setStatus('');
            setPage(1);
          }}
        >
          All
        </Chip>
        {STATUSES.map((s) => (
          <Chip
            key={s}
            active={status === s}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s.toLowerCase()}
          </Chip>
        ))}
      </div>

      {purchases.isPending ? (
        <div className="flex flex-col gap-px">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : purchases.isError ? (
        <ErrorState
          message={errorMessage(purchases.error)}
          onRetry={() => void purchases.refetch()}
        />
      ) : purchases.data.data.length === 0 ? (
        <EmptyState
          title="No purchases here"
          description="Record a vendor bill and it lands in this list with its stock already received."
          action={
            can('purchase.record.create') ? (
              <Link href="/purchases/records/new">
                <Button>Record purchase</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul
            className={`flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border ${
              purchases.isFetching ? 'opacity-60' : ''
            }`}
          >
            {purchases.data.data.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/purchases/records/${p.id}`}
                  className="flex min-h-[64px] items-center justify-between gap-3 bg-surface px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-medium text-text">
                      {p.vendorName}
                    </span>
                    <span className="truncate text-sm text-text-muted">
                      {p.purchaseNo} · {longDate(p.purchaseDate)} · {p.outletCode}
                      {p.invoiceNo ? ` · ${p.invoiceNo}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`text-base font-semibold tabular-nums ${
                        p.status === 'VOIDED' ? 'text-text-muted line-through' : 'text-text'
                      }`}
                    >
                      {fmtMoney(p.totalAmount)}
                    </span>
                    {p.status === 'RECORDED' ? null : <StatusPill status={p.status} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={purchases.data.meta.page}
            pageSize={purchases.data.meta.pageSize}
            total={purchases.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
