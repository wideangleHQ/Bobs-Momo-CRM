import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
/** `secondary` is an alias for `neutral`. Both spellings are in use. */
export type BadgeVariant = BadgeTone | 'secondary';
/** Literals stay suggested, but a value read out of a lookup map still fits. */
type BadgeVariantInput = BadgeVariant | (string & {});

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-text-muted',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  primary: 'bg-primary-bg text-primary',
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
        'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium',
        TONES[picked],
        className,
      )}
    >
      {children}
    </span>
  );
}
