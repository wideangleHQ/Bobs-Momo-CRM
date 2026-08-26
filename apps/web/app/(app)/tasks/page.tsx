'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import {
  dueLabel,
  getMyTasks,
  isChecklist,
  PRIORITY_TONE,
  type TaskRow,
} from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';

function byDue(a: TaskRow, b: TaskRow): number {
  if (!a.dueAt) return b.dueAt ? 1 : 0;
  if (!b.dueAt) return -1;
  return Date.parse(a.dueAt) - Date.parse(b.dueAt);
}

export default function MyTasksPage() {
  const can = useCan();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const tasks = useQuery({ queryKey: taskKeys.my(), queryFn: getMyTasks });

  const groups: { key: string; label: string; rows: TaskRow[] }[] = [
    { key: 'overdue', label: 'Overdue', rows: [...(tasks.data?.overdue ?? [])].sort(byDue) },
    { key: 'today', label: 'Today', rows: [...(tasks.data?.today ?? [])].sort(byDue) },
    { key: 'upcoming', label: 'Coming up', rows: [...(tasks.data?.upcoming ?? [])].sort(byDue) },
  ];
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
      <PageHeader
        title="My tasks"
        action={
          can('task.task.create') ? (
            <Link href="/tasks/board">
              <Button type="button" variant="secondary" className="min-h-[44px]">
                Board
              </Button>
            </Link>
          ) : null
        }
      />

      {tasks.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : tasks.isError ? (
        <ErrorState
          title="Could not load your tasks"
          message={(tasks.error as Error).message}
          onRetry={() => void tasks.refetch()}
        />
      ) : total === 0 ? (
        <EmptyState
          title="Nothing due right now"
          description="Nothing is assigned to you. Check back after the next checklist is generated."
        />
      ) : (
        <div className="space-y-4">
          {groups
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.key} className="space-y-2">
                <h2 className="sticky top-0 z-10 bg-white py-1 text-sm font-semibold uppercase tracking-wide text-text-muted">
                  {g.label} · {g.rows.length}
                </h2>
                <ul className="space-y-2">
                  {g.rows.map((t) => (
                    <li key={t.id}>
                      {/* A checklist card opens the checklist, not a detail page
                          in front of it. Two taps, never five. */}
                      <Link href={isChecklist(t) ? `/tasks/${t.id}/checklist` : `/tasks/${t.id}`}>
                        <Card className="flex min-h-[56px] items-center justify-between gap-3 p-4">
                          <div>
                            <p className="font-medium">{t.title}</p>
                            <p className="text-sm text-text-muted">
                              {dueLabel(t.dueAt, now)}
                              {typeof t.itemCount === 'number'
                                ? ` · ${t.completedItemCount ?? 0} of ${t.itemCount}`
                                : ''}
                            </p>
                          </div>
                          <Badge variant={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
