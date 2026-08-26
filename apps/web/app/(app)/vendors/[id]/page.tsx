'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useCan } from '@/lib/auth';
import { longDate, money as fmtMoney } from '@/lib/format';
import { errorMessage } from '@/features/inventory/api';
import { useItemMaster } from '@/features/inventory/item-picker';
import { FormError, TextInput, useDebounced } from '@/features/inventory/fields';
import { rank } from '@/features/inventory/search';
import {
  deactivateVendor,
  getVendor,
  listPurchases,
  setVendorItems,
  updateVendor,
} from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import { StatusPill } from '@/features/purchase/status';
import {
  VendorFields,
  vendorIssues,
  vendorPayload,
  type VendorDraft,
} from '@/features/purchase/vendor-form';

const TABS = ['Details', 'Items', 'Purchases'] as const;

function ItemLinks({ vendorId, itemIds }: { vendorId: string; itemIds: string[] }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const master = useItemMaster();
  const [selected, setSelected] = useState<string[]>(itemIds);
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounced(rawSearch);

  useEffect(() => setSelected(itemIds), [itemIds]);

  const save = useMutation({
    mutationFn: () => setVendorItems(vendorId, selected),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: purchaseKeys.all }),
  });

  if (master.isPending) return <Skeleton className="h-64 w-full rounded-lg" />;

  const items = rank(master.data ?? [], search, (i) => `${i.name} ${i.sku}`, 200);
  const dirty =
    selected.length !== itemIds.length || selected.some((id) => !itemIds.includes(id));
  const editable = can('vendor.vendor.update');

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        Linking items narrows the picker on the purchase screen to what this vendor actually sells.
        An empty list means they sell anything.
      </p>
      <TextInput type="search" value={rawSearch} onChange={setRawSearch} placeholder="Search items" />

      <ul className="max-h-96 overflow-y-auto rounded-lg border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id}>
            <Checkbox
              id={`link-${item.id}`}
              className="border-b border-border px-3 last:border-b-0"
              disabled={!editable || save.isPending}
              checked={selected.includes(item.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
              label={`${item.name} (${item.unitCode})`}
            />
          </li>
        ))}
      </ul>

      <FormError message={save.isError ? errorMessage(save.error) : null} />
      {editable ? (
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          size="lg" fullWidth
        >
          {save.isPending ? 'Saving' : `Save ${selected.length} linked items`}
        </Button>
      ) : null}
    </div>
  );
}

function SupplyHistory({ vendorId }: { vendorId: string }) {
  const params = { vendorId, pageSize: 25 };
  const purchases = useQuery({
    queryKey: purchaseKeys.purchases(params),
    queryFn: () => listPurchases(params),
  });

  if (purchases.isPending) return <Skeleton className="h-48 w-full rounded-lg" />;
  if (purchases.isError) {
    return (
      <ErrorState message={errorMessage(purchases.error)} onRetry={() => void purchases.refetch()} />
    );
  }
  if (purchases.data.data.length === 0) {
    return <p className="text-sm text-text-muted">Nothing bought from this vendor yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
      {purchases.data.data.map((p) => (
        <li key={p.id}>
          <Link
            href={`/purchases/records/${p.id}`}
            className="flex min-h-[56px] items-center justify-between gap-3 bg-surface px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-text">{p.purchaseNo}</span>
              <span className="text-xs text-text-muted">
                {longDate(p.purchaseDate)} · {p.outletCode}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {p.status === 'RECORDED' ? null : <StatusPill status={p.status} />}
              <span className="text-sm font-semibold tabular-nums text-text">
                {fmtMoney(p.totalAmount)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Details');
  const [draft, setDraft] = useState<VendorDraft | null>(null);

  const vendor = useQuery({
    queryKey: purchaseKeys.vendor(id),
    queryFn: () => getVendor(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!vendor.data) return;
    setDraft({
      name: vendor.data.name,
      phone: vendor.data.phone ?? '',
      email: vendor.data.email ?? '',
      address: vendor.data.address ?? '',
      gstin: vendor.data.gstin ?? '',
    });
  }, [vendor.data]);

  const save = useMutation({
    mutationFn: () => updateVendor(id, vendorPayload(draft!)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: purchaseKeys.all }),
  });
  const retire = useMutation({
    mutationFn: () => deactivateVendor(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: purchaseKeys.all }),
  });

  if (vendor.isPending || !draft) return <Skeleton className="m-4 h-96 rounded-lg" />;
  if (vendor.isError) {
    return (
      <div className="p-4">
        <ErrorState message={errorMessage(vendor.error)} onRetry={() => void vendor.refetch()} />
      </div>
    );
  }

  const v = vendor.data;
  const valid = Object.keys(vendorIssues(draft)).length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
      <Link href="/vendors" className="text-sm underline">
        Back to vendors
      </Link>
      <PageHeader
        title={v.name}
        description={`${v.itemIds.length} linked items`}
        action={v.isActive ? null : <StatusPill status="CANCELLED" />}
      />

      {v.isActive ? null : (
        <p className="rounded-lg bg-surface-muted p-3 text-sm text-text">
          This vendor is retired. Past purchases are kept, but new bills cannot be recorded against
          them.
        </p>
      )}

      <div className="flex gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`min-h-[48px] px-4 text-sm font-medium ${
              tab === t ? 'border-b-2 border-primary text-text' : 'text-text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Details' ? (
        <div className="flex flex-col gap-4">
          <VendorFields
            draft={draft}
            onChange={setDraft}
            disabled={!can('vendor.vendor.update') || save.isPending}
          />
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          {can('vendor.vendor.update') ? (
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !valid}
              size="lg" fullWidth
            >
              {save.isPending ? 'Saving' : 'Save changes'}
            </Button>
          ) : null}

          {can('vendor.vendor.deactivate') && v.isActive ? (
            <>
              <FormError message={retire.isError ? errorMessage(retire.error) : null} />
              <Button
                onClick={() => retire.mutate()}
                disabled={retire.isPending}
                variant="danger" size="lg" fullWidth
              >
                {retire.isPending ? 'Retiring' : 'Retire this vendor'}
              </Button>
              <p className="text-xs text-text-muted">
                Retiring keeps every past purchase and stops new bills being recorded against them.
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'Items' ? <ItemLinks vendorId={id} itemIds={v.itemIds} /> : null}
      {tab === 'Purchases' ? <SupplyHistory vendorId={id} /> : null}
    </div>
  );
}
