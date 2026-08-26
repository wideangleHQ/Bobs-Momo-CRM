'use client';

import { cn } from '@/lib/cn';
import { Icon } from './icons';

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-between gap-3 py-3', className)}
    >
      <p className="text-sm text-text-muted tabular-nums">
        {first} to {last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-border-strong text-text disabled:opacity-40"
        >
          <Icon name="chevronLeft" className="h-5 w-5" />
        </button>
        <span className="min-w-16 text-center text-sm text-text tabular-nums">
          {page} / {lastPage}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= lastPage}
          onClick={() => onPageChange(page + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-border-strong text-text disabled:opacity-40"
        >
          <Icon name="chevronRight" className="h-5 w-5" />
        </button>
      </div>
    </nav>
  );
}
