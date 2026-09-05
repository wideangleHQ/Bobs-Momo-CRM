import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
/** `secondary` is an alias for `neutral`. Both spellings are in use. */
export type BadgeVariant = BadgeTone | 'secondary';
/** Literals stay suggested, but a value read out of a lookup map still fits. */
type BadgeVariantInput = BadgeVariant | (string & {});

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 border border-zinc-200',
  success: 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold',
  warning: 'bg-amber-50 text-amber-800 border border-amber-200 font-semibold',
  danger: 'bg-red-50 text-red-700 border border-red-200 font-semibold',
  info: 'bg-zinc-800 text-zinc-50 font-medium',
  primary: 'bg-red-600 text-white font-semibold',
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

