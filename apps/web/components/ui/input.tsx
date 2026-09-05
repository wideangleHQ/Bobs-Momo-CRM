import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  invalid?: boolean;
}

// border-zinc-300 rather than border-border: a clear border on bright screens.
export const inputClass =
  'h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium ' +
  'text-zinc-950 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 ' +
  'disabled:bg-zinc-50 disabled:text-zinc-400 transition-all';

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      className={cn(inputClass, invalid && 'border-red-600 focus:ring-red-600', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

