import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Hint and error copy sit under the control, in the same place every time. */
export function FieldMessage({
  error,
  hint,
  id,
  className,
}: {
  error?: string;
  hint?: ReactNode;
  id?: string;
  className?: string;
}) {
  if (!error && !hint) return null;
  return (
    <p
      id={id}
      className={cn('text-sm', error ? 'text-danger' : 'text-text-muted', className)}
      role={error ? 'alert' : undefined}
    >
      {error ?? hint}
    </p>
  );
}
