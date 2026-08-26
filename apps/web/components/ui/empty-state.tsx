import Link from 'next/link';
import { isValidElement, type ReactNode } from 'react';
import { Button } from './button';

export type EmptyStateAction = { label: string; href: string } | { label: string; onClick: () => void };

/**
 * A heading, one line saying what to do next, one action. No illustration.
 */
function isDescriptor(a: EmptyStateAction | ReactNode): a is EmptyStateAction {
  return typeof a === 'object' && a !== null && !isValidElement(a) && 'label' in a;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: EmptyStateAction | ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-text-muted">{icon}</div> : null}
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-text-muted">{description}</p>
      {action ? (
        <div className="mt-6 w-full max-w-xs">
          {!isDescriptor(action) ? (
            action
          ) : 'href' in action ? (
            <Link
              href={action.href}
              className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary px-5 text-base font-semibold text-primary-fg"
            >
              {action.label}
            </Link>
          ) : (
            <Button fullWidth size="lg" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
