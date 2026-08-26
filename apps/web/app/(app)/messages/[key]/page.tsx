'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/api';
import { useCan, useSession } from '@/lib/auth';
import { relative, time } from '@/lib/format';
import {
  listMessages,
  listPinned,
  markMessageRead,
  messagingKeys,
  parseConversationKey,
  pinMessage,
  sendBroadcast,
  sendDirect,
  type Message,
} from '@/features/messaging/api';

const MAX_BODY = 2000;

export default function ConversationPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = use(params);
  const key = decodeURIComponent(rawKey);
  const parsed = parseConversationKey(key);
  const queryClient = useQueryClient();
  const { user } = useSession();
  const can = useCan();
  const [body, setBody] = useState('');

  const thread = useQuery({
    queryKey: messagingKeys.thread(key, 1),
    queryFn: () => listMessages(key, 1),
    // 15 seconds while the conversation is open, per chapter 23.
    refetchInterval: 15 * 1000,
    staleTime: 10 * 1000,
  });

  const pinned = useQuery({
    queryKey: messagingKeys.pinned(key),
    queryFn: () => listPinned(key),
    enabled: parsed.scope !== 'DIRECT',
    staleTime: 60 * 1000,
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: messagingKeys.all() });
  };

  const send = useMutation({
    mutationFn: () => {
      const text = body.trim();
      if (parsed.scope === 'DIRECT') {
        return sendDirect(parsed.withUserId ?? '', text);
      }
      return sendBroadcast({
        scope: parsed.scope,
        ...(parsed.outletId ? { outletId: parsed.outletId } : {}),
        ...(parsed.departmentId ? { departmentId: parsed.departmentId } : {}),
        body: text,
      });
    },
    onSuccess: () => {
      setBody('');
      invalidate();
    },
  });

  const readAll = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await markMessageRead(id);
    },
    onSuccess: invalidate,
  });

  const pinToggle = useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) => pinMessage(input.id, input.pinned),
    onSuccess: invalidate,
  });

  const messages = thread.data?.data ?? [];
  const unreadIds = messages
    .filter((m) => m.readAt == null && m.senderId !== user?.id)
    .map((m) => m.id);

  const canPost =
    parsed.scope === 'DIRECT' ? can('messaging.direct.send') : can('messaging.broadcast.send');
  const canPin = parsed.scope !== 'DIRECT' && can('messaging.broadcast.send');

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={parsed.scope === 'DIRECT' ? 'Direct message' : 'Feed'}
        description={
          parsed.scope === 'ALL'
            ? 'Everyone in the business'
            : parsed.scope === 'DEPARTMENT'
              ? 'A department feed'
              : parsed.scope === 'OUTLET'
                ? 'An outlet feed'
                : 'One to one'
        }
        backHref="/messages"
      />

      {(pinned.data?.data ?? []).length > 0 ? (
        <Card className="border-warning/30 bg-warning-bg p-3">
          <h2 className="text-sm font-semibold text-warning">Pinned</h2>
          <ul className="mt-2 space-y-2">
            {(pinned.data?.data ?? []).map((message) => (
              <li key={message.id} className="text-sm text-text">
                <p>{message.body}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {message.senderName ?? 'Unknown sender'} · {relative(message.createdAt)}
                </p>
                {canPin ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    pending={pinToggle.isPending}
                    onClick={() => pinToggle.mutate({ id: message.id, pinned: false })}
                  >
                    Unpin
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canPost ? (
        <Card className="p-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (body.trim().length === 0 || body.length > MAX_BODY) return;
              send.mutate();
            }}
          >
            <label htmlFor="message-body" className="sr-only">
              Message
            </label>
            <Textarea
              id="message-body"
              rows={2}
              maxLength={MAX_BODY}
              placeholder={
                parsed.scope === 'DIRECT'
                  ? 'Type a message'
                  : 'This goes to everyone in this feed and cannot be deleted'
              }
              value={body}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted">
                {body.length} of {MAX_BODY}
              </span>
              <Button type="submit" pending={send.isPending} disabled={body.trim().length === 0}>
                Send
              </Button>
            </div>
          </form>
          {send.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(send.error)}
            </p>
          ) : null}
        </Card>
      ) : (
        <p className="text-sm text-text-muted">
          You can read this feed but not post to it.
        </p>
      )}

      {unreadIds.length > 0 ? (
        <Button
          type="button"
          variant="secondary"
          pending={readAll.isPending}
          onClick={() => readAll.mutate(unreadIds)}
        >
          Mark {unreadIds.length} as read
        </Button>
      ) : null}

      {thread.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : thread.isError ? (
        <ErrorState message={errorMessage(thread.error)} onRetry={() => void thread.refetch()} />
      ) : messages.length === 0 ? (
        <EmptyState
          title="Nothing has been said here yet"
          description="This feed exists but carries no messages. Post the first one with the box above."
        />
      ) : (
        <>
          <p className="text-xs text-text-muted">Newest first</p>
          <ul className="space-y-2">
            {messages.map((message: Message) => {
              const mine = message.senderId === user?.id;
              return (
                <li key={message.id}>
                  <Card className={mine ? 'border-primary/40 p-3' : 'p-3'}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-text">
                        {mine ? 'You' : (message.senderName ?? 'Unknown sender')}
                      </span>
                      <span className="text-xs text-text-muted">{time(message.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-text">{message.body}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-text-muted">
                        {relative(message.createdAt)}
                      </span>
                      {message.isPinned ? <Badge tone="warning">Pinned</Badge> : null}
                      {canPin && !message.isPinned ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          pending={pinToggle.isPending}
                          onClick={() => pinToggle.mutate({ id: message.id, pinned: true })}
                        >
                          Pin
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pinToggle.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(pinToggle.error)}
        </p>
      ) : null}
    </div>
  );
}
