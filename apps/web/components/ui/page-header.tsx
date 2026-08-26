import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icons';

export function PageHeader({
  title,
  subtitle,
  description,
  backHref,
  action,
  actions,
  sticky = false,
}: {
  title: string;
  subtitle?: string;
  /** Same slot as subtitle. Both spellings are in use across the app. */
  description?: string;
  backHref?: string;
  action?: ReactNode;
  actions?: ReactNode;
  /** Sticky on list screens, static on forms where the keyboard eats the view. */
  sticky?: boolean;
}) {
  const sub = subtitle ?? description;
  const right = actions ?? action;
  return (
    <header
      className={cn(
        'flex items-start gap-3 border-b border-border bg-bg px-4 py-4 sm:px-6',
        sticky && 'sticky top-0 z-20',
      )}
    >
      {backHref ? (
        <Link
          href={backHref}
          aria-label="Go back"
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted"
        >
          <Icon name="chevronLeft" />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold text-text">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-text-muted">{sub}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </header>
  );
}
