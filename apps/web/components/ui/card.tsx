import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface shadow-sm', className)}
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
    <div className={cn('flex items-center justify-between gap-3 border-b border-border p-4', className)}>
      <h2 className="text-base font-semibold text-text">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('p-4 sm:p-6', className)} {...rest} />;
}
