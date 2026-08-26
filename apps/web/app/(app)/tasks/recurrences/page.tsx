'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRecurrenceSchema, TASK_PRIORITIES } from '@bobs-momo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { time } from '@/lib/format';
import {
  createRecurrence,
  listRecurrences,
  listTemplates,
  updateRecurrence,
  type TaskPriority,
} from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';

/**
 * Only the first fire of each business date materialises, so anything finer
 * than daily quietly does nothing. Warn before saving rather than after.
 */
function firesMoreThanDaily(cronExpr: string): boolean {
  const [minute, hour] = cronExpr.trim().split(/\s+/);
  const single = (part: string | undefined) => Boolean(part && /^\d+$/.test(part));
  return !(single(minute) && single(hour));
}

export default function RecurrencesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const recurrences = useQuery({
    queryKey: taskKeys.recurrences({}),
    queryFn: () => listRecurrences(),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['task-recurrences'] });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateRecurrence(id, { isActive }),
    onSuccess: invalidate,
  });

  const rows = recurrences.data ?? [];

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 p-4">
      <PageHeader
        title="Task recurrences"
        subtitle="What the generator creates every business date"
        action={
          <Button type="button" className="min-h-[44px]" onClick={() => setCreating(true)}>
            New recurrence
          </Button>
        }
      />

      {recurrences.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : recurrences.isError ? (
        <ErrorState
          title="Could not load recurrences"
          message={(recurrences.error as Error).message}
          onRetry={() => void recurrences.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing is scheduled"
          description="Add a recurrence so the opening checklist appears on its own every morning."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-sm text-text-muted">
                      {r.cronExpr} · due {r.dueAfterMins} min after
                    </p>
                    {r.nextFireTimes && r.nextFireTimes.length > 0 ? (
                      <p className="text-sm text-text-muted">
                        Next: {r.nextFireTimes.map((t) => time(t)).join(', ')}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={r.isActive ? 'success' : 'neutral'}>
                    {r.isActive ? 'Active' : 'Stopped'}
                  </Badge>
                </div>
                {firesMoreThanDaily(r.cronExpr) ? (
                  <p className="text-sm text-amber-700">
                    This fires more than once a day. Only the first fire of each business date
                    creates a task.
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px] w-full sm:w-auto"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}
                >
                  {r.isActive ? 'Stop generating' : 'Start generating'}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <RecurrenceDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function RecurrenceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [cronExpr, setCronExpr] = useState('0 6 * * *');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [dueAfterMins, setDueAfterMins] = useState('120');
  const [problem, setProblem] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: taskKeys.templates({ isActive: 'true' }),
    queryFn: () => listTemplates({ isActive: 'true' }),
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: (body: unknown) => createRecurrence(body),
    onSuccess: onSaved,
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = createRecurrenceSchema.safeParse({
      name: name.trim(),
      cronExpr: cronExpr.trim(),
      templateId: templateId === '' ? null : templateId,
      title: title.trim() === '' ? null : title.trim(),
      priority,
      dueAfterMins: Number(dueAfterMins),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setProblem(first ? `${first.path.join('.')}: ${first.message}` : 'Check the form');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Dialog open onClose={onClose} title="New recurrence">
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label htmlFor="recName">Name</Label>
          <Input id="recName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cronExpr">Cron expression</Label>
          <Input
            id="cronExpr"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="0 6 * * *"
          />
          {firesMoreThanDaily(cronExpr) ? (
            <p className="text-sm text-amber-700">
              This fires more than once a day. Only the first fire of each business date creates a
              task, so the rest will do nothing.
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="recTemplate">Checklist template</Label>
          <Select
            id="recTemplate"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">No template, use a title instead</option>
            {(templates.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="recTitle">Task title</Label>
          <Input
            id="recTitle"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Only needed when there is no template"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="recPriority">Priority</Label>
          <Select
            id="recPriority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dueAfterMins">Due this many minutes after it is created</Label>
          <Input
            id="dueAfterMins"
            inputMode="numeric"
            value={dueAfterMins}
            onChange={(e) => setDueAfterMins(e.target.value)}
          />
        </div>

        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="min-h-[44px] flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-[44px] flex-1" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : 'Create recurrence'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
