'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { fetchOutlets } from './api';
import { analyticsKeys } from './keys';
import type { OutletOption } from './types';

export function isoDaysAgo(days: number): string {
  return businessDateOffset(-days).toISOString().slice(0, 10);
}

export function spanInDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

export interface RangeState {
  from: string;
  to: string;
  outletId: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setOutletId: (v: string) => void;
  /** Non-null when the range cannot be sent, so the caller disables the query. */
  rangeError: string | null;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
];

export function useReportRange(defaultDays: number, maxSpanDays: number): RangeState {
  const [from, setFrom] = useState(() => isoDaysAgo(defaultDays));
  const [to, setTo] = useState(() => toBusinessDate());
  const [outletId, setOutletId] = useState('');

  const rangeError = useMemo(() => {
    if (!from || !to) return 'Pick a start and an end date.';
    if (from > to) return 'The start date is after the end date.';
    const span = spanInDays(from, to);
    if (span > maxSpanDays) {
      return `This report covers at most ${maxSpanDays} days. You asked for ${span}.`;
    }
    return null;
  }, [from, to, maxSpanDays]);

  return { from, to, outletId, setFrom, setTo, setOutletId, rangeError };
}

export function useOutletOptions() {
  return useQuery({
    queryKey: analyticsKeys.outlets(),
    queryFn: fetchOutlets,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function outletCodeFor(outlets: OutletOption[] | undefined, id: string): string {
  if (!id) return 'ALL';
  return outlets?.find((o) => o.id === id)?.code ?? 'ALL';
}

interface ReportFiltersProps {
  range: RangeState;
  presets?: boolean;
  /** Extra filter controls, rendered after the outlet picker. */
  children?: React.ReactNode;
  /** The download button, pinned to the end of the bar. */
  actions?: React.ReactNode;
}

export function ReportFilters({
  range,
  presets = true,
  children,
  actions,
}: ReportFiltersProps) {
  const outlets = useOutletOptions();
  const options = outlets.data?.data ?? [];

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div>
          <Label htmlFor="report-from">From</Label>
          <DatePicker
            id="report-from"
                        value={range.from}
            max={range.to}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => range.setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="report-to">To</Label>
          <DatePicker
            id="report-to"
                        value={range.to}
            min={range.from}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => range.setTo(e.target.value)}
          />
        </div>
        {options.length > 1 ? (
          <div>
            <Label htmlFor="report-outlet">Outlet</Label>
            <Select
              id="report-outlet"
              value={range.outletId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                range.setOutletId(e.target.value)
              }
            >
              <option value="">All outlets</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {children}
      </div>

      {presets ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant="secondary"
              onClick={() => {
                range.setFrom(isoDaysAgo(p.days));
                range.setTo(toBusinessDate());
              }}
            >
              {p.label}
            </Button>
          ))}
          {actions ? <div className="ml-auto">{actions}</div> : null}
        </div>
      ) : actions ? (
        <div className="mt-3 flex justify-end">{actions}</div>
      ) : null}

      {range.rangeError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {range.rangeError}
        </p>
      ) : null}
    </div>
  );
}

interface ReportBodyProps<T> {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined };
  /** True when the response came back with nothing to draw. */
  isEmpty: (data: T) => boolean;
  emptyTitle: string;
  emptyDescription: string;
  onRetry: () => void;
  children: (data: T) => React.ReactNode;
  blocked?: string | null;
}

export function ReportBody<T>({
  query,
  isEmpty,
  emptyTitle,
  emptyDescription,
  onRetry,
  children,
  blocked,
}: ReportBodyProps<T>) {
  if (blocked) {
    return <EmptyState title="Nothing to show yet" description={blocked} />;
  }
  if (query.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={onRetry} />;
  }
  if (!query.data || isEmpty(query.data)) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return <>{children(query.data)}</>;
}


/** Error codes arrive bare or module prefixed, so match on the tail. */
export function hasCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const actual = (error as { code?: unknown }).code;
  return typeof actual === 'string' && (actual === code || actual.endsWith(`_${code}`));
}

export { errorMessage };
