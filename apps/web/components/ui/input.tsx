import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  invalid?: boolean;
}

export const inputClass =
  'h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm font-medium ' +
  'text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 ' +
  'disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-text-muted)] transition-all';

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      className={cn(inputClass, invalid && 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]/20', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

