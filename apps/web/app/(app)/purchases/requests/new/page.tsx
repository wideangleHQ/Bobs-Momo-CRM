'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toBusinessDate } from '@bobs-momo/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/inventory/api';
import { ItemPicker, useItemMaster } from '@/features/inventory/item-picker';
import { useDefaultOutletId, useOutlets } from '@/features/inventory/outlets';
import {
  DateInput,
  Field,
  FormError,
  QtyInput,
  SelectInput,
  TextArea,
} from '@/features/inventory/fields';
import { createRequest } from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';

interface Line {
  key: string;
  itemId: string;
  quantity: string;
  note: string;
}

const blank = (): Line => ({ key: crypto.randomUUID(), itemId: '', quantity: '', note: '' });

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const master = useItemMaster();
  const { options: outletOptions } = useOutlets();
  const defaultOutletId = useDefaultOutletId();

  const [outletId, setOutletId] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);

  useEffect(() => {
    if (!outletId && defaultOutletId) setOutletId(defaultOutletId);
  }, [outletId, defaultOutletId]);

  const items = master.data ?? [];
  const chosen = lines.map((l) => l.itemId).filter(Boolean);
  const duplicate = new Set(chosen).size !== chosen.length;
  const complete = lines.filter((l) => l.itemId && Number(l.quantity) > 0);

  const create = useMutation({
    mutationFn: () =>
      createRequest({
        outletId,
        ...(neededBy ? { neededBy } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        lines: complete.map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          ...(l.note.trim() ? { note: l.note.trim() } : {}),
        })),
      }),
    onSuccess: (request) => {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      router.push(`/purchases/requests/${request.id}`);
    },
  });

  const blocker = !outletId
    ? 'Pick an outlet'
    : complete.length === 0
      ? 'Add at least one item with a quantity'
      : duplicate
        ? 'The same item appears twice'
        : null;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4 pb-32">
      <Link href="/purchases/requests" className="text-sm underline">
        Back to requests
      </Link>
      <PageHeader
        title="New purchase request"
        description="Say what is running out. The purchase manager decides what it costs."
      />

      <fieldset disabled={create.isPending} className="flex flex-col gap-4">
        {outletOptions.length > 1 ? (
          <Field label="Outlet" htmlFor="outlet">
            <SelectInput id="outlet" value={outletId} onChange={setOutletId} options={outletOptions} />
          </Field>
        ) : null}

        <Field label="Needed by (optional)" htmlFor="neededBy">
          <DateInput id="neededBy" value={neededBy} onChange={setNeededBy} min={toBusinessDate()} />
        </Field>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-text">Items</p>
          {lines.map((line, index) => {
            const item = items.find((i) => i.id === line.itemId) ?? null;
            return (
              <div key={line.key} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-muted">Line {index + 1}</span>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                      className="min-h-[44px] px-3 text-sm font-medium text-danger"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <ItemPicker
                  items={items}
                  loading={master.isPending}
                  value={line.itemId}
                  onChange={(itemId) =>
                    setLines(lines.map((l) => (l.key === line.key ? { ...l, itemId } : l)))
                  }
                />
                <QtyInput
                  value={line.quantity}
                  unit={item?.unitCode ?? ''}
                  onChange={(quantity) =>
                    setLines(lines.map((l) => (l.key === line.key ? { ...l, quantity } : l)))
                  }
                />
              </div>
            );
          })}
          <Button
            onClick={() => setLines([...lines, blank()])}
            variant="secondary" size="lg" fullWidth
          >
            Add item
          </Button>
        </div>

        <Field label="Note (optional)" htmlFor="note">
          <TextArea id="note" value={note} onChange={setNote} maxLength={500} />
        </Field>
      </fieldset>

      <FormError message={create.isError ? errorMessage(create.error) : null} />

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface p-4">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2">
          {blocker ? <p className="text-sm text-text-muted">{blocker}</p> : null}
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || blocker !== null}
            size="lg" fullWidth
          >
            {create.isPending ? 'Sending' : 'Send request'}
          </Button>
        </div>
      </div>
    </div>
  );
}
