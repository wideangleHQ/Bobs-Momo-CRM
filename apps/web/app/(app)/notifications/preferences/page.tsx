'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/api';
import {
  fetchPreferences,
  notificationKeys,
  savePreferences,
  type NotificationPreference,
} from '../api';

function prefId(eventKey: string, channel: string): string {
  return `${eventKey}:${channel}`;
}

function eventLabel(eventKey: string): string {
  const words = eventKey.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function NotificationPreferencesPage() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: fetchPreferences,
    staleTime: 5 * 60 * 1000,
  });

  const save = useMutation({
    mutationFn: (rows: Array<Omit<NotificationPreference, 'locked'>>) => savePreferences(rows),
    onSuccess: () => {
      setPending({});
      void queryClient.invalidateQueries({ queryKey: notificationKeys.preferences() });
    },
  });

  const grouped = useMemo(() => {
    const rows = query.data?.data ?? [];
    const byEvent = new Map<string, NotificationPreference[]>();
    for (const row of rows) {
      byEvent.set(row.eventKey, [...(byEvent.get(row.eventKey) ?? []), row]);
    }
    return [...byEvent.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [query.data]);

  const enabledFor = (row: NotificationPreference): boolean =>
    pending[prefId(row.eventKey, row.channel)] ?? row.enabled;

  const changed = Object.keys(pending).length > 0;

  function submit() {
    const rows = (query.data?.data ?? [])
      .filter((row) => prefId(row.eventKey, row.channel) in pending)
      .map((row) => ({
        eventKey: row.eventKey,
        channel: row.channel,
        enabled: enabledFor(row),
      }));
    if (rows.length > 0) save.mutate(rows);
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Notification preferences"
        description="Which alerts reach you, and on which channel"
      />

      <p className="text-sm text-text-muted">
        In-app alerts cannot be turned off, because a manager has to be able to prove a notice was
        delivered. WhatsApp is yours to switch off per event.
      </p>

      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : grouped.length === 0 ? (
        <EmptyState
          title="No preferences to set"
          description="Your role receives no event notifications, so there is nothing to turn on or off here."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {grouped.map(([eventKey, rows]) => (
              <li key={eventKey}>
                <Card className="p-3">
                  <h2 className="text-sm font-semibold text-text">{eventLabel(eventKey)}</h2>
                  <div className="mt-2 space-y-1">
                    {rows.map((row) => (
                      <Checkbox
                        key={row.channel}
                        id={prefId(row.eventKey, row.channel)}
                        checked={enabledFor(row)}
                        disabled={row.locked}
                        label={
                          row.locked
                            ? `${row.channel.replaceAll('_', ' ').toLowerCase()} (always on)`
                            : row.channel.replaceAll('_', ' ').toLowerCase()
                        }
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setPending((prev) => ({
                            ...prev,
                            [prefId(row.eventKey, row.channel)]: e.target.checked,
                          }))
                        }
                      />
                    ))}
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {save.isError ? (
            <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">
              {errorMessage(save.error)}
            </p>
          ) : null}

          {save.isSuccess && !changed ? (
            <p role="status" className="rounded-md bg-success-bg p-3 text-sm text-success">
              Preferences saved.
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" pending={save.isPending} disabled={!changed} onClick={submit}>
              Save changes
            </Button>
            {changed ? (
              <Button type="button" variant="secondary" onClick={() => setPending({})}>
                Discard
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
