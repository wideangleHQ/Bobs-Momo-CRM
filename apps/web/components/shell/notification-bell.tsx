'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { Icon } from '@/components/ui/icons';

interface UnreadCount {
  count: number;
}

/**
 * Placeholder until the notification module lands. The endpoint may not exist
 * yet, so a failure renders a plain bell rather than an error.
 */
export function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiGet<UnreadCount>('/notifications/unread-count'),
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
  });

  const count = data?.count ?? 0;

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative flex h-11 w-11 items-center justify-center rounded-md text-text hover:bg-surface-muted"
    >
      <Icon name="bell" className="h-6 w-6" />
      {count > 0 ? (
        <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
