import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[var(--color-primary)] text-[var(--color-primary-fg)] hover:bg-[var(--color-primary-deep)] active:bg-[var(--color-primary-deep)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
  secondary: 'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] active:bg-[var(--color-primary-bg)]',
  ghost: 'bg-transparent text-[var(--color-text)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] active:bg-[var(--color-primary-bg)]',
  danger: 'bg-[var(--color-danger)] text-[var(--color-primary-fg)] hover:bg-[var(--color-primary-deep)] active:bg-[var(--color-primary-deep)] focus-visible:ring-2 focus-visible:ring-[var(--color-danger)]',
};

// 44px is the floor everywhere. lg is for a screen's one primary action.
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-xs tracking-wide uppercase font-semibold',
  md: 'h-11 px-4 text-sm font-semibold',
  lg: 'h-12 px-6 text-base font-semibold',
};

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: Variant;
  size?: Size;
  /** Swaps the label for a spinner and disables. The button never disappears. */
  pending?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  pending = false,
  fullWidth = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={rest.type ?? 'button'}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold cursor-pointer whitespace-nowrap',
        'transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 select-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {pending ? <Spinner className="h-5 w-5 shrink-0" /> : null}
      <span className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
        {children}
      </span>
    </button>
  );
}

