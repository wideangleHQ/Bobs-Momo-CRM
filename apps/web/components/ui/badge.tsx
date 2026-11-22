import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
/** `secondary` is an alias for `neutral`. Both spellings are in use. */
export type BadgeVariant = BadgeTone | 'secondary';
/** Literals stay suggested, but a value read out of a lookup map still fits. */
type BadgeVariantInput = BadgeVariant | (string & {});

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border border-[var(--color-border)]',
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success-bg)] font-semibold',
  warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)] border border-[var(--color-warning-bg)] font-semibold',
  danger: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)] border border-[var(--color-danger-bg)] font-semibold',
  info: 'bg-[var(--color-dark)] text-[var(--color-dark-fg)] font-medium',
  primary: 'bg-[var(--color-primary)] text-[var(--color-primary-fg)] font-semibold',
};

/** Colour is never the only signal, so the label always carries the meaning. */
export function Badge({
  tone,
  variant,
  children,
  className,
}: {
  tone?: BadgeVariantInput;
  variant?: BadgeVariantInput;
  children: ReactNode;
  className?: string;
}) {
  const named = variant ?? tone ?? 'neutral';
  const picked: BadgeTone = named in TONES ? (named as BadgeTone) : 'neutral';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wider',
        TONES[picked],
        className,
      )}
    >
      {children}
    </span>
  );
}

