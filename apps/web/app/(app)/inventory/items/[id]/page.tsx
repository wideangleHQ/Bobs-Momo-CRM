'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { useCan } from '@/lib/auth';
import { longDate, qty as fmtQty } from '@/lib/format';
import {
  deactivateItem,
  errorMessage,
  getItem,
  listStock,
  listTransactions,
  setReorderLevel,
  updateItem,
  type Item,
} from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { useItemMaster } from '@/features/inventory/item-picker';
import { useOutlets } from '@/features/inventory/outlets';
import {
  Field,
  FormError,
  QtyInput,
  SelectInput,
  TextInput,
} from '@/features/inventory/fields';

function EditPanel({ item }: { item: Item }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const master = useItemMaster();
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.categoryId);
  const [isPerishable, setIsPerishable] = useState(item.isPerishable);

  const categories = [
    ...new Map((master.data ?? []).map((i) => [i.categoryId, i.categoryName])).entries(),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all });

  const save = useMutation({
    mutationFn: () => updateItem(item.id, { name: name.trim(), categoryId, isPerishable }),
    onSuccess: () => void invalidate(),
  });
  const retire = useMutation({
    mutationFn: () => deactivateItem(item.id),
    onSuccess: () => void invalidate(),
  });

  const editable = can('inventory.item.update');
  const dirty =
    name.trim() !== item.name ||
    categoryId !== item.categoryId ||
    isPerishable !== item.isPerishable;

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!editable || save.isPending} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="name">
          <TextInput id="name" value={name} onChange={setName} maxLength={120} />
        </Field>
        <Field label="Category" htmlFor="category">
          <SelectInput
            id="category"
            value={categoryId}
            onChange={setCategoryId}
            options={categories}
          />
        </Field>
        <Field label="SKU" htmlFor="sku" hint="The SKU is fixed once an item exists.">
          <TextInput id="sku" value={item.sku} onChange={() => undefined} disabled />
        </Field>
        <Field label="Unit" htmlFor="unit" hint="The unit is fixed once the ledger has rows.">
          <TextInput id="unit" value={item.unitCode} onChange={() => undefined} disabled />
        </Field>
        <Checkbox
          id="isPerishable"
          label="Perishable"
          checked={isPerishable}
          onChange={(e) => setIsPerishable(e.target.checked)}
        />
      </fieldset>

      <FormError message={save.isError ? errorMessage(save.error) : null} />
      {editable ? (
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          size="lg" fullWidth
        >
          {save.isPending ? 'Saving' : 'Save changes'}
        </Button>
      ) : null}

      {can('inventory.item.deactivate') && item.isActive ? (
        <>
          <FormError message={retire.isError ? errorMessage(retire.error) : null} />
          <Button
            onClick={() => retire.mutate()}
            disabled={retire.isPending}
            variant="danger" size="lg" fullWidth
          >
            {retire.isPending ? 'Retiring' : 'Retire this item'}
          </Button>
          <p className="text-xs text-text-muted">
            Retiring keeps every past transaction and stops the item appearing in pickers.
          </p>
        </>
      ) : null}
    </div>
  );
}

function ReorderPanel({ item }: { item: Item }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const { options } = useOutlets();
  const params = { search: item.name, pageSize: 100 };
  const stock = useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => listStock(params),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (input: { outletId: string; reorderLevel: number | null }) =>
      setReorderLevel(item.id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  });

  if (stock.isPending) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (stock.isError) {
    return <ErrorState message={errorMessage(stock.error)} onRetry={() => void stock.refetch()} />;
  }

  const rows = options.map((o) => ({
    outletId: o.value,
    label: o.label,
    row: stock.data.data.find((r) => r.itemId === item.id && r.outletId === o.value) ?? null,
  }));

  return (
    <div className="flex flex-col gap-4">
      {rows.map(({ outletId, label, row }) => {
        const current = row?.reorderLevel ?? '';
        const value = draft[outletId] ?? current;
        return (
          <div key={outletId} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-sm font-medium text-text">{label}</p>
            <p
              className={`py-1 text-2xl font-semibold tabular-nums ${
                row?.isNegative ? 'text-danger' : 'text-text'
              }`}
            >
              {row ? fmtQty(row.qtyOnHand, item.unitCode) : 'No balance yet'}
            </p>
            <Field
              label="Reorder level"
              hint="Leave empty to turn the low stock alert off for this outlet."
            >
              <QtyInput value={value} onChange={(v) => setDraft({ ...draft, [outletId]: v })} unit={item.unitCode} />
            </Field>
            {can('inventory.reorder_level.update') ? (
              <Button
                onClick={() =>
                  save.mutate({
                    outletId,
                    reorderLevel: value.trim() === '' ? null : Number(value),
                  })
                }
                disabled={save.isPending || value === current}
                size="lg" fullWidth className="mt-2"
              >
                {save.isPending ? 'Saving' : 'Save reorder level'}
              </Button>
            ) : null}
          </div>
        );
      })}
      <FormError message={save.isError ? errorMessage(save.error) : null} />
      <p className="text-xs text-text-muted">
        Changing the level does not fire an alert on its own. The next stock movement evaluates it.
      </p>
    </div>
  );
}

