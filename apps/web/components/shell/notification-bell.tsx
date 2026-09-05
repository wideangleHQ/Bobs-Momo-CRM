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
      className="relative flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-800"
    >
      <Icon name="bell" className="h-[18px] w-[18px]" />
      {count > 0 ? (
        <span className="absolute right-1.5 top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-red-600 border border-white" />
      ) : null}
    </Link>
  );
}

