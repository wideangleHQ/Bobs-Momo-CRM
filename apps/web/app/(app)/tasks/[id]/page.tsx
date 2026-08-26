'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { cancelTaskSchema, createCommentSchema } from '@bobs-momo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCan, useSession } from '@/lib/auth';
import { relative, time } from '@/lib/format';
import {
  ACTIONABLE,
  addComment,
  cancelTask,
  completeTask,
  dueLabel,
  getTask,
  isChecklist,
  PRIORITY_TONE,
  startTask,
  STATUS_TONE,
  verifyTask,
} from '@/features/tasks/api';
import { taskKeys } from '@/features/tasks/keys';

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const can = useCan();
  const { user } = useSession();
  const queryClient = useQueryClient();

  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const task = useQuery({ queryKey: taskKeys.detail(id), queryFn: () => getTask(id) });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const start = useMutation({
    mutationFn: () => startTask(id),
    onSuccess: invalidate,
    onError: (err: Error) => setProblem(err.message),
  });

  const complete = useMutation({
    mutationFn: (body: unknown) => completeTask(id, body),
    onSuccess: () => {
      setNote('');
      invalidate();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const verify = useMutation({
    mutationFn: () => verifyTask(id, {}),
    onSuccess: invalidate,
    onError: (err: Error) => setProblem(err.message),
  });

  const cancel = useMutation({
    mutationFn: (body: unknown) => cancelTask(id, body),
    onSuccess: () => {
      setCancelling(false);
      invalidate();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const post = useMutation({
    mutationFn: (body: unknown) => addComment(id, body),
    onSuccess: () => {
      setComment('');
      invalidate();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  // Opening the task is the start. Asking somebody to press two buttons costs a
  // completion, and recording that they looked at it costs nothing.
  const autoStarted = useRef(false);
  const data = task.data;
  const isAssignee = Boolean(data && user?.employeeId && data.assigneeId === user.employeeId);
  useEffect(() => {
    if (!data || autoStarted.current) return;
    if (!isAssignee || isChecklist(data)) return;
    if (data.status !== 'OPEN' && data.status !== 'OVERDUE') return;
    autoStarted.current = true;
    start.mutate();
  }, [data, isAssignee, start]);

  if (task.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (task.isError || !data) {
    return (
      <div className="p-4">
        <ErrorState
          title="Could not load this task"
          message={(task.error as Error | null)?.message ?? 'That task does not exist'}
          onRetry={() => void task.refetch()}
        />
      </div>
    );
  }

  const actionable = ACTIONABLE.includes(data.status);
  const comments = data.comments ?? [];

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 p-4 pb-28">
      <PageHeader
        title={data.title}
        subtitle={dueLabel(data.dueAt)}
        action={
          <div className="flex gap-2">
            <Badge variant={STATUS_TONE[data.status]}>{data.status}</Badge>
            <Badge variant={PRIORITY_TONE[data.priority]}>{data.priority}</Badge>
          </div>
        }
      />

      <Card className="space-y-2 p-4">
        {data.description ? <p className="text-sm">{data.description}</p> : null}
        <p className="text-sm text-text-muted">
          {data.assigneeName ? `Assigned to ${data.assigneeName}` : 'Unassigned'}
        </p>
        {data.completedAt ? (
          <p className="text-sm text-text-muted">Completed {relative(data.completedAt)}</p>
        ) : null}
        {isChecklist(data) ? (
          <Link className="text-sm underline" href={`/tasks/${id}/checklist`}>
            Open the checklist
          </Link>
        ) : null}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-base font-semibold">Comments</h2>
        {comments.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing said about this one yet.</p>
        ) : (
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="border-t pt-2 first:border-t-0">
                <p className="text-sm text-text-muted">
                  {c.authorName ?? 'Someone'} {time(c.createdAt)}
                </p>
                <p className="text-sm">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <Label htmlFor="comment">Write a comment</Label>
          <Textarea
            id="comment"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px] w-full"
            disabled={post.isPending}
            onClick={() => {
              setProblem(null);
              const parsed = createCommentSchema.safeParse({ body: comment.trim() });
              if (!parsed.success) {
                setProblem(parsed.error.issues[0]?.message ?? 'Write something first');
                return;
              }
              post.mutate(parsed.data);
            }}
          >
            Post comment
          </Button>
        </div>
      </Card>

      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}

      {/* Overdue keeps every action an open task has. A late job is still a job. */}
      <div className="fixed inset-x-0 bottom-0 z-20 space-y-2 border-t bg-white p-3">
        {actionable && !isChecklist(data) && can('task.task.complete') ? (
          <>
            <Textarea
              rows={2}
              placeholder="Note, optional"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              type="button"
              className="min-h-[52px] w-full text-lg"
              disabled={complete.isPending}
              onClick={() => {
                setProblem(null);
                complete.mutate(note.trim() === '' ? {} : { note: note.trim() });
              }}
            >
              {complete.isPending ? 'Saving...' : 'Mark complete'}
            </Button>
          </>
        ) : null}

        <div className="flex gap-2">
          {actionable && data.status === 'OPEN' && !isChecklist(data) ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-[44px] flex-1"
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              Start
            </Button>
          ) : null}

          {data.status === 'COMPLETED' && data.requiresVerification && can('task.task.verify') ? (
            <Button
              type="button"
              className="min-h-[44px] flex-1"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
            >
              Verify
            </Button>
          ) : null}

          {actionable && can('task.task.cancel') ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-[44px] flex-1"
              onClick={() => setCancelling(true)}
            >
              Cancel task
            </Button>
          ) : null}
        </div>
      </div>

      {cancelling ? (
        <Dialog open onClose={() => setCancelling(false)} title="Cancel this task">
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              A cancelled task drops out of the assignee's completion rate, so the reason is stored
              with your name against it.
            </p>
            <div className="space-y-1">
              <Label htmlFor="cancelReason">Reason, required</Label>
              <Textarea
                id="cancelReason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
            {problem ? (
              <p role="alert" className="text-sm text-danger">
                {problem}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] flex-1"
                onClick={() => setCancelling(false)}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="danger"
                className="min-h-[44px] flex-1"
                disabled={cancel.isPending}
                onClick={() => {
                  setProblem(null);
                  const parsed = cancelTaskSchema.safeParse({ reason: cancelReason.trim() });
                  if (!parsed.success) {
                    setProblem(parsed.error.issues[0]?.message ?? 'Give a reason');
                    return;
                  }
                  cancel.mutate(parsed.data);
                }}
              >
                Cancel task
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
