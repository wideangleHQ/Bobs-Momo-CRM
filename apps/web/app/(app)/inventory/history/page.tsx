'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { longDate, qty as fmtQty, time } from '@/lib/format';
import {
  errorMessage,
  listTransactions,
  type AnyTxnType,
} from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { useItemMaster } from '@/features/inventory/item-picker';
import { useOutlets } from '@/features/inventory/outlets';
import { DateInput, Field, SelectInput } from '@/features/inventory/fields';

const TYPES: AnyTxnType[] = [
  'OPENING',
  'RECEIVED',
  'ISSUED',
  'WASTAGE',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CLOSING',
];

const label = (t: string) => t.replace('_', ' ').toLowerCase();

export default function StockLedgerPage() {
  const master = useItemMaster();
  const { options: outletOptions } = useOutlets();

  const [from, setFrom] = useState(() => businessDateOffset(-13).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => toBusinessDate());
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState('');
  const [outletId, setOutletId] = useState('');
  const [page, setPage] = useState(1);

  const params = {
    page,
    pageSize: 25,
    from,
    to,
    itemId: itemId || undefined,
    type: (type || undefined) as AnyTxnType | undefined,
    outletId: outletId || undefined,
  };
  const ledger = useQuery({
    queryKey: inventoryKeys.transactions(params),
    queryFn: () => listTransactions(params),
    placeholderData: (prev) => prev,
  });

  const itemOptions = (master.data ?? [])
    .map((i) => ({ value: i.id, label: i.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <PageHeader
        title="Stock ledger"
        description="Every movement, with the balance it left behind."
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="From" htmlFor="from">
          <DateInput
            id="from"
            value={from}
            onChange={(v) => {
              setFrom(v);
              setPage(1);
            }}
            max={to}
          />
        </Field>
        <Field label="To" htmlFor="to">
          <DateInput
            id="to"
            value={to}
            onChange={(v) => {
              setTo(v);
              setPage(1);
            }}
            min={from}
            max={toBusinessDate()}
          />
        </Field>
      </div>

      <Field label="Item" htmlFor="item">
        <SelectInput
          id="item"
          value={itemId}
          onChange={(v) => {
            setItemId(v);
            setPage(1);
          }}
          placeholder="All items"
          options={itemOptions}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="type">
          <SelectInput
            id="type"
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            placeholder="All types"
            options={TYPES.map((t) => ({ value: t, label: label(t) }))}
          />
        </Field>
        {outletOptions.length > 1 ? (
          <Field label="Outlet" htmlFor="outlet">
            <SelectInput
              id="outlet"
              value={outletId}
              onChange={(v) => {
                setOutletId(v);
                setPage(1);
              }}
              placeholder="All outlets"
              options={outletOptions}
            />
          </Field>
        ) : null}
      </div>

      {ledger.isPending ? (
        <div className="flex flex-col gap-px">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : ledger.isError ? (
        <ErrorState message={errorMessage(ledger.error)} onRetry={() => void ledger.refetch()} />
      ) : ledger.data.data.length === 0 ? (
        <EmptyState
          title="Nothing in this range"
          description="Widen the dates or clear the item filter to see more movements."
          action={
            <Button
              onClick={() => {
                setItemId('');
                setType('');
                setFrom(businessDateOffset(-13).toISOString().slice(0, 10));
                setTo(toBusinessDate());
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <ul
            className={`flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border ${
              ledger.isFetching ? 'opacity-60' : ''
            }`}
          >
            {ledger.data.data.map((txn) => (
              <li key={txn.id} className="flex items-center justify-between gap-3 bg-surface px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <Link
                    href={`/inventory/items/${txn.item.id}`}
                    className="truncate text-base font-medium text-text underline"
                  >
                    {txn.item.name}
                  </Link>
                  <span className="truncate text-xs text-text-muted">
                    {label(txn.type)} · {longDate(txn.businessDate)} · {time(txn.createdAt)}
                    · {txn.outletCode}
                  </span>
                  {txn.reason ? (
                    <span className="truncate text-xs text-text-muted">{txn.reason}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      txn.signedQty.startsWith('-') ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {txn.signedQty.startsWith('-') ? '' : '+'}
                    {fmtQty(txn.signedQty, txn.item.unitCode)}
                  </span>
                  <span className="text-xs tabular-nums text-text-muted">
                    balance {fmtQty(txn.balanceAfter, txn.item.unitCode)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Pagination
            page={ledger.data.meta.page}
            pageSize={ledger.data.meta.pageSize}
            total={ledger.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
