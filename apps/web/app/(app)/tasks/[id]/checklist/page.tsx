'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { submitChecklistSchema } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { getTask, submitChecklist, type ChecklistResultValue } from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';
import { uploadTaskPhoto } from '@/features/tasks/upload';

interface Answer {
  result: ChecklistResultValue;
  note: string;
  attachmentId: string | null;
  uploading?: boolean;
  photoError?: string | null;
}

const CHOICES: ChecklistResultValue[] = ['PASS', 'FAIL', 'NA'];

export default function ChecklistRunPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const task = useQuery({ queryKey: taskKeys.detail(id), queryFn: () => getTask(id) });

  const submit = useMutation({
    mutationFn: (body: unknown) => submitChecklist(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      router.push('/tasks');
    },
    onError: (err: Error) => setProblem(err.message),
  });

  if (task.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-56" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (task.isError || !task.data) {
    return (
      <div className="p-4">
        <ErrorState
          title="Could not load this checklist"
          message={(task.error as Error | null)?.message ?? 'That task does not exist'}
          onRetry={() => void task.refetch()}
        />
      </div>
    );
  }

  const items = [...(task.data.template?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  if (items.length === 0) {
    return (
      <div className="p-4">
        <ErrorState
          title="This checklist has no items yet"
          message="Tell your manager. Nothing can be recorded against an empty template."
        />
      </div>
    );
  }

  const answered = items.filter((i) => answers[i.id]).length;
  const firstUnanswered = items.find((i) => !answers[i.id]);

  const set = (itemId: string, patch: Partial<Answer>) => {
    setAnswers((prev) => {
      const current = prev[itemId] ?? { result: 'PASS' as const, note: '', attachmentId: null };
      return { ...prev, [itemId]: { ...current, ...patch } };
    });
  };

  const onPhoto = async (itemId: string, file: File | undefined) => {
    if (!file) return;
    set(itemId, { uploading: true, photoError: null });
    try {
      const attachmentId = await uploadTaskPhoto(id, file);
      set(itemId, { attachmentId, uploading: false });
    } catch (err) {
      set(itemId, { uploading: false, photoError: (err as Error).message });
    }
  };

  const onSubmit = () => {
    setProblem(null);
    if (firstUnanswered) {
      // Doing nothing is how a cook decides the app is broken.
      document.getElementById(`item-${firstUnanswered.id}`)?.scrollIntoView({ block: 'center' });
      setProblem('Answer every item before you submit. Jumped to the first one left.');
      return;
    }
    const missingNote = items.find(
      (i) =>
        (i.requiresNote || answers[i.id]?.result === 'FAIL') &&
        (answers[i.id]?.note ?? '').trim() === '',
    );
    if (missingNote) {
      document.getElementById(`item-${missingNote.id}`)?.scrollIntoView({ block: 'center' });
      setProblem(`"${missingNote.label}" needs a note before it can be submitted.`);
      return;
    }
    const missingPhoto = items.find((i) => i.requiresPhoto && !answers[i.id]?.attachmentId);
    if (missingPhoto) {
      document.getElementById(`item-${missingPhoto.id}`)?.scrollIntoView({ block: 'center' });
      setProblem(`"${missingPhoto.label}" needs a photo before it can be submitted.`);
      return;
    }

    const parsed = submitChecklistSchema.safeParse({
      results: items.map((i) => {
        const a = answers[i.id];
        return {
          templateItemId: i.id,
          result: a?.result ?? 'NA',
          note: (a?.note ?? '').trim() === '' ? null : (a?.note ?? '').trim(),
          attachmentId: a?.attachmentId ?? null,
        };
      }),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the answers');
      return;
    }
    submit.mutate(parsed.data);
  };

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-3 p-4 pb-28">
      <PageHeader
        title={task.data.template?.name ?? task.data.title}
        subtitle={`${answered} of ${items.length}`}
      />

      <div
        role="progressbar"
        aria-valuenow={answered}
        aria-valuemin={0}
        aria-valuemax={items.length}
        className="h-2 w-full rounded bg-border"
      >
        <div
          className="h-2 rounded bg-neutral-800"
          style={{ width: `${(answered / items.length) * 100}%` }}
        />
      </div>

      <ol className="space-y-3">
        {items.map((item, index) => {
          const a = answers[item.id];
          const needsNote = item.requiresNote || a?.result === 'FAIL';
          return (
            <li key={item.id} id={`item-${item.id}`}>
              <Card className="space-y-3 p-4">
                <p className="font-medium">
                  {index + 1}. {item.label}
                </p>
                <div className="flex gap-2">
                  {CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant={a?.result === choice ? 'primary' : 'secondary'}
                      className="min-h-[52px] flex-1"
                      onClick={() => set(item.id, { result: choice })}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>

                {needsNote ? (
                  <div className="space-y-1">
                    <Textarea
                      aria-label={`Note for ${item.label}`}
                      rows={2}
                      placeholder="What was wrong"
                      value={a?.note ?? ''}
                      onChange={(e) => set(item.id, { note: e.target.value })}
                    />
                    <p className="text-sm text-text-muted">Note required</p>
                  </div>
                ) : null}

                {item.requiresPhoto ? (
                  <div className="space-y-1">
                    <label className="block text-sm text-text-muted" htmlFor={`photo-${item.id}`}>
                      Photo required
                    </label>
                    <input
                      id={`photo-${item.id}`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="min-h-[44px] w-full"
                      onChange={(e) => void onPhoto(item.id, e.target.files?.[0])}
                    />
                    {a?.uploading ? <p className="text-sm">Uploading...</p> : null}
                    {a?.attachmentId ? <p className="text-sm text-green-700">Photo added</p> : null}
                    {a?.photoError ? (
                      <p role="alert" className="text-sm text-danger">
                        {a.photoError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {a?.result === 'FAIL' && item.failCreatesTask ? (
                  <p className="text-sm text-amber-700">Will create a follow-up task</p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="fixed inset-x-0 bottom-0 z-20 space-y-2 border-t bg-white p-3">
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        <Button
          type="button"
          className="min-h-[56px] w-full text-lg"
          disabled={submit.isPending}
          onClick={onSubmit}
        >
          {submit.isPending ? 'Submitting...' : `Submit, ${answered} of ${items.length} done`}
        </Button>
      </div>
    </div>
  );
}
