'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toBusinessDate } from '@bobs-momo/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useCan } from '@/lib/auth';
import { qty as fmtQty } from '@/lib/format';
import {
  errorCode,
  errorMessage,
  recordTransaction,
  type RecordedTxn,
  type TxnType,
} from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { ItemPicker, useItemMaster } from '@/features/inventory/item-picker';
import { useOnHand } from '@/features/inventory/use-on-hand';
import { useDefaultOutletId, useOutlets } from '@/features/inventory/outlets';
import {
  Chip,
  DateInput,
  Field,
  FormError,
  QtyInput,
  SelectInput,
  TextArea,
  TextInput,
} from '@/features/inventory/fields';
// ponytail: the decimal helpers live under features/purchase because that is
// where the money math is. Chapter 29 puts them in lib/decimal eventually.
import { addQty, cmpQty } from '@/features/purchase/decimal';

const TYPES: { value: TxnType; label: string; sign: -1 | 0 | 1; permission?: string }[] = [
  { value: 'RECEIVED', label: 'Received', sign: 1 },
  { value: 'ISSUED', label: 'Issued to kitchen', sign: -1 },
  { value: 'WASTAGE', label: 'Wastage', sign: -1 },
  { value: 'OPENING', label: 'Opening', sign: 1 },
  { value: 'ADJUSTMENT', label: 'Adjustment', sign: 0, permission: 'inventory.adjustment.create' },
];

// Chips keep the wastage report groupable instead of 400 spellings of "spoilt".
const WASTAGE_REASONS = ['Spoiled', 'Dropped', 'Over-prepped', 'Expired', 'Damaged in transit'];

const REASON_TYPES: TxnType[] = ['WASTAGE', 'ADJUSTMENT'];

