import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4', className)}>
      <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('p-5', className)} {...rest} />;
}

