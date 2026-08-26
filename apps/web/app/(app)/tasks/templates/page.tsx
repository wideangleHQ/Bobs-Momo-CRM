'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTemplateSchema } from '@bobs-momo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { createTemplate, listTemplates, updateTemplate } from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';

interface DraftItem {
  label: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
  failCreatesTask: boolean;
}

const BLANK: DraftItem = {
  label: '',
  requiresPhoto: false,
  requiresNote: false,
  failCreatesTask: false,
};

export default function ChecklistTemplatesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const templates = useQuery({
    queryKey: taskKeys.templates({}),
    queryFn: () => listTemplates(),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateTemplate(id, { isActive }),
    onSuccess: invalidate,
  });

  const rows = templates.data ?? [];

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 p-4">
      <PageHeader
        title="Checklist templates"
        subtitle="The opening and closing lists staff run every day"
        action={
          <Button type="button" className="min-h-[44px]" onClick={() => setCreating(true)}>
            New template
          </Button>
        }
      />

      {templates.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : templates.isError ? (
        <ErrorState
          title="Could not load templates"
          message={(templates.error as Error).message}
          onRetry={() => void templates.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Create the kitchen opening list first. A recurrence can then generate it every morning."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-sm text-text-muted">
                      {t.code} · {t.items?.length ?? 0} items
                      {t.isAudit ? ' · audit' : ''}
                    </p>
                  </div>
                  <Badge variant={t.isActive ? 'success' : 'neutral'}>
                    {t.isActive ? 'Active' : 'Retired'}
                  </Badge>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px] w-full sm:w-auto"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: t.id, isActive: !t.isActive })}
                >
                  {t.isActive ? 'Retire this template' : 'Bring it back'}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <TemplateDialog
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

function TemplateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isAudit, setIsAudit] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([{ ...BLANK }]);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => createTemplate(body),
    onSuccess: onSaved,
    onError: (err: Error) => setProblem(err.message),
  });

  const patch = (index: number, next: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...next } : it)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = createTemplateSchema.safeParse({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      isAudit,
      items: items.map((it, i) => ({ ...it, label: it.label.trim(), sortOrder: i + 1 })),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setProblem(first ? `${first.path.join('.')}: ${first.message}` : 'Check the form');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Dialog open onClose={onClose} title="New checklist template">
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            placeholder="KITCHEN_OPEN"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <Checkbox checked={isAudit} onChange={(e) => setIsAudit(e.target.checked)} />
          This is an audit, every run needs verifying
        </label>

        <div className="space-y-3">
          <Label>Items</Label>
          {items.map((it, i) => (
            <Card key={i} className="space-y-2 p-3">
              <Input
                aria-label={`Item ${i + 1} label`}
                placeholder="Fridge temperature below 5 C"
                value={it.label}
                onChange={(e) => patch(i, { label: e.target.value })}
              />
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex min-h-[44px] items-center gap-2">
                  <Checkbox
                    checked={it.requiresPhoto}
                    onChange={(e) => patch(i, { requiresPhoto: e.target.checked })}
                  />
                  Photo
                </label>
                <label className="flex min-h-[44px] items-center gap-2">
                  <Checkbox
                    checked={it.requiresNote}
                    onChange={(e) => patch(i, { requiresNote: e.target.checked })}
                  />
                  Note
                </label>
                <label className="flex min-h-[44px] items-center gap-2">
                  <Checkbox
                    checked={it.failCreatesTask}
                    onChange={(e) => patch(i, { failCreatesTask: e.target.checked })}
                  />
                  A fail makes a task
                </label>
              </div>
              {items.length > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px]"
                  onClick={() => setItems((prev) => prev.filter((_, index) => index !== i))}
                >
                  Remove item
                </Button>
              ) : null}
            </Card>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px] w-full"
            onClick={() => setItems((prev) => [...prev, { ...BLANK }])}
          >
            Add item
          </Button>
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
            {save.isPending ? 'Saving...' : 'Create template'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
