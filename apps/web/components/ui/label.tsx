import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface LabelProps extends ComponentPropsWithRef<'label'> {
  required?: boolean;
}

/** Always bound with htmlFor. A placeholder is not a label. */
export function Label({ className, required, children, ...rest }: LabelProps) {
  return (
    <label className={cn('block text-sm font-medium text-text', className)} {...rest}>
      {children}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
  );
}
