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
        'flex items-center gap-3 border-b border-zinc-100 bg-white px-5 py-4 sm:px-6 rounded-2xl shadow-xs',
        sticky && 'sticky top-0 z-20 shadow-sm',
      )}
    >
      {showBack ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          title="Go back to last visited page"
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50/80 text-zinc-600 transition-all duration-150 hover:bg-white hover:border-zinc-300 hover:text-zinc-900 outline-none focus:outline-none focus-visible:outline-none ring-0 cursor-pointer"
        >
          <Icon name="arrowLeft" className="h-4 w-4" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl">{title}</h1>
        {sub ? <p className="mt-0.5 text-xs text-zinc-500">{sub}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </header>
  );
}


