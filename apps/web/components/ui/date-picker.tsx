import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { inputClass } from './input';

export interface DatePickerProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  invalid?: boolean;
}

/**
 * The native date control. Android and iOS both give a full screen picker that
 * no library matches on a phone, and it costs nothing to ship.
 * Value and onChange speak YYYY-MM-DD, which is what the API takes.
 */
export function DatePicker({ className, invalid, ...rest }: DatePickerProps) {
  return (
    <input
      type="date"
      className={cn(inputClass, 'h-12', invalid && 'border-danger', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