export default function StockEntryPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const master = useItemMaster();
  const { options: outletOptions } = useOutlets();
  const defaultOutletId = useDefaultOutletId();

  const [outletId, setOutletId] = useState('');
  const [type, setType] = useState<TxnType>('ISSUED');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<'+' | '-'>('-');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [businessDate, setBusinessDate] = useState(() => toBusinessDate());
  const [done, setDone] = useState<RecordedTxn | null>(null);

  useEffect(() => {
    if (!outletId && defaultOutletId) setOutletId(defaultOutletId);
  }, [outletId, defaultOutletId]);

  const items = master.data ?? [];
  const item = items.find((i) => i.id === itemId) ?? null;
  const { row: stock } = useOnHand(itemId, item?.name ?? '', outletId);

  const typeMeta = TYPES.find((t) => t.value === type) ?? TYPES[0]!;
  const needsReason = REASON_TYPES.includes(type);
  const isAdjustment = type === 'ADJUSTMENT';

  const signedQty = useMemo(() => {
    if (quantity === '' || quantity === '.') return null;
    const sign = isAdjustment ? (direction === '-' ? -1 : 1) : typeMeta.sign;
    try {
      return sign < 0 ? addQty('0.000', `-${quantity}`) : addQty('0.000', quantity);
    } catch {
      return null;
    }
  }, [quantity, isAdjustment, direction, typeMeta.sign]);

  const projected =
    stock && signedQty ? (() => {
      try {
        return addQty(stock.qtyOnHand, signedQty);
      } catch {
        return null;
      }
    })() : null;

  // Not blocked, only warned: the ledger is the truth and the server decides.
  const overIssue =
    stock !== null &&
    quantity !== '' &&
    (type === 'ISSUED' || type === 'WASTAGE') &&
    (() => {
      try {
        return cmpQty(quantity, stock.qtyOnHand) > 0;
      } catch {
        return false;
      }
    })();

  const payload = useMemo(() => {
    const base = {
      itemId,
      outletId,
      type,
      businessDate,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    return isAdjustment
      ? { ...base, signedQty: Number(signedQty ?? 0) }
      : { ...base, quantity: Number(quantity || 0) };
  }, [itemId, outletId, type, businessDate, reason, note, isAdjustment, signedQty, quantity]);

  // One idempotency key per submit attempt. A retry of the same attempt reuses
  // it, so a response lost in transit returns the original row instead of
  // issuing the stock twice. Editing any field starts a new attempt.
  const attemptKey = useRef<string | null>(null);
  const payloadFingerprint = JSON.stringify(payload);
  useEffect(() => {
    attemptKey.current = null;
  }, [payloadFingerprint]);

  const record = useMutation({
    mutationFn: () => {
      attemptKey.current ??= crypto.randomUUID();
      return recordTransaction(payload, attemptKey.current);
    },
    onSuccess: (result) => {
      attemptKey.current = null;
      setDone(result);
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });

  const missing =
    !itemId
      ? 'Pick an item'
      : !outletId
        ? 'Pick an outlet'
        : signedQty === null
          ? 'Enter a quantity'
          : needsReason && reason.trim().length < 3
            ? 'A reason is required for this type'
            : null;

  const failureCode = record.isError ? errorCode(record.error) : null;
  // The server names the on-hand quantity in this message, so it belongs on
  // the field the user has to change, not in a banner above the form.
  const quantityError =
    failureCode === 'INVENTORY_NEGATIVE_STOCK_BLOCKED' ? errorMessage(record.error) : null;

  const reset = () => {
    setDone(null);
    setItemId('');
    setQuantity('');
    setReason('');
    setNote('');
    record.reset();
  };

  if (done) {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
        <PageHeader title="Recorded" />
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-text-muted">There are now</p>
          <p className="py-1 text-5xl font-semibold tabular-nums text-text">
            {fmtQty(done.balanceAfter, item?.unitCode)}
          </p>
          <p className="text-sm text-text-muted">
            left of {item?.name ?? 'this item'} after this {done.type.toLowerCase()} entry.
          </p>
          {done.lowStockRaised ? (
            <p className="mt-4 rounded-lg bg-warning-bg p-3 text-sm font-medium text-warning">
              This dropped below the reorder level. The manager has been notified.
            </p>
          ) : null}
        </div>
        <Button onClick={reset} size="lg" fullWidth>
          Record another
        </Button>
        <Link href="/inventory/stock" className="text-center text-sm underline">
          Back to current stock
        </Link>
      </div>
    );
  }

  if (master.isSuccess && items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[560px] p-4">
        <EmptyState
          title="No items yet"
          description="The item master is empty, so there is nothing to record against."
          action={
            can('inventory.item.create') ? (
              <Link href="/inventory/items/new">
                <Button>Add an item</Button>
              </Link>
            ) : null
          }
        />
      </div>
    );
  }

  const busy = record.isPending;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4 pb-40">
      <PageHeader title="Record stock" description="Received, issued, wastage or an adjustment." />

      <fieldset disabled={busy} className="flex flex-col gap-4">
        {outletOptions.length > 1 ? (
          <Field label="Outlet" htmlFor="outlet">
            <SelectInput
              id="outlet"
              value={outletId}
              onChange={setOutletId}
              options={outletOptions}
            />
          </Field>
        ) : null}

        <Field label="Transaction type">
          <div className="grid grid-cols-2 gap-2">
            {TYPES.filter((t) => !t.permission || can(t.permission)).map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={type === t.value}
                onClick={() => setType(t.value)}
                className={`min-h-[56px] rounded-lg border px-3 text-sm font-medium ${
                  type === t.value
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'border-border-strong bg-surface text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Item">
          <ItemPicker
            items={items}
            loading={master.isPending}
            value={itemId}
            onChange={setItemId}
            outletId={outletId}
          />
        </Field>

        {itemId ? (
          <p className="text-sm text-text-muted">
            {stock
              ? `On hand: ${fmtQty(stock.qtyOnHand, stock.unitCode)}`
              : 'On hand: no balance recorded at this outlet yet'}
          </p>
        ) : null}

        {isAdjustment ? (
          <Field label="Direction" hint="An adjustment can add stock back or take it away.">
            <div className="grid grid-cols-2 gap-2">
              {(['+', '-'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => setDirection(d)}
                  className={`min-h-[56px] rounded-lg border text-base font-medium ${
                    direction === d
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border-strong bg-surface text-text'
                  }`}
                >
                  {d === '+' ? 'Add to stock' : 'Take off stock'}
                </button>
              ))}
            </div>
          </Field>
        ) : null}

        <Field
          label="Quantity"
          htmlFor="quantity"
          error={quantityError}
          hint={
            overIssue && stock
              ? `This is more than the ${fmtQty(stock.qtyOnHand, stock.unitCode)} on hand.`
              : undefined
          }
        >
          <QtyInput
            id="quantity"
            value={quantity}
            onChange={setQuantity}
            unit={item?.unitCode ?? ''}
          />
        </Field>

        {needsReason ? (
          <Field label="Reason" htmlFor="reason">
            {type === 'WASTAGE' ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {WASTAGE_REASONS.map((r) => (
                  <Chip key={r} active={reason === r} onClick={() => setReason(r)}>
                    {r}
                  </Chip>
                ))}
              </div>
            ) : null}
            <TextInput
              id="reason"
              value={reason}
              onChange={setReason}
              maxLength={280}
              placeholder="Say what happened"
            />
          </Field>
        ) : null}

        <Field label="Business date" htmlFor="businessDate" hint="Defaults to today.">
          <DateInput
            id="businessDate"
            value={businessDate}
            onChange={setBusinessDate}
            max={toBusinessDate()}
          />
        </Field>

        <Field label="Note (optional)" htmlFor="note">
          <TextArea id="note" value={note} onChange={setNote} maxLength={500} />
        </Field>
      </fieldset>

      {record.isError && !quantityError ? (
        <FormError message={errorMessage(record.error)}>
          <p className="mt-1">
            Tap Record again to retry. The retry reuses the same key, so nothing is recorded twice.
          </p>
        </FormError>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface p-4">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2">
          <p className="text-sm text-text-muted">
            {projected !== null && item
              ? `After this: ${fmtQty(projected, item.unitCode)}`
              : missing ?? 'Ready'}
          </p>
          <Button
            onClick={() => record.mutate()}
            disabled={busy || missing !== null}
            size="lg" fullWidth
          >
            {busy ? 'Recording' : record.isError ? 'Retry' : 'Record'}
          </Button>
        </div>
      </div>
    </div>
  );
}
