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
import { longDate, relative } from '@/lib/format';
import { errorMessage } from '@/features/inventory/api';
import { Chip } from '@/features/inventory/fields';
import { listRequests, type RequestStatus } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import { StatusPill } from '@/features/purchase/status';

const STATUSES: RequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'FULFILLED'];

export default function PurchaseRequestsPage() {
  const can = useCan();
  const [status, setStatus] = useState<RequestStatus | ''>('PENDING');
  const [page, setPage] = useState(1);

  const params = { page, pageSize: 25, status: status || undefined };
  const requests = useQuery({
    queryKey: purchaseKeys.requests(params),
    queryFn: () => listRequests(params),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <PageHeader
        title="Purchase requests"
        description="What the kitchen and store asked for, and who decided."
        action={
          can('purchase.request.create') ? (
            <Link href="/purchases/requests/new">
              <Button>New request</Button>
            </Link>
          ) : null
        }
      />

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

      {requests.isPending ? (
        <div className="flex flex-col gap-px">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : requests.isError ? (
        <ErrorState
          message={errorMessage(requests.error)}
          onRetry={() => void requests.refetch()}
        />
      ) : requests.data.data.length === 0 ? (
        <EmptyState
          title={status ? `No ${status.toLowerCase()} requests` : 'No requests yet'}
          description="A store or kitchen manager raises a request when something is running out."
          action={
            can('purchase.request.create') ? (
              <Link href="/purchases/requests/new">
                <Button>New request</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul
            className={`flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border ${
              requests.isFetching ? 'opacity-60' : ''
            }`}
          >
            {requests.data.data.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/purchases/requests/${r.id}`}
                  className="flex min-h-[64px] items-center justify-between gap-3 bg-surface px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base font-medium text-text">{r.requestNo}</span>
                    <span className="truncate text-sm text-text-muted">
                      {r.lineCount} {r.lineCount === 1 ? 'item' : 'items'} · {r.outletCode}
                      {r.neededBy ? ` · needed by ${longDate(r.neededBy)}` : ''}
                    </span>
                    <span className="text-xs text-text-muted">{relative(r.createdAt)}</span>
                  </span>
                  <StatusPill status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={requests.data.meta.page}
            pageSize={requests.data.meta.pageSize}
            total={requests.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
