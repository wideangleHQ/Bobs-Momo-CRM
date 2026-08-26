'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/inventory/api';
import { FormError } from '@/features/inventory/fields';
import { createVendor } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import {
  emptyVendorDraft,
  VendorFields,
  vendorIssues,
  vendorPayload,
  type VendorDraft,
} from '@/features/purchase/vendor-form';

export default function NewVendorPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<VendorDraft>(emptyVendorDraft);

  const create = useMutation({
    mutationFn: () => createVendor(vendorPayload(draft)),
    onSuccess: (vendor) => {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      router.push(`/vendors/${vendor.id}`);
    },
  });

  const valid = Object.keys(vendorIssues(draft)).length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
      <Link href="/vendors" className="text-sm underline">
        Back to vendors
      </Link>
      <PageHeader title="Add vendor" description="Both outlets buy from the same suppliers." />

      <VendorFields draft={draft} onChange={setDraft} disabled={create.isPending} />

      <FormError message={create.isError ? errorMessage(create.error) : null}>
        <p className="mt-1">
          If this vendor already exists, open it from the vendor list rather than creating a second
          spelling.
        </p>
      </FormError>

      <Button
        onClick={() => create.mutate()}
        disabled={create.isPending || !valid}
        size="lg" fullWidth
      >
        {create.isPending ? 'Saving' : 'Save vendor'}
      </Button>
    </div>
  );
}