function HistoryPanel({ item }: { item: Item }) {
  const [page, setPage] = useState(1);
  const { options } = useOutlets();
  const [outletId, setOutletId] = useState('');
  const params = { itemId: item.id, outletId: outletId || undefined, page, pageSize: 25 };
  const history = useQuery({
    queryKey: inventoryKeys.transactions(params),
    queryFn: () => listTransactions(params),
    placeholderData: (prev) => prev,
  });

  if (history.isPending) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (history.isError) {
    return (
      <ErrorState message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
    );
  }
  if (history.data.data.length === 0) {
    return (
      <EmptyState
        title="Nothing recorded yet"
        description="Once someone records a receipt or an issue for this item, every movement shows up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {options.length > 1 ? (
        <SelectInput
          value={outletId}
          onChange={(v) => {
            setOutletId(v);
            setPage(1);
          }}
          placeholder="All outlets"
          options={options}
        />
      ) : null}
      <p className="text-sm text-text-muted">
        Newest first. The balance column is the running balance after that row.
      </p>
      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
        {history.data.data.map((txn) => (
          <li key={txn.id} className="flex items-center justify-between gap-3 bg-surface px-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-text">
                {txn.type.replace('_', ' ').toLowerCase()}
              </span>
              <span className="truncate text-xs text-text-muted">
                {longDate(txn.businessDate)} · {txn.outletCode}
                {txn.reason ? ` · ${txn.reason}` : ''}
              </span>
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
        page={history.data.meta.page}
        pageSize={history.data.meta.pageSize}
        total={history.data.meta.total}
        onPageChange={setPage}
      />
    </div>
  );
}

const TABS = ['Details', 'Stock', 'History'] as const;

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const can = useCan();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Stock');

  const item = useQuery({
    queryKey: inventoryKeys.item(id),
    queryFn: () => getItem(id),
    enabled: Boolean(id),
  });

  if (item.isPending) return <Skeleton className="m-4 h-96 rounded-lg" />;
  if (item.isError) {
    return (
      <div className="p-4">
        <ErrorState message={errorMessage(item.error)} onRetry={() => void item.refetch()} />
      </div>
    );
  }

  const visible = TABS.filter(
    (t) => t !== 'History' || can('inventory.transaction.read'),
  ).filter((t) => t !== 'Stock' || can('inventory.stock.read'));

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
      <Link href="/inventory/items" className="text-sm underline">
        Back to item master
      </Link>
      <PageHeader
        title={item.data.name}
        description={`${item.data.categoryName} · ${item.data.unitCode} · ${item.data.sku}`}
        action={
          can('inventory.transaction.create') ? (
            <Link href="/inventory/entry">
              <Button>Record stock</Button>
            </Link>
          ) : null
        }
      />

      {item.data.isActive ? null : (
        <p className="rounded-lg bg-surface-muted p-3 text-sm text-text">
          This item is retired. Past transactions are kept, but it no longer appears in pickers.
        </p>
      )}

      <div className="flex gap-2 border-b border-border">
        {visible.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`min-h-[48px] px-4 text-sm font-medium ${
              tab === t
                ? 'border-b-2 border-primary text-text'
                : 'text-text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Details' ? <EditPanel item={item.data} /> : null}
      {tab === 'Stock' ? <ReorderPanel item={item.data} /> : null}
      {tab === 'History' ? <HistoryPanel item={item.data} /> : null}
    </div>
  );
}
