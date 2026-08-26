'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toBusinessDate } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan, useSession } from '@/lib/auth';
import { longDate, money, time } from '@/lib/format';
import { useOutletOptions, errorMessage, hasCode } from '@/features/analytics/report-frame';
import {
  createSalesEntry,
  fetchSalesEntry,
  salesKeys,
  unlockSalesEntry,
  updateSalesEntry,
  type SalesEntry,
} from '../api';
import { absPaise, fromPaise, SPLIT_TOLERANCE_PAISE, sumPaise, toPaise } from '../money';

const PAYMENT_ROWS = [
  { field: 'cashAmount', label: 'Cash' },
  { field: 'upiAmount', label: 'UPI' },
  { field: 'cardAmount', label: 'Card' },
  { field: 'otherAmount', label: 'Other' },
] as const;

type PaymentField = (typeof PAYMENT_ROWS)[number]['field'];

interface FormState {
  grossSales: string;
  discounts: string;
  orderCount: string;
  cashAmount: string;
  upiAmount: string;
  cardAmount: string;
  otherAmount: string;
  note: string;
}

function initialForm(entry: SalesEntry | null): FormState {
  return {
    grossSales: entry?.grossSales ?? '',
    discounts: entry?.discounts ?? '0.00',
    orderCount: entry?.orderCount === null || entry?.orderCount === undefined ? '' : String(entry.orderCount),
    cashAmount: entry?.cashAmount ?? '0.00',
    upiAmount: entry?.upiAmount ?? '0.00',
    cardAmount: entry?.cardAmount ?? '0.00',
    otherAmount: entry?.otherAmount ?? '0.00',
    note: entry?.note ?? '',
  };
}

