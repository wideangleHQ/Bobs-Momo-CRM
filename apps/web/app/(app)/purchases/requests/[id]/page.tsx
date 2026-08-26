'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useCan, useSession } from '@/lib/auth';
import { longDate, qty as fmtQty, relative } from '@/lib/format';
import { errorMessage } from '@/features/inventory/api';
import { Field, FormError, TextArea } from '@/features/inventory/fields';
import { decideRequest, getRequest } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import { StatusPill } from '@/features/purchase/status';

export default function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [decisionNote, setDecisionNote] = useState('');
  const [confirming, setConfirming] = useState<'reject' | 'cancel' | null>(null);

  const request = useQuery({
    queryKey: purchaseKeys.request(id),
    queryFn: () => getRequest(id),
    enabled: Boolean(id),
  });

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject' | 'cancel') =>
      decideRequest(id, decision, decisionNote.trim() || undefined),
    onSuccess: () => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
    },
  });

  if (request.isPending) return <Skeleton className="m-4 h-96 rounded-lg" />;
  if (request.isError) {
    return (
      <div className="p-4">
        <ErrorState message={errorMessage(request.error)} onRetry={() => void request.refetch()} />
      </div>
    );
  }

  const r = request.data;
  const pending = r.status === 'PENDING';
  const canDecide = pending && can('purchase.request.approve');
  const canCancel = pending && can('purchase.request.cancel') && r.requestedById === user?.id;
  const rejectReady = decisionNote.trim().length >= 3;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
      <Link href="/purchases/requests" className="text-sm underline">
        Back to requests
      </Link>
      <PageHeader
        title={r.requestNo}
        description={`${r.outletCode} · raised ${relative(r.createdAt)}`}
        action={<StatusPill status={r.status} />}
      />

      {r.neededBy ? (
        <p className="text-sm text-text-muted">Needed by {longDate(r.neededBy)}</p>
      ) : null}
      {r.note ? (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm text-text">
          {r.note}
        </p>
      ) : null}

      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
        {r.lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-3 bg-surface px-3 py-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-base font-medium text-text">{line.name}</span>
              {line.note ? <span className="text-sm text-text-muted">{line.note}</span> : null}
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums text-text">
              {fmtQty(line.quantity, line.unitCode)}
            </span>
          </li>
        ))}
      </ul>

      {r.decidedAt ? (
        <div className="rounded-lg border border-border bg-surface p-3 text-sm">
          <p className="font-medium text-text">
            {r.status.toLowerCase()} {relative(r.decidedAt)}
          </p>
          {r.decisionNote ? <p className="text-text-muted">{r.decisionNote}</p> : null}
        </div>
      ) : null}

      {canDecide || canCancel ? (
        <div className="flex flex-col gap-3">
          <Field
            label="Decision note"
            htmlFor="decisionNote"
            hint="Required when rejecting. A rejection with no reason turns into a phone call."
          >
            <TextArea
              id="decisionNote"
              value={decisionNote}
              onChange={setDecisionNote}
              maxLength={500}
            />
          </Field>

          <FormError message={decide.isError ? errorMessage(decide.error) : null} />

          {canDecide ? (
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => decide.mutate('approve')}
                disabled={decide.isPending}
                size="lg" fullWidth
              >
                {decide.isPending ? 'Working' : 'Approve'}
              </Button>
              {confirming === 'reject' ? (
                <div className="flex gap-2">
                  <Button
                    onClick={() => decide.mutate('reject')}
                    disabled={decide.isPending || !rejectReady}
                    variant="danger" size="lg" className="flex-1"
                  >
                    Confirm reject
                  </Button>
                  <Button
                    onClick={() => setConfirming(null)}
                    variant="secondary" size="lg" className="flex-1"
                  >
                    Keep pending
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => setConfirming('reject')}
                  disabled={decide.isPending}
                  variant="danger" size="lg" fullWidth
                >
                  Reject
                </Button>
              )}
              {confirming === 'reject' && !rejectReady ? (
                <p className="text-sm text-danger">Write at least a few words first.</p>
              ) : null}
            </div>
          ) : null}

          {canCancel ? (
            confirming === 'cancel' ? (
              <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-3">
                <p className="text-sm text-text">
                  Cancel this request? It cannot be reopened, and a new one has to be raised.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => decide.mutate('cancel')}
                    disabled={decide.isPending}
                    variant="danger" size="lg" fullWidth
                  >
                    Yes, cancel it
                  </Button>
                  <Button
                    onClick={() => setConfirming(null)}
                    disabled={decide.isPending}
                    variant="secondary" size="lg" fullWidth
                  >
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              // Two steps, like reject directly above. This sits under the
              // reject button on a 360px screen and one fat-thumb tap used to
              // destroy a request the manager was waiting on.
              <Button
                onClick={() => setConfirming('cancel')}
                disabled={decide.isPending}
                variant="secondary" size="lg" fullWidth
              >
                Cancel this request
              </Button>
            )
          ) : null}
        </div>
      ) : null}

      {r.status === 'APPROVED' && can('purchase.record.create') ? (
        <Link href={`/purchases/records/new?requestId=${r.id}&outletId=${r.outletId}`}>
          <Button size="lg" fullWidth>Record the purchase</Button>
        </Link>
      ) : null}
    </div>
  );
}
