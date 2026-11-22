'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icons';

export function PageHeader({
  title,
  subtitle,
  description,
  backHref,
  showBack = true,
  action,
  actions,
  sticky = false,
}: {
  title: string;
  subtitle?: string;
  /** Same slot as subtitle. Both spellings are in use across the app. */
  description?: string;
  backHref?: string;
  showBack?: boolean;
  action?: ReactNode;
  actions?: ReactNode;
  /** Sticky on list screens, static on forms where the keyboard eats the view. */
  sticky?: boolean;
}) {
  const router = useRouter();
  const sub = subtitle ?? description;
  const right = actions ?? action;

  const handleBack = () => {
    if (backHref) {
      router.push(backHref);
    } else if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <header
      className={cn(
        'flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 sm:px-6 rounded-xl shadow-xs',
        sticky && 'sticky top-0 z-20 shadow-sm',
      )}
    >
      {showBack ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          title="Go back to last visited page"
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] outline-none focus:outline-none focus-visible:outline-none ring-0 cursor-pointer"
        >
          <Icon name="arrowLeft" className="h-4 w-4" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight text-[var(--color-text)] sm:text-xl">{title}</h1>
        {sub ? <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{sub}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </header>
  );
}


