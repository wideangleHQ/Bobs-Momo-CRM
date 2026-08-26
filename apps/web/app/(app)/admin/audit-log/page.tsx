'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { longDate, time } from '@/lib/format';
import { errorMessage, isoDaysAgo, useOutletOptions } from '@/features/analytics/report-frame';
import { toBusinessDate } from '@bobs-momo/shared';
import { adminKeys, listAuditLog, type AuditEntry } from '@/features/admin/api';

const BLANK = {
  from: '',
  to: '',
  action: '',
  actorId: '',
  entityType: '',
  entityId: '',
  outletId: '',
};

type Filters = typeof BLANK;

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <pre className="mt-1 overflow-x-auto rounded-md bg-text p-2 text-xs text-bg">
        {value === null || value === undefined ? 'none' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Highlighting the changed keys is what makes a diff readable at a glance. */
function changedKeys(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

export default function AuditLogPage() {
  const [filters, setFilters] = useState<Filters>(() => ({
    ...BLANK,
    from: isoDaysAgo(29),
    to: toBusinessDate(),
  }));
  const [page, setPage] = useState(1);
  const outlets = useOutletOptions();

  const applied = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    action: filters.action.trim() || undefined,
    actorId: filters.actorId.trim() || undefined,
    entityType: filters.entityType.trim() || undefined,
    entityId: filters.entityId.trim() || undefined,
    outletId: filters.outletId || undefined,
    page,
    pageSize: 50,
  };

  const query = useQuery({
    queryKey: adminKeys.auditLog(applied),
    queryFn: () => listAuditLog(applied),
    staleTime: 30 * 1000,
  });

  const set = (key: keyof Filters) => (value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const total = query.data?.meta.total ?? 0;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Audit log"
        description="Who changed what, and what it was before. Append only."
      />

      <Card className="p-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <Label htmlFor="audit-from">From</Label>
            <DatePicker
              id="audit-from"
                            className="min-h-[44px]"
              value={filters.from}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('from')(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="audit-to">To</Label>
            <DatePicker
              id="audit-to"
                            className="min-h-[44px]"
              value={filters.to}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('to')(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="audit-action">Action</Label>
            <Input
              id="audit-action"
              className="min-h-[44px]"
              placeholder="sales.entry.update"
              value={filters.action}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('action')(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="audit-actor">Actor id</Label>
            <Input
              id="audit-actor"
              className="min-h-[44px]"
              placeholder="User uuid"
              value={filters.actorId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('actorId')(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="audit-entity-type">Entity type</Label>
            <Input
              id="audit-entity-type"
              className="min-h-[44px]"
              placeholder="ItemStock"
              value={filters.entityType}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set('entityType')(e.target.value)
              }
            />
          </div>
          <div>
            <Label htmlFor="audit-entity-id">Entity id</Label>
            <Input
              id="audit-entity-id"
              className="min-h-[44px]"
              value={filters.entityId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('entityId')(e.target.value)}
            />
          </div>
          {(outlets.data?.data ?? []).length > 1 ? (
            <div>
              <Label htmlFor="audit-outlet">Outlet</Label>
              <Select
                id="audit-outlet"
                value={filters.outletId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  set('outletId')(e.target.value)
                }
              >
                <option value="">All outlets</option>
                {(outlets.data?.data ?? []).map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.code}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              className="min-h-[44px]"
              onClick={() => {
                setFilters({ ...BLANK, from: isoDaysAgo(29), to: toBusinessDate() });
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          To answer &quot;what happened to this item at this outlet last week&quot;, set the entity
          type to ItemStock, paste the entity id and narrow the dates.
        </p>
      </Card>

      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="No audited action fits this combination. Widen the dates or clear a filter."
        />
      ) : (
        <>
          <p className="text-sm text-text-muted">
            {total} entr{total === 1 ? 'y' : 'ies'}, newest first.
          </p>
          <ul className="space-y-2">
            {query.data.data.map((entry: AuditEntry) => {
              const changed = changedKeys(entry.before, entry.after);
              return (
                <li key={entry.id}>
                  <Card className="p-3">
                    <details>
                      <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-baseline justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-medium text-text">{entry.action}</span>
                          <span className="ml-2 text-sm text-text-muted">
                            {entry.entityType} {entry.entityId.slice(0, 8)}
                          </span>
                        </span>
                        <span className="text-sm text-text-muted">
                          {entry.actorLabel} · {longDate(entry.createdAt)} {time(entry.createdAt)}
                        </span>
                      </summary>

                      {changed.length > 0 ? (
                        <p className="mt-2 text-sm text-text">
                          Changed: <span className="font-medium">{changed.join(', ')}</span>
                        </p>
                      ) : null}

                      <div className="mt-2 grid gap-3 lg:grid-cols-2">
                        <Snapshot label="Before" value={entry.before} />
                        <Snapshot label="After" value={entry.after} />
                      </div>

                      {entry.requestId ? (
                        <p className="mt-2 text-xs text-text-muted">
                          Request {entry.requestId}
                        </p>
                      ) : null}
                    </details>
                  </Card>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} pageSize={50} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
