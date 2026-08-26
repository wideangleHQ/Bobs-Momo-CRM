'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan, useSession } from '@/lib/auth';
import { longDate } from '@/lib/format';
import { cancelLeave, listLeave, type LeaveStatus } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';

const TABS: { key: LeaveStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

const BADGE: Record<LeaveStatus, string> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

export default function MyLeavePage() {
  const { user } = useSession();
  const can = useCan();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LeaveStatus | ''>('');
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // A manager reading this screen wants their own leave, not the queue. The
  // queue is /leave/approvals.
  const employeeId = user?.employeeId ?? undefined;
  const query = { status: status === '' ? undefined : status, employeeId, pageSize: 50 };

  const leave = useQuery({
    queryKey: workforceKeys.leave(query),
    queryFn: () => listLeave(query),
    enabled: Boolean(employeeId),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => cancelLeave(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['leave'] }),
    onError: (err: Error) => setProblem(err.message),
  });

  const rows = leave.data?.data ?? [];

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
      <PageHeader
        title="My leave"
        action={
          can('workforce.leave.request') ? (
            <Link href="/leave/new">
              <Button type="button" className="min-h-[44px]">
                Request leave
              </Button>
            </Link>
          ) : null
        }
      />

      {can('workforce.leave.decide') ? (
        <Link className="text-sm underline" href="/leave/approvals">
          Go to the approval queue
        </Link>
      ) : null}

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

      {!employeeId ? (
        <EmptyState
          title="This login is not linked to an employee record"
          description="Leave is filed against an employee, so ask an administrator to link your account first."
        />
      ) : leave.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : leave.isError ? (
        <ErrorState
          title="Could not load your leave"
          message={(leave.error as Error).message}
          onRetry={() => void leave.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No leave on file"
          description="Nothing here yet. Use Request leave to ask for days off."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((l) => (
            <li key={l.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {l.type} · {l.dayCount} day{l.dayCount === '1.0' ? '' : 's'}
                    </p>
                    <p className="text-sm text-text-muted">
                      {longDate(`${l.fromDate}T00:00:00.000Z`)}
                      {l.fromDate === l.toDate
                        ? ''
                        : ` to ${longDate(`${l.toDate}T00:00:00.000Z`)}`}
                    </p>
                  </div>
                  <Badge variant={BADGE[l.status]}>{l.status}</Badge>
                </div>
                <p className="text-sm">{l.reason}</p>
                {l.decisionNote ? (
                  <p className="text-sm text-text-muted">Manager said: {l.decisionNote}</p>
                ) : null}
                {l.status === 'PENDING' ? (
                  confirmingId === l.id ? (
                    <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-3">
                      <p className="text-sm">
                        Withdraw this request? You would have to raise it again.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="danger"
                          className="min-h-[44px] w-full"
                          disabled={withdraw.isPending}
                          onClick={() => withdraw.mutate(l.id)}
                        >
                          Yes, withdraw
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-[44px] w-full"
                          disabled={withdraw.isPending}
                          onClick={() => setConfirmingId(null)}
                        >
                          Keep it
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // Full width, directly under the card body, exactly where a
                    // thumb scrolls. One mis-tap used to destroy a request the
                    // employee had to have a conversation to get.
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-[44px] w-full"
                      disabled={withdraw.isPending}
                      onClick={() => setConfirmingId(l.id)}
                    >
                      Withdraw this request
                    </Button>
                  )
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
    </div>
  );
}
