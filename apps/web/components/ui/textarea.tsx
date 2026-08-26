import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { inputClass } from './input';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 3, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(inputClass, 'h-auto min-h-24 py-2', invalid && 'border-danger', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
