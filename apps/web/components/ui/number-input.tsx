import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { inputClass } from './input';

export interface NumberInputProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  invalid?: boolean;
  /** "KG", "PCS", "Rs". Rendered as a suffix chip inside the field. */
  unit?: string;
  /** 'decimal' for money and quantity, 'numeric' for whole counts. */
  mode?: 'decimal' | 'numeric';
}

/**
 * Kept as a text input on purpose. type="number" on Android swallows a
 * trailing decimal point and lets a scroll wheel change a stock quantity.
 */
export function NumberInput({
  className,
  invalid,
  unit,
  mode = 'decimal',
  ...rest
}: NumberInputProps) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode={mode}
        autoComplete="off"
        className={cn(
          inputClass,
          'h-12 text-lg tabular-nums',
          unit && 'pr-16',
          invalid && 'border-danger',
          className,
        )}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {unit ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-sm bg-surface-muted px-2 py-0.5 text-sm font-medium text-text-muted">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
