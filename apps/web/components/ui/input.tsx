import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  invalid?: boolean;
}

// border-strong rather than border: a hairline disappears on a bright screen.
export const inputClass =
  'h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base ' +
  'text-text placeholder:text-text-muted/70 disabled:bg-surface-muted ' +
  'disabled:text-text-muted';

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      className={cn(inputClass, invalid && 'border-danger', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
