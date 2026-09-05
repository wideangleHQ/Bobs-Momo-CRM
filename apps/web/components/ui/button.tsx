import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-600',
  secondary: 'bg-white text-zinc-900 border border-zinc-300 hover:border-red-600 hover:text-red-600 hover:bg-red-50/40 active:bg-red-50',
  ghost: 'bg-transparent text-zinc-900 hover:text-red-600 hover:bg-red-50/60 active:bg-red-100/60',
  danger: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-900 focus-visible:ring-2 focus-visible:ring-red-700',
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
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold cursor-pointer',
        'transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 select-none',
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

