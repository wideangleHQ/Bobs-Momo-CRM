'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icons';

/**
 * Bottom sheet on a phone, right hand drawer from md up. Same native <dialog>
 * as Dialog, so it inherits the focus trap and Escape.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onClick={(e) => {
        if (e.target === ref.current) onOpenChange(false);
      }}
      className={cn(
        'm-0 mt-auto w-full max-w-none rounded-t-lg bg-surface p-0 text-text shadow-xl',
        'md:ml-auto md:mt-0 md:h-full md:max-h-full md:w-96 md:rounded-none md:rounded-l-lg',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => onOpenChange(false)}
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted"
        >
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-2 md:max-h-none">{children}</div>
    </dialog>
  );
}
