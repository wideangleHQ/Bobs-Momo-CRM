'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createItemSchema } from '@bobs-momo/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { createItem, errorMessage } from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { useItemMaster } from '@/features/inventory/item-picker';
import { Field, FormError, SelectInput, TextInput } from '@/features/inventory/fields';

/** "Chicken Mince" becomes "ITM-CHICKEN-MINCE", the convention in chapter 16. */
function skuFor(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug ? `ITM-${slug}` : '';
}

export default function NewItemPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const master = useItemMaster();

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [skuTouched, setSkuTouched] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [isPerishable, setIsPerishable] = useState(false);

  const items = master.data ?? [];
  // ponytail: no GET /inventory/categories or /inventory/units exists, so the
  // pickers read the distinct values already present on the item master.
  const categories = [...new Map(items.map((i) => [i.categoryId, i.categoryName])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const units = [...new Map(items.map((i) => [i.unitId, i.unitCode])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const effectiveSku = skuTouched ? sku : skuFor(name);
  const draft = { name: name.trim(), sku: effectiveSku, categoryId, unitId, isPerishable };
  const parsed = createItemSchema.safeParse(draft);
  const fieldError = (path: string) =>
    parsed.success ? null : (parsed.error.issues.find((i) => i.path[0] === path)?.message ?? null);

  const create = useMutation({
    mutationFn: () => createItem(draft),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      router.push(`/inventory/items/${item.id}`);
    },
  });

  if (master.isPending) {
    return <Skeleton className="m-4 h-96 rounded-lg" />;
  }
  if (master.isError) {
    return (
      <div className="p-4">
        <ErrorState message={errorMessage(master.error)} onRetry={() => void master.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
      <Link href="/inventory/items" className="text-sm underline">
        Back to item master
      </Link>
      <PageHeader title="Add item" description="Master data, shared by both outlets." />

      <fieldset disabled={create.isPending} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="name" error={name ? fieldError('name') : null}>
          <TextInput id="name" value={name} onChange={setName} maxLength={120} autoFocus />
        </Field>

        <Field
          label="SKU"
          htmlFor="sku"
          hint="Generated from the name. Edit it only if you have a reason."
          error={name ? fieldError('sku') : null}
        >
          <TextInput
            id="sku"
            value={effectiveSku}
            onChange={(v) => {
              setSkuTouched(true);
              setSku(v.toUpperCase());
            }}
            maxLength={44}
          />
        </Field>

        <Field label="Category" htmlFor="category">
          <SelectInput
            id="category"
            value={categoryId}
            onChange={setCategoryId}
            options={categories}
            placeholder="Pick a category"
          />
        </Field>

        <Field
          label="Unit"
          htmlFor="unit"
          hint="The unit cannot be changed once the item has ledger rows."
        >
          <SelectInput
            id="unit"
            value={unitId}
            onChange={setUnitId}
            options={units}
            placeholder="Pick a unit"
          />
        </Field>

        <Checkbox
          id="isPerishable"
          label="Perishable"
          checked={isPerishable}
          onChange={(e) => setIsPerishable(e.target.checked)}
        />
      </fieldset>

      <FormError message={create.isError ? errorMessage(create.error) : null} />

      <Button
        onClick={() => create.mutate()}
        disabled={create.isPending || !parsed.success}
        size="lg" fullWidth
      >
        {create.isPending ? 'Saving' : 'Save item'}
      </Button>
    </div>
  );
}
