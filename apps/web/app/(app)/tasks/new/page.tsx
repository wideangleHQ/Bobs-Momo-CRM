'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createTaskSchema, TASK_PRIORITIES } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { listEmployees } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { outletOptionsFrom } from '@/features/workforce/employee-form';
import { createTask, listTemplates, type TaskPriority } from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';

export default function NewTaskPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [outletId, setOutletId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [dueAt, setDueAt] = useState('');
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: workforceKeys.employees({ status: 'ACTIVE', pageSize: 100 }),
    queryFn: () => listEmployees({ status: 'ACTIVE', pageSize: 100 }),
    staleTime: 5 * 60_000,
  });

  const templates = useQuery({
    queryKey: taskKeys.templates({ isActive: 'true' }),
    queryFn: () => listTemplates({ isActive: 'true' }),
    staleTime: 5 * 60_000,
  });

  const staff = roster.data?.data ?? [];
  const outlets = outletOptionsFrom(staff);
  const chosenOutlet = outletId || outlets[0]?.outletId || '';
  const departments = outlets.find((o) => o.outletId === chosenOutlet)?.departments ?? [];
  const assignable = staff.filter((s) => s.outletId === chosenOutlet);

  const create = useMutation({
    mutationFn: (body: unknown) => createTask(body),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      router.push(`/tasks/${task.id}`);
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = createTaskSchema.safeParse({
      title: title.trim(),
      description: description.trim() === '' ? null : description.trim(),
      outletId: chosenOutlet,
      departmentId: departmentId === '' ? null : departmentId,
      assigneeId: assigneeId === '' ? null : assigneeId,
      templateId: templateId === '' ? null : templateId,
      priority,
      dueAt: dueAt === '' ? null : new Date(dueAt).toISOString(),
      requiresVerification,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setProblem(first ? `${first.path.join('.')}: ${first.message}` : 'Check the form');
      return;
    }
    create.mutate(parsed.data);
  };

  if (roster.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
      <PageHeader title="Create task" subtitle="Assign work to somebody" />
      <Card className="p-4">
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="outletId">Outlet</Label>
            <Select
              id="outletId"
              value={chosenOutlet}
              onChange={(e) => {
                setOutletId(e.target.value);
                setDepartmentId('');
                setAssigneeId('');
              }}
            >
              {outlets.map((o) => (
                <option key={o.outletId} value={o.outletId}>
                  {o.outletCode}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="departmentId">Department</Label>
            <Select
              id="departmentId"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">Any department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="assigneeId">Assign to</Label>
            <Select
              id="assigneeId"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Leave it for whoever opens up</option>
              {assignable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="templateId">Checklist template</Label>
            <Select
              id="templateId"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">No checklist, a plain task</option>
              {(templates.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="priority">Priority</Label>
            <Select
              id="priority"
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
            <Label htmlFor="dueAt">Due</Label>
            <Input
              id="dueAt"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>

          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <Checkbox
              checked={requiresVerification}
              onChange={(e) => setRequiresVerification(e.target.checked)}
            />
            A manager must verify this after it is completed
          </label>

          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="min-h-[48px] flex-1"
              onClick={() => router.push('/tasks')}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-[48px] flex-1" disabled={create.isPending}>
              {create.isPending ? 'Saving...' : 'Create task'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
