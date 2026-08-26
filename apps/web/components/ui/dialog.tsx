'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icons';

/**
 * Native <dialog>. Focus trapping, Escape to close and aria-modal come from
 * the platform, which is why nobody hand-rolls one.
 */
export function Dialog({
  open,
  onOpenChange,
  onClose,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shorthand for onOpenChange(false). Both spellings are in use. */
  onClose?: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => {
    onOpenChange?.(false);
    onClose?.();
  };

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
        close();
      }}
      onClick={(e) => {
        // A click that lands on the dialog box itself is a backdrop click.
        if (e.target === ref.current) close();
      }}
      className={cn(
        'm-auto w-[calc(100vw-2rem)] max-w-md rounded-lg bg-surface p-0 text-text shadow-xl',
        'backdrop:bg-black/45',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted"
        >
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>
      {children ? <div className="p-4">{children}</div> : null}
      {footer ? (
        <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
