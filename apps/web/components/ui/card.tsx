import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-zinc-100 bg-white shadow-sm transition-shadow hover:shadow-md',
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
    <div className={cn('flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4', className)}>
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('p-5', className)} {...rest} />;
}

