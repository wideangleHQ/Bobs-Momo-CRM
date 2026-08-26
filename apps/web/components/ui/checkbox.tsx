import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  label?: ReactNode;
}

/** The whole row is the target, so the 20px box still gets 44px of reach. */
export function Checkbox({ className, label, id, ...rest }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={cn('flex min-h-11 cursor-pointer items-center gap-3 text-base text-text', className)}
    >
      <input
        id={id}
        type="checkbox"
        className="h-5 w-5 shrink-0 rounded-sm border border-border-strong accent-primary"
        {...rest}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}
