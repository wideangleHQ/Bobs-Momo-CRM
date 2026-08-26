import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary/90 active:bg-primary/80',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-muted',
  ghost: 'bg-transparent text-text hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
};

// 44px is the floor everywhere. lg is for a screen's one primary action.
const SIZES: Record<Size, string> = {
  sm: 'h-11 px-3 text-sm',
  md: 'h-11 px-4 text-base',
  lg: 'h-12 px-5 text-base',
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
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {pending ? <Spinner className="h-5 w-5" /> : null}
      <span>{children}</span>
    </button>
  );
}
