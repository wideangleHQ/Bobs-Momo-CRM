'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Icon } from '@/components/ui/icons';

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

  const groups: { key: string; label: string; tone: string; rows: TaskRow[] }[] = [
    { key: 'overdue', label: 'Overdue Tasks', tone: 'bg-red-50 text-red-700 border-red-200', rows: [...(tasks.data?.overdue ?? [])].sort(byDue) },
    { key: 'today', label: 'Due Today', tone: 'bg-amber-50 text-amber-700 border-amber-200', rows: [...(tasks.data?.today ?? [])].sort(byDue) },
    { key: 'upcoming', label: 'Upcoming', tone: 'bg-zinc-50 text-zinc-700 border-zinc-200', rows: [...(tasks.data?.upcoming ?? [])].sort(byDue) },
  ];

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const overdueCount = tasks.data?.overdue?.length ?? 0;
  const todayCount = tasks.data?.today?.length ?? 0;
  const upcomingCount = tasks.data?.upcoming?.length ?? 0;

  return (
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-100">
        <PageHeader
          title="Daily Checklists & Tasks"
          description="Operational opening, closing and food-safety checklist tasks assigned to you."
        />

        <div className="flex flex-wrap items-center gap-2.5">
          {can('task.template.manage') && (
            <Link href="/tasks/templates">
              <Button type="button" variant="secondary" className="min-h-[40px] text-xs sm:text-sm gap-1.5">
                <Icon name="layers" className="h-3.5 w-3.5" />
                <span>Templates</span>
              </Button>
            </Link>
          )}

          {can('task.task.create') && (
            <Link href="/tasks/board">
              <Button type="button" className="min-h-[40px] text-xs sm:text-sm gap-1.5 bg-red-600 hover:bg-red-700 text-white">
                <Icon name="tasks" className="h-3.5 w-3.5" />
                <span>Task Board</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── TELEMETRY SUMMARY CARDS ────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Overdue */}
        <div className={`rounded-2xl border p-4 sm:p-5 flex items-center justify-between transition-all ${
          overdueCount > 0 ? 'bg-red-50/50 border-red-200 shadow-sm' : 'bg-white border-zinc-200/80 shadow-sm'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              overdueCount > 0 ? 'bg-red-100 text-red-600' : 'bg-zinc-100 text-zinc-500'
            }`}>
              <Icon name="warning" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Overdue</p>
              <p className={`text-2xl font-bold tracking-tight tabular-nums ${overdueCount > 0 ? 'text-red-700' : 'text-zinc-900'}`}>
                {overdueCount}
              </p>
            </div>
          </div>
        </div>

        {/* Today */}
        <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
              <Icon name="clock" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Due Today</p>
              <p className="text-2xl font-bold tracking-tight text-zinc-900 tabular-nums">
                {todayCount}
              </p>
            </div>
          </div>
        </div>

        {/* Coming Up */}
        <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
              <Icon name="calendar" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Coming Up</p>
              <p className="text-2xl font-bold tracking-tight text-zinc-900 tabular-nums">
                {upcomingCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── TASK LIST ──────────────────────────────────────── */}
      {tasks.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : tasks.isError ? (
        <ErrorState
          title="Could not load your tasks"
          message={(tasks.error as Error).message}
          onRetry={() => void tasks.refetch()}
        />
      ) : total === 0 ? (
        <div className="rounded-2xl border border-zinc-200/80 bg-white shadow-sm p-10 flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-3 text-emerald-600">
            <Icon name="check" className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900">All caught up!</h2>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1 max-w-sm">
            Nothing is assigned or due right now. Check back when the next opening or closing shift checklist is generated.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                    {g.label}
                  </h2>
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${g.tone}`}>
                    {g.rows.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {g.rows.map((t) => (
                    <Link
                      key={t.id}
                      href={isChecklist(t) ? `/tasks/${t.id}/checklist` : `/tasks/${t.id}`}
                      className="group relative flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="h-8 w-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700 flex-shrink-0 group-hover:bg-red-50 group-hover:text-red-600 transition-colors">
                            <Icon name={isChecklist(t) ? 'clipboard' : 'tasks'} className="h-4 w-4" />
                          </div>
                          <Badge variant={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                        </div>

                        <h3 className="font-bold text-sm sm:text-base text-zinc-900 group-hover:text-red-600 transition-colors line-clamp-1">
                          {t.title}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                          <Icon name="clock" className="h-3 w-3 text-zinc-400" />
                          <span>{dueLabel(t.dueAt, now)}</span>
                          {typeof t.itemCount === 'number' ? (
                            <span className="text-zinc-400">· {t.completedItemCount ?? 0}/{t.itemCount} items done</span>
                          ) : null}
                        </p>
                      </div>

                      <div className="mt-4 pt-2.5 border-t border-zinc-100 flex items-center justify-between text-xs font-semibold text-zinc-400 group-hover:text-zinc-800 transition-colors">
                        <span>{isChecklist(t) ? 'Open checklist' : 'View task'}</span>
                        <Icon name="arrowRight" className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
