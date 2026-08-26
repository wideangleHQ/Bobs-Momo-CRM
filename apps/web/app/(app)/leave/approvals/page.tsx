'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { longDate } from '@/lib/format';
import { cancelLeave, decideLeave, listLeave, type LeaveRequest, type LeaveStatus } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';

const TABS: { key: LeaveStatus; label: string }[] = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function LeaveApprovalsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LeaveStatus>('PENDING');
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const query = { status, pageSize: 50 };
  const queue = useQuery({
    queryKey: workforceKeys.leave(query),
    queryFn: () => listLeave(query),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['leave'] });

  const approve = useMutation({
    mutationFn: (id: string) => decideLeave(id, 'approve', {}),
    onSuccess: invalidate,
    onError: (err: Error) => setProblem(err.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelLeave(id),
    onSuccess: invalidate,
    onError: (err: Error) => setProblem(err.message),
  });

  const rows = queue.data?.data ?? [];

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 p-4">
      <PageHeader
        title="Leave approvals"
        subtitle={status === 'PENDING' && queue.data ? `${queue.data.meta.total} waiting` : undefined}
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            type="button"
            variant={status === t.key ? 'primary' : 'secondary'}
            className="min-h-[44px]"
            onClick={() => setStatus(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {queue.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : queue.isError ? (
        <ErrorState
          title="Could not load the queue"
          message={(queue.error as Error).message}
          onRetry={() => void queue.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No leave requests waiting"
          description="Approved and rejected requests are in the other tabs."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((l) => (
            <li key={l.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{l.employeeName}</p>
                    <p className="text-sm text-text-muted">
                      {l.type} · {longDate(`${l.fromDate}T00:00:00.000Z`)}
                      {l.fromDate === l.toDate
                        ? ''
                        : ` to ${longDate(`${l.toDate}T00:00:00.000Z`)}`}
                      {` · ${l.dayCount} d`}
                    </p>
                  </div>
                  <Badge variant={l.status === 'PENDING' ? 'warning' : 'neutral'}>{l.status}</Badge>
                </div>
                <p className="text-sm">{l.reason}</p>
                {l.decisionNote ? (
                  <p className="text-sm text-text-muted">Decision note: {l.decisionNote}</p>
                ) : null}

                {l.status === 'PENDING' ? (
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-[44px] flex-1"
                      onClick={() => setRejecting(l)}
                    >
                      Reject
                    </Button>
                    <Button
                      type="button"
                      className="min-h-[44px] flex-1"
                      disabled={approve.isPending}
                      onClick={() => {
                        setProblem(null);
                        approve.mutate(l.id);
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                ) : null}

                {l.status === 'APPROVED' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[44px] w-full"
                    disabled={cancel.isPending}
                    onClick={() => {
                      setProblem(null);
                      cancel.mutate(l.id);
                    }}
                  >
                    Cancel this approved leave
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}

      {rejecting ? (
        <RejectDialog
          request={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function RejectDialog({
  request,
  onClose,
  onDone,
}: {
  request: LeaveRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const reject = useMutation({
    mutationFn: (decisionNote: string) => decideLeave(request.id, 'reject', { decisionNote }),
    onSuccess: onDone,
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    // A rejection the employee cannot understand generates the conversation
    // this screen exists to prevent.
    if (note.trim().length < 5) {
      setProblem('Give a reason of at least five characters so they know what to do next.');
      return;
    }
    reject.mutate(note.trim());
  };

  return (
    <Dialog open onClose={onClose} title={`Reject ${request.employeeName}'s request`}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label htmlFor="decisionNote">Why, required</Label>
          <Textarea
            id="decisionNote"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-sm text-text-muted">
            They see this on their leave screen. Say what would change your answer.
          </p>
        </div>
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="min-h-[44px] flex-1" onClick={onClose}>
            Back
          </Button>
          <Button
            type="submit"
            variant="danger"
            className="min-h-[44px] flex-1"
            disabled={reject.isPending}
          >
            {reject.isPending ? 'Sending...' : 'Reject'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
