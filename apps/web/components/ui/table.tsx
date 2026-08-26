import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

/** The page body never scrolls sideways. Wide content scrolls inside here. */
export function Table({ className, children, ...rest }: ComponentPropsWithRef<'table'>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-surface">
      <table className={cn('w-full min-w-max border-collapse text-sm', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...rest }: ComponentPropsWithRef<'thead'>) {
  return <thead className={cn('border-b border-border bg-surface-muted', className)} {...rest} />;
}

export function TBody({ className, ...rest }: ComponentPropsWithRef<'tbody'>) {
  return <tbody className={cn('divide-y divide-border', className)} {...rest} />;
}

export function TR({ className, ...rest }: ComponentPropsWithRef<'tr'>) {
  return <tr className={cn('align-middle', className)} {...rest} />;
}

export function TH({ className, ...rest }: ComponentPropsWithRef<'th'>) {
  return (
    <th
      className={cn('px-3 py-3 text-left text-xs font-medium text-text-muted', className)}
      {...rest}
    />
  );
}

export function TD({ className, numeric, ...rest }: ComponentPropsWithRef<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-3 py-3 text-text', numeric && 'text-right tabular-nums', className)}
      {...rest}
    />
  );
}
