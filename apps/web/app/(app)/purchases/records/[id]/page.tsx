'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useCan } from '@/lib/auth';
import { longDate, money as fmtMoney, qty as fmtQty, relative } from '@/lib/format';
import { errorMessage } from '@/features/inventory/api';
import { Field, FormError, TextArea } from '@/features/inventory/fields';
import { getPurchase, voidPurchase } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import { StatusPill } from '@/features/purchase/status';

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const purchase = useQuery({
    queryKey: purchaseKeys.purchase(id),
    queryFn: () => getPurchase(id),
    enabled: Boolean(id),
  });

  const doVoid = useMutation({
    mutationFn: () => voidPurchase(id, reason.trim()),
    onSuccess: () => {
      setVoiding(false);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  if (purchase.isPending) return <Skeleton className="m-4 h-96 rounded-lg" />;
  if (purchase.isError) {
    return (
      <div className="p-4">
        <ErrorState message={errorMessage(purchase.error)} onRetry={() => void purchase.refetch()} />
      </div>
    );
  }

  const p = purchase.data;
  const negativeAfterVoid = p.lines.some((l) => l.balanceAfter?.startsWith('-'));

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
      <Link href="/purchases/records" className="text-sm underline">
        Back to purchases
      </Link>
      <PageHeader
        title={p.vendorName}
        description={`${p.purchaseNo} · ${longDate(p.purchaseDate)} · ${p.outletCode}`}
        action={<StatusPill status={p.status} />}
      />

      {p.invoiceNo ? (
        <p className="text-sm text-text-muted">Invoice {p.invoiceNo}</p>
      ) : null}

      {p.status === 'VOIDED' ? (
        <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          <p className="font-medium">Voided {p.voidedAt ? relative(p.voidedAt) : ''}</p>
          {p.voidReason ? <p>{p.voidReason}</p> : null}
          {negativeAfterVoid ? (
            <p className="mt-2">
              Reversing this drove a balance below zero. Record an adjustment that explains it.
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
        {p.lines.map((line) => (
          <li key={line.id} className="flex flex-col gap-1 bg-surface px-3 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                href={`/inventory/items/${line.itemId}`}
                className="text-base font-medium text-text underline"
              >
                {line.name}
              </Link>
              <span className="shrink-0 text-base font-semibold tabular-nums text-text">
                {fmtMoney(line.lineTotal)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-sm text-text-muted">
              <span className="tabular-nums">
                {fmtQty(line.quantity, line.unitCode)} at {fmtMoney(line.unitPrice)}
              </span>
              {line.balanceAfter ? (
                <span
                  className={`tabular-nums ${
                    line.balanceAfter.startsWith('-') ? 'text-danger' : ''
                  }`}
                >
                  balance {fmtQty(line.balanceAfter, line.unitCode)}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="flex justify-between text-sm text-text-muted">
          <span>Subtotal</span>
          <span className="tabular-nums">{fmtMoney(p.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-text-muted">
          <span>Tax</span>
          <span className="tabular-nums">{fmtMoney(p.taxAmount)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-base font-medium text-text">Total</span>
          <span className="text-2xl font-semibold tabular-nums text-text">
            {fmtMoney(p.totalAmount)}
          </span>
        </div>
      </div>

      {p.requestId ? (
        <Link href={`/purchases/requests/${p.requestId}`} className="text-sm underline">
          Raised from a purchase request
        </Link>
      ) : null}

      {can('purchase.record.void') && p.status !== 'VOIDED' ? (
        voiding ? (
          <div className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-surface p-3">
            <Field
              label="Why is this being voided?"
              htmlFor="reason"
              hint="At least five characters. This reverses every stock line."
            >
              <TextArea id="reason" value={reason} onChange={setReason} maxLength={280} />
            </Field>
            <FormError message={doVoid.isError ? errorMessage(doVoid.error) : null} />
            <div className="flex gap-2">
              <Button
                onClick={() => doVoid.mutate()}
                disabled={doVoid.isPending || reason.trim().length < 5}
                variant="danger" size="lg" className="flex-1"
              >
                {doVoid.isPending ? 'Voiding' : 'Confirm void'}
              </Button>
              <Button
                onClick={() => setVoiding(false)}
                disabled={doVoid.isPending}
                variant="secondary" size="lg" className="flex-1"
              >
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => setVoiding(true)}
            variant="danger" size="lg" fullWidth
          >
            Void this purchase
          </Button>
        )
      ) : null}
    </div>
  );
}