/** The drift the server computed, so the form repeats its arithmetic, not ours. */
function serverDrift(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('details' in error)) return null;
  const details = (error as { details?: unknown }).details;
  if (details && typeof details === 'object' && 'drift' in details) {
    const drift = (details as { drift?: unknown }).drift;
    if (typeof drift === 'string' || typeof drift === 'number') return String(drift);
  }
  if (Array.isArray(details)) {
    for (const item of details) {
      if (item && typeof item === 'object' && 'issue' in item) {
        const issue = (item as { issue?: unknown }).issue;
        if (typeof issue === 'string') return issue;
      }
    }
  }
  return null;
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  disabled,
  inline,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  inline?: boolean;
}) {
  return (
    <div className={inline ? 'flex items-center gap-3' : ''}>
      <Label htmlFor={id} className={inline ? 'w-16 shrink-0' : undefined}>
        {label}
      </Label>
      <NumberInput
        id={id}
        unit="Rs"
        mode="decimal"
        placeholder="0.00"
        className="w-full"
        value={value}
        disabled={disabled}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function SalesEntryPage() {
  const { user } = useSession();
  const can = useCan();
  const outlets = useOutletOptions();
  const outletOptions = outlets.data?.data ?? [];
  const scopeOutlets = user?.outletIds ?? [];

  const [outletId, setOutletId] = useState(() => scopeOutlets[0] ?? '');
  const [businessDate, setBusinessDate] = useState(() => toBusinessDate());

  const effectiveOutletId = outletId || scopeOutlets[0] || outletOptions[0]?.id || '';

  const entryQuery = useQuery({
    queryKey: salesKeys.entry(effectiveOutletId, businessDate),
    queryFn: () => fetchSalesEntry(effectiveOutletId, businessDate),
    enabled: effectiveOutletId !== '' && businessDate !== '',
    // A refetch while a cashier is typing would wipe uncommitted input.
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const today = toBusinessDate();
  const isFuture = businessDate > today;
  const daysBack = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${businessDate}T00:00:00Z`)) / 86_400_000,
  );
  const outsideWindow =
    !isFuture && daysBack > 2 && !entryQuery.data && !can('sales.entry.unlock');

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Daily sales"
        description={`Business day ${longDate(`${businessDate}T00:00:00.000Z`)}`}
      />

      <Card className="p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {outletOptions.length > 1 || scopeOutlets.length > 1 ? (
            <div>
              <Label htmlFor="sales-outlet">Outlet</Label>
              <Select
                id="sales-outlet"
                value={effectiveOutletId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setOutletId(e.target.value)}
              >
                {(outletOptions.length > 0
                  ? outletOptions
                  : scopeOutlets.map((id) => ({ id, code: id.slice(0, 8) }))
                ).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div>
            <Label htmlFor="sales-date">Business date</Label>
            <DatePicker
              id="sales-date"
                            className="min-h-[44px]"
              max={today}
              value={businessDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setBusinessDate(e.target.value)
              }
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          The trading day runs to 04:00, so a close typed after midnight still belongs to the
          previous date.
        </p>
      </Card>

      {isFuture ? (
        <Card className="border-warning/40 bg-warning-bg p-4">
          <h2 className="text-base font-semibold text-warning">That day has not traded yet</h2>
          <p className="mt-1 text-sm text-warning">
            Sales can only be entered for today or an earlier business date. Pick {today} or
            before.
          </p>
        </Card>
      ) : outsideWindow ? (
        <Card className="border-border-strong bg-surface-muted p-4">
          <h2 className="text-base font-semibold text-text">
            This day is outside the 48 hour window
          </h2>
          <p className="mt-1 text-sm text-text">
            {longDate(`${businessDate}T00:00:00.000Z`)} closed more than two business days ago and
            has no entry. Only the owner can add sales this far back. Ask the owner to enter it,
            or pick a more recent date.
          </p>
        </Card>
      ) : entryQuery.isPending && effectiveOutletId !== '' ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : entryQuery.isError ? (
        <ErrorState
          message={errorMessage(entryQuery.error)}
          onRetry={() => void entryQuery.refetch()}
        />
      ) : effectiveOutletId === '' ? (
        <Card className="p-4">
          <p className="text-sm text-text">
            Your account is not attached to an outlet, so there is no day to close. Ask an
            administrator to assign you one.
          </p>
        </Card>
      ) : (
        <SalesEntryForm
          key={`${effectiveOutletId}:${businessDate}`}
          outletId={effectiveOutletId}
          businessDate={businessDate}
          entry={entryQuery.data ?? null}
          canUnlock={can('sales.entry.unlock')}
          canWrite={can('sales.entry.create') || can('sales.entry.amend')}
        />
      )}

      <p className="text-sm">
        <Link href="/sales" className="font-medium text-primary underline-offset-2 hover:underline">
          See recent days
        </Link>
      </p>
    </div>
  );
}

function SalesEntryForm({
  outletId,
  businessDate,
  entry,
  canUnlock,
  canWrite,
}: {
  outletId: string;
  businessDate: string;
  entry: SalesEntry | null;
  canUnlock: boolean;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialForm(entry));
  const [clientError, setClientError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<FormState | null>(null);
  const [saved, setSaved] = useState(false);

  const locked = entry?.lockedAt != null;
  const readOnly = locked || !canWrite;

  const set = (field: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setClientError(null);
    setSaved(false);
  };

  const grossPaise = toPaise(form.grossSales === '' ? '0' : form.grossSales);
  const discountPaise = toPaise(form.discounts === '' ? '0' : form.discounts);
  const netPaise =
    grossPaise !== null && discountPaise !== null ? grossPaise - discountPaise : null;
  const splitPaise = sumPaise(PAYMENT_ROWS.map((row) => form[row.field]));
  const driftPaise = netPaise !== null && splitPaise !== null ? splitPaise - netPaise : null;

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        grossSales: Number(form.grossSales),
        discounts: Number(form.discounts === '' ? '0' : form.discounts),
        orderCount: form.orderCount === '' ? null : Number(form.orderCount),
        cashAmount: Number(form.cashAmount === '' ? '0' : form.cashAmount),
        upiAmount: Number(form.upiAmount === '' ? '0' : form.upiAmount),
        cardAmount: Number(form.cardAmount === '' ? '0' : form.cardAmount),
        otherAmount: Number(form.otherAmount === '' ? '0' : form.otherAmount),
        ...(form.note.trim() === '' ? {} : { note: form.note.trim() }),
      };
      return entry
        ? updateSalesEntry(entry.id, body)
        : createSalesEntry({ ...body, outletId, businessDate });
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: salesKeys.all() });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (error) => {
      if (hasCode(error, 'SALES_ENTRY_EXISTS')) {
        setConflict(form);
        void queryClient.invalidateQueries({ queryKey: salesKeys.all() });
      }
    },
  });

  const unlock = useMutation({
    mutationFn: () => unlockSalesEntry(entry?.id ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesKeys.all() });
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);

    if (grossPaise === null) {
      setClientError('Gross sales must be a number with at most two decimal places.');
      return;
    }
    if (grossPaise <= 0n) {
      setClientError('Gross sales must be more than zero.');
      return;
    }
    if (discountPaise === null || discountPaise < 0n) {
      setClientError('Discounts must be zero or more.');
      return;
    }
    if (discountPaise > grossPaise) {
      setClientError('Discounts cannot be larger than gross sales.');
      return;
    }
    if (splitPaise === null) {
      setClientError('Every payment line must be a number with at most two decimal places.');
      return;
    }
    if (form.orderCount !== '' && !/^\d+$/.test(form.orderCount.trim())) {
      setClientError('Order count must be a whole number, or left blank.');
      return;
    }
    if (driftPaise !== null && absPaise(driftPaise) > SPLIT_TOLERANCE_PAISE) {
      const shortOrOver = driftPaise < 0n ? 'short of' : 'over';
      setClientError(
        `Split is ${money(fromPaise(absPaise(driftPaise)))} ${shortOrOver} net sales. Put a genuine residual in Other and say why in the note.`,
      );
      return;
    }
    mutation.mutate();
  }

  const drift = serverDrift(mutation.error);

  if (locked) {
    return (
      <Card className="p-4">
        <h2 className="text-base font-semibold text-text">
          Locked on {longDate(entry?.lockedAt ?? '')}
        </h2>
        <p className="mt-1 text-sm text-text">
          An entry becomes final 48 hours after its business day ends, so this day can no longer be
          edited. Ask the owner to reopen it.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Figure label="Gross sales" value={money(entry?.grossSales ?? '0.00')} />
          <Figure label="Discounts" value={money(entry?.discounts ?? '0.00')} />
          <Figure label="Net sales" value={money(entry?.netSales ?? '0.00')} />
          <Figure
            label="Order count"
            value={entry?.orderCount === null || entry?.orderCount === undefined ? 'not recorded' : String(entry.orderCount)}
          />
          {PAYMENT_ROWS.map((row) => (
            <Figure key={row.field} label={row.label} value={money(entry?.[row.field] ?? '0.00')} />
          ))}
        </dl>
        {entry?.note ? <p className="mt-3 text-sm text-text">Note: {entry.note}</p> : null}
        {entry?.enteredBy ? (
          <p className="mt-3 text-xs text-text-muted">
            Entered by {entry.enteredBy.fullName} at {time(entry.updatedAt)}
          </p>
        ) : null}
        {canUnlock ? (
          <div className="mt-4">
            <Button type="button" onClick={() => unlock.mutate()} disabled={unlock.isPending}>
              {unlock.isPending ? 'Reopening' : 'Reopen this entry'}
            </Button>
            <p className="mt-1 text-xs text-text-muted">
              Reopening is written to the audit log and the entry re-locks at the next 04:15 sweep.
            </p>
            {unlock.isError ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {errorMessage(unlock.error)}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {entry ? (
        <p className="text-sm text-text-muted">
          Last saved {time(entry.updatedAt)}
          {entry.enteredBy ? ` by ${entry.enteredBy.fullName}` : ''}. Saving again updates this
          day.
        </p>
      ) : null}

      <Card className="space-y-3 p-3">
        <h2 className="text-sm font-semibold text-text">Totals</h2>
        <MoneyField
          id="gross"
          label="Gross sales"
          value={form.grossSales}
          onChange={set('grossSales')}
          disabled={readOnly}
        />
        <MoneyField
          id="discounts"
          label="Discounts"
          value={form.discounts}
          onChange={set('discounts')}
          disabled={readOnly}
        />
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-medium text-text">Net sales</span>
          <span className="text-lg font-semibold tabular-nums text-text">
            {netPaise === null ? 'Check the numbers above' : money(fromPaise(netPaise))}
          </span>
        </div>
        <p className="text-xs text-text-muted">
          Net sales is gross less discounts. The server recalculates it, so it is not typed.
        </p>
        <div>
          <Label htmlFor="order-count">Order count</Label>
          <NumberInput
            id="order-count"
            mode="numeric"
            placeholder="Leave blank if the printout does not show it"
            value={form.orderCount}
            disabled={readOnly}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('orderCount')(e.target.value)}
          />
        </div>
      </Card>

      <Card className="space-y-3 p-3">
        <h2 className="text-sm font-semibold text-text">Payment split</h2>
        {PAYMENT_ROWS.map((row) => (
          <MoneyField
            key={row.field}
            inline
            id={row.field}
            label={row.label}
            value={form[row.field as PaymentField]}
            onChange={set(row.field)}
            disabled={readOnly}
          />
        ))}
        <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
          <span className="font-medium text-text">Split total</span>
          <span className="tabular-nums text-text">
            {splitPaise === null ? 'Check the lines above' : money(fromPaise(splitPaise))}
          </span>
        </div>
        {driftPaise !== null ? (
          absPaise(driftPaise) <= SPLIT_TOLERANCE_PAISE ? (
            <p className="text-sm text-success">
              Matches net sales{driftPaise === 0n ? '' : ' within one rupee of rounding'}.
            </p>
          ) : (
            <p className="text-sm text-warning">
              Split is {money(fromPaise(absPaise(driftPaise)))}{' '}
              {driftPaise < 0n ? 'short of' : 'over'} net sales.
            </p>
          )
        ) : null}
        <div>
          <Label htmlFor="note">Note</Label>
          <Textarea
            id="note"
            rows={2}
            maxLength={500}
            placeholder="Explain a strange day, for example an aggregator settlement in Other"
            value={form.note}
            disabled={readOnly}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('note')(e.target.value)}
          />
        </div>
      </Card>

      {clientError ? (
        <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">
          {clientError}
        </p>
      ) : null}

      {mutation.isError && !hasCode(mutation.error, 'SALES_ENTRY_EXISTS') ? (
        <div role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">
          <p>{errorMessage(mutation.error)}</p>
          {drift ? <p className="mt-1">The server measured the difference as {money(drift)}.</p> : null}
          {hasCode(mutation.error, 'SALES_ENTRY_LOCKED') ? (
            <p className="mt-1">
              This day locked while the form was open. Reload to see the final figures.
            </p>
          ) : null}
        </div>
      ) : null}

      {conflict ? (
        <Card className="border-warning/40 bg-warning-bg p-3">
          <h2 className="text-sm font-semibold text-warning">
            Someone saved this day while you were typing
          </h2>
          <p className="mt-1 text-sm text-warning">
            The figures you typed are kept below so you can compare them against the saved entry.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Figure label="Your gross" value={money(conflict.grossSales || '0.00')} />
            <Figure label="Your discounts" value={money(conflict.discounts || '0.00')} />
            {PAYMENT_ROWS.map((row) => (
              <Figure
                key={row.field}
                label={`Your ${row.label.toLowerCase()}`}
                value={money(conflict[row.field] || '0.00')}
              />
            ))}
          </dl>
          <div className="mt-3">
            <Button
              type="button"
              onClick={() => {
                setConflict(null);
                void queryClient.invalidateQueries({ queryKey: salesKeys.all() });
              }}
            >
              Reload the saved entry
            </Button>
          </div>
        </Card>
      ) : null}

      {saved ? (
        <p role="status" className="rounded-md bg-success-bg p-3 text-sm text-success">
          Saved. This day is editable for 48 hours after it ends.
        </p>
      ) : null}

      {!canWrite ? (
        <p className="text-sm text-text-muted">
          You can read this day but not change it. Ask the store manager or the cashier on shift.
        </p>
      ) : (
        <Button type="submit" className="min-h-[44px] w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving' : entry ? 'Save changes' : 'Save'}
        </Button>
      )}
    </form>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tabular-nums text-text">{value}</dd>
    </div>
  );
}
