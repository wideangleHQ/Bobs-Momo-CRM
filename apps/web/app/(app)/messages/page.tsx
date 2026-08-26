'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { relative } from '@/lib/format';
import { listConversations, messagingKeys, type Conversation } from '@/features/messaging/api';
import { BroadcastComposer } from '@/features/messaging/broadcast-composer';

function scopeLabel(scope: Conversation['scope']): string {
  switch (scope) {
    case 'OUTLET':
      return 'Outlet';
    case 'DEPARTMENT':
      return 'Department';
    case 'ALL':
      return 'Everyone';
    default:
      return 'Direct';
  }
}

export default function MessagesPage() {
  const can = useCan();

  const query = useQuery({
    queryKey: messagingKeys.conversations(),
    queryFn: listConversations,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Messages" description="Outlet, department and direct threads" />

      {can('messaging.broadcast.send') ? <BroadcastComposer /> : null}

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
          title="No conversations yet"
          description="Your outlet and department feeds appear here as soon as somebody posts to them. Nothing has been sent."
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((conversation) => (
            <li key={conversation.key}>
              <Link
                href={`/messages/${encodeURIComponent(conversation.key)}`}
                className="block"
              >
                <Card className="p-3 hover:border-primary">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-text">{conversation.title}</p>
                      <p className="mt-0.5 truncate text-sm text-text-muted">
                        {conversation.lastMessage ?? 'No messages yet'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge>{scopeLabel(conversation.scope)}</Badge>
                      {conversation.unreadCount > 0 ? (
                        <Badge tone="primary">{conversation.unreadCount} unread</Badge>
                      ) : null}
                    </div>
                  </div>
                  {conversation.lastMessageAt ? (
                    <p className="mt-1 text-xs text-text-muted">
                      {relative(conversation.lastMessageAt)}
                      {conversation.pinnedCount
                        ? ` · ${conversation.pinnedCount} pinned`
                        : ''}
                    </p>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
