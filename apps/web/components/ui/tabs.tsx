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
      className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}
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
              'h-11 shrink-0 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t.label}
            {typeof t.count === 'number' ? (
              <span className="ml-1.5 tabular-nums">{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
