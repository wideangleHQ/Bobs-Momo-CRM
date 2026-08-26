import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { inputClass } from './input';
import { Icon } from './icons';

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  invalid?: boolean;
}

/** The native control. It gives a phone its own full-height option wheel,
 *  which beats anything a popover can do with one thumb. */
export function Select({ className, invalid, children, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(inputClass, 'appearance-none pr-10', invalid && 'border-danger', className)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
}
