'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { relative } from '@/lib/format';
import { errorMessage } from '@/features/analytics/report-frame';
import {
  listNotifications,
  markAllRead,
  markRead,
  notificationKeys,
  type Notification,
} from './api';

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const filters = { page, pageSize: 25 };

  const query = useQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: () => listNotifications(filters),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.all() });
  };

  const readOne = useMutation({ mutationFn: markRead, onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: markAllRead, onSuccess: invalidate });

  const unread = (query.data?.data ?? []).filter((n) => n.readAt === null).length;
  const total = query.data?.meta.total ?? 0;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Notifications" description="Alerts sent to you" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          {unread === 0 ? 'Nothing unread on this page.' : `${unread} unread on this page.`}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={readAll.isPending || unread === 0}
            onClick={() => readAll.mutate()}
          >
            {readAll.isPending ? 'Marking' : 'Mark all read'}
          </Button>
          <Link href="/notifications/preferences">
            <Button type="button" variant="secondary" className="min-h-[44px]">
              Preferences
            </Button>
          </Link>
        </div>
      </div>

      {readAll.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(readAll.error)}
        </p>
      ) : null}

      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="Alerts about low stock, overdue tasks, leave decisions and broadcasts land here. There is nothing to catch up on."
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((item: Notification) => (
            <li key={item.id}>
              <Card className={item.readAt === null ? 'border-primary p-3' : 'p-3'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{item.title}</p>
                    <p className="mt-0.5 text-sm text-text">{item.body}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {relative(item.createdAt)} · {item.eventKey.toLowerCase().replaceAll('_', ' ')}
                    </p>
                  </div>
                  {item.readAt === null ? <Badge>New</Badge> : null}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {item.deepLink ? (
                    <Link href={item.deepLink}>
                      <Button type="button" variant="secondary" className="min-h-[44px]">
                        Open
                      </Button>
                    </Link>
                  ) : null}
                  {item.readAt === null ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-[44px]"
                      disabled={readOne.isPending}
                      onClick={() => readOne.mutate(item.id)}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={25} total={total} onPageChange={setPage} />
    </div>
  );
}
