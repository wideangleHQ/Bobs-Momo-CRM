'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import {
  dueLabel,
  isChecklist,
  listTasks,
  PRIORITY_TONE,
  STATUS_TONE,
  type TaskRow,
  type TaskStatus,
} from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';

// Overdue first, because that is the column a manager opens the board to see.
const COLUMNS: TaskStatus[] = ['OVERDUE', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'];

export default function TaskBoardPage() {
  const can = useCan();
  const [search, setSearch] = useState('');

  const query = {
    status: COLUMNS.join(','),
    q: search.trim().length >= 2 ? search.trim() : undefined,
    pageSize: 100,
  };
  const tasks = useQuery({
    queryKey: taskKeys.list(query),
    queryFn: () => listTasks(query),
    refetchOnWindowFocus: true,
  });

  const rows = tasks.data?.data ?? [];
  const grouped = COLUMNS.map((status) => ({
    status,
    rows: rows.filter((t) => t.status === status),
  })).filter((c) => c.rows.length > 0);

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Task board"
        subtitle={tasks.data ? `${tasks.data.meta.total} tasks` : undefined}
        action={
          can('task.task.create') ? (
            <Link href="/tasks/new">
              <Button type="button" className="min-h-[44px]">
                Create task
              </Button>
            </Link>
          ) : null
        }
      />

      <Input
        aria-label="Search tasks"
        placeholder="Search tasks"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {can('task.template.manage') ? (
        <div className="flex flex-wrap gap-3">
          <Link className="text-sm underline" href="/tasks/templates">
            Checklist templates
          </Link>
          <Link className="text-sm underline" href="/tasks/recurrences">
            Recurrences
          </Link>
        </div>
      ) : null}

      {tasks.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : tasks.isError ? (
        <ErrorState
          title="Could not load the board"
          message={(tasks.error as Error).message}
          onRetry={() => void tasks.refetch()}
        />
      ) : grouped.length === 0 ? (
        <EmptyState
          title="No tasks match"
          description="Clear the search, or create the first task for this outlet."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {grouped.map((column) => (
            <section key={column.status} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                {column.status} · {column.rows.length}
              </h2>
              <ul className="space-y-2">
                {column.rows.map((t: TaskRow) => (
                  <li key={t.id}>
                    <Link href={isChecklist(t) ? `/tasks/${t.id}/checklist` : `/tasks/${t.id}`}>
                      <Card className="space-y-1 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium">{t.title}</p>
                          <Badge variant={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                        </div>
                        <p className="text-sm text-text-muted">
                          {t.assigneeName ?? 'Unassigned'} · {dueLabel(t.dueAt)}
                        </p>
                        <Badge variant={STATUS_TONE[t.status]}>{t.status}</Badge>
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
