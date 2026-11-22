'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { longDate, time } from '@/lib/format';
import {
  getVerificationQueue,
  hm,
  rejectDay,
  verifyDay,
  type VerificationQueueRow,
} from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';

type Decision = { row: VerificationQueueRow; mode: 'verify' | 'reject' };

export default function VerifyAttendancePage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = { page, pageSize: 25 };
  const queue = useQuery({
    queryKey: workforceKeys.verificationQueue(query),
    queryFn: () => getVerificationQueue(query),
    enabled: can('workforce.attendance.verify'),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['attendance'] });

  if (!can('workforce.attendance.verify')) {
    return (
      <div className="mx-auto w-full max-w-[720px] space-y-4 p-4">
        <PageHeader title="Verify attendance" />
        <EmptyState
          title="You cannot verify attendance"
          description="Only the Store Manager of an outlet verifies its attendance."
        />
      </div>
    );
  }

  const rows = queue.data?.data ?? [];
  const meta = queue.data?.meta;

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 p-4">
      <PageHeader
        title="Verify attendance"
        subtitle={meta ? `${meta.total} waiting` : undefined}
      />

      {notice ? (
        <p role="status" className="text-sm text-text-muted">
          {notice}
        </p>
      ) : null}

      {queue.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
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
          title="Nothing to verify"
          description="New submissions from your outlet appear here."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-3 p-4">
                <div>
                  <p className="font-medium">
                    {r.employeeName}
                    <span className="ml-2 text-sm font-normal text-text-muted">{r.employeeCode}</span>
                  </p>
                  <p className="text-sm text-text-muted">
                    {longDate(`${r.businessDate}T00:00:00.000Z`)}
                    {r.outletCode ? ` · ${r.outletCode}` : ''}
                  </p>
                </div>

                <p className="text-sm">
                  {r.firstInAt ? `In ${time(r.firstInAt)}` : 'No in punch'}
                  {r.lastOutAt ? ` · out ${time(r.lastOutAt)}` : ' · not punched out'}
                  {` · worked ${hm(r.workedMins)}`}
                  {r.breakMins > 0 ? ` · break ${hm(r.breakMins)}` : ''}
                </p>
                {r.lateMins > 0 ? (
                  <p className="text-sm text-amber-700">Late by {r.lateMins} min</p>
                ) : null}

                <p className="text-sm text-text-muted">
                  {r.location
                    ? `Location: ${r.location.distanceM} m from the outlet` +
                      (r.location.radiusM !== null ? ` (limit ${r.location.radiusM} m)` : '') +
                      (r.location.accuracyM !== null
                        ? `, device accuracy ${r.location.accuracyM} m`
                        : '')
                    : 'No location recorded (entered by a manager)'}
                </p>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[44px] flex-1"
                    onClick={() => {
                      setNotice(null);
                      setDeciding({ row: r, mode: 'reject' });
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    type="button"
                    className="min-h-[44px] flex-1"
                    onClick={() => {
                      setNotice(null);
                      setDeciding({ row: r, mode: 'verify' });
                    }}
                  >
                    Verify
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-text-muted">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      {deciding ? (
        <DecisionDialog
          decision={deciding}
          onClose={() => setDeciding(null)}
          onDone={(message) => {
            setDeciding(null);
            setNotice(message);
            refresh();
          }}
          onStale={(message) => {
            setDeciding(null);
            setNotice(message);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function DecisionDialog({
  decision,
  onClose,
  onDone,
  onStale,
}: {
  decision: Decision;
  onClose: () => void;
  onDone: (message: string) => void;
  onStale: (message: string) => void;
}) {
  const { row, mode } = decision;
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: () =>
      mode === 'verify' ? verifyDay(row.id) : rejectDay(row.id, { reason: reason.trim() }),
    onSuccess: () =>
      onDone(
        `${row.employeeName}'s attendance was ${mode === 'verify' ? 'verified' : 'rejected'}.`,
      ),
    onError: (err: Error) => {
      // Somebody else decided it, or it is gone: re-read instead of retrying.
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        onStale(`${err.message}. The list has been refreshed.`);
        return;
      }
      setProblem(err.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (mode === 'reject' && reason.trim().length < 5) {
      setProblem('Give a reason of at least five characters so they know what to do next.');
      return;
    }
    decide.mutate();
  };

  const date = longDate(`${row.businessDate}T00:00:00.000Z`);

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        mode === 'verify'
          ? `Verify ${row.employeeName}'s attendance?`
          : `Reject ${row.employeeName}'s attendance?`
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm">
          {mode === 'verify'
            ? `This counts ${date} as a present day.`
            : `${date} will not count as a present day, and ${row.employeeName} will not be able to punch again on it.`}
        </p>
        {mode === 'reject' ? (
          <div className="space-y-1">
            <Label htmlFor="reason">Why, required</Label>
            <Textarea
              id="reason"
              rows={3}
              maxLength={280}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-sm text-text-muted">They see this on their attendance screen.</p>
          </div>
        ) : null}
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
            variant={mode === 'reject' ? 'danger' : 'primary'}
            className="min-h-[44px] flex-1"
            disabled={decide.isPending}
          >
            {decide.isPending ? 'Sending...' : mode === 'verify' ? 'Verify' : 'Reject'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
