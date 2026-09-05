'use client';

import { cn } from '@/lib/cn';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

/** A horizontal strip that scrolls rather than wrapping. Controlled only. */
export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn('flex gap-1 overflow-x-auto border-b border-zinc-100 bg-white px-1', className)}
    >
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              'h-11 shrink-0 border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer select-none',
              active
                ? 'border-red-600 text-red-600'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 hover:border-zinc-200',
            )}
          >
            {t.label}
            {typeof t.count === 'number' ? (
              <span
                className={cn(
                  'ml-2 rounded-md px-1.5 py-0.5 text-xs tabular-nums font-mono',
                  active ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-500',
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

