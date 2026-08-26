'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useCan } from '@/lib/auth';
import { money as fmtMoney, longDate, qty as fmtQty } from '@/lib/format';
import { errorMessage, type Item } from '@/features/inventory/api';
import { ItemPicker, useItemMaster } from '@/features/inventory/item-picker';
import { useDefaultOutletId, useOutlets } from '@/features/inventory/outlets';
import {
  DateInput,
  Field,
  FormError,
  MoneyInput,
  QtyInput,
  SelectInput,
  TextArea,
  TextInput,
} from '@/features/inventory/fields';
import {
  createPurchase,
  getRequest,
  getVendor,
  listPriceHistory,
  listVendors,
  type Purchase,
} from '@/features/purchase/api';
import { purchaseKeys } from '@/features/purchase/keys';
import { changePct, safeAddMoney, safeMultiplyMoney } from '@/features/purchase/decimal';

/** Tunable in chapter 17 as PURCHASE_PRICE_DEVIATION_PCT. */
const PRICE_DEVIATION_PCT = 25;
const BACKDATE_LIMIT_DAYS = 7;

interface Line {
  key: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
}

const blank = (): Line => ({ key: crypto.randomUUID(), itemId: '', quantity: '', unitPrice: '' });

function LineRow(props: {
  index: number;
  line: Line;
  items: Item[];
  itemsLoading: boolean;
  vendorId: string;
  removable: boolean;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const { line, items } = props;
  const item = items.find((i) => i.id === line.itemId) ?? null;

  const historyParams = { itemId: line.itemId, pageSize: 1 };
  const { data: history } = useQuery({
    queryKey: purchaseKeys.prices(historyParams),
    queryFn: () => listPriceHistory(historyParams),
    enabled: Boolean(line.itemId),
    staleTime: 5 * 60 * 1000,
  });
  const last = history?.data[0] ?? null;

  const lineTotal = safeMultiplyMoney(line.quantity, line.unitPrice);
  const drift = last && line.unitPrice ? changePct(last.unitPrice, line.unitPrice) : null;
  const warn = drift !== null && Math.abs(Number(drift)) >= PRICE_DEVIATION_PCT && !dismissed;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-muted">Line {props.index + 1}</span>
        {props.removable ? (
          <button
            type="button"
            onClick={props.onRemove}
            className="min-h-[44px] px-3 text-sm font-medium text-danger"
          >
            Remove
          </button>
        ) : null}
      </div>

      <ItemPicker
        items={items}
        loading={props.itemsLoading}
        value={line.itemId}
        onChange={(itemId) => props.onChange({ itemId })}
        emptyHint="This vendor has no linked items. Switch to all items."
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity">
          <QtyInput
            value={line.quantity}
            unit={item?.unitCode ?? ''}
            onChange={(quantity) => props.onChange({ quantity })}
          />
        </Field>
        <Field label="Unit price">
          <MoneyInput
            value={line.unitPrice}
            onChange={(unitPrice) => {
              setDismissed(false);
              props.onChange({ unitPrice });
            }}
          />
        </Field>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-text-muted">
          {last ? `Last paid ${fmtMoney(last.unitPrice)} on ${longDate(last.observedOn)}` : 'No price on record yet'}
        </span>
        <span className="text-base font-semibold tabular-nums text-text">
          {fmtMoney(lineTotal)}
        </span>
      </div>

      {warn && last ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm text-warning">
          <p>
            {last.itemName} was {fmtMoney(last.unitPrice)} on {longDate(last.observedOn)}. This is{' '}
            {Math.abs(Number(drift))}% {Number(drift) > 0 ? 'higher' : 'lower'}. Correct?
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="min-h-[44px] shrink-0 px-2 font-medium underline"
          >
            Yes
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SuccessView({ purchase, onAnother }: { purchase: Purchase; onAnother: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4">
      <PageHeader title="Purchase recorded" description={purchase.purchaseNo} />
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-text-muted">Total the server calculated</p>
        <p className="py-1 text-4xl font-semibold tabular-nums text-text">
          {fmtMoney(purchase.totalAmount)}
        </p>
        <p className="text-sm text-text-muted">
          {purchase.vendorName} · {longDate(purchase.purchaseDate)}
        </p>
      </div>

      <div>
        <p className="pb-2 text-sm font-medium text-text">Stock after this delivery</p>
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
          {purchase.lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 bg-surface px-3 py-2">
              <span className="text-sm text-text">{line.name}</span>
              <span className="text-sm font-semibold tabular-nums text-text">
                {line.balanceAfter === null
                  ? fmtQty(line.quantity, line.unitCode)
                  : fmtQty(line.balanceAfter, line.unitCode)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {purchase.priceWarnings && purchase.priceWarnings.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm text-warning">
          <p className="font-medium">The server flagged these prices</p>
          <ul className="mt-1 flex flex-col gap-1">
            {purchase.priceWarnings.map((w) => (
              <li key={w.itemId}>
                {w.name}: {fmtMoney(w.unitPrice)} against {fmtMoney(w.lastUnitPrice)} last time,{' '}
                {w.changePct}% different.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button onClick={onAnother} size="lg" fullWidth>
        Record another
      </Button>
      <Link href={`/purchases/records/${purchase.id}`} className="text-center text-sm underline">
        Open this purchase
      </Link>
    </div>
  );
}

function RecordPurchaseForm() {
  const search = useSearchParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const master = useItemMaster();
  const { options: outletOptions } = useOutlets();
  const defaultOutletId = useDefaultOutletId();

  const [outletId, setOutletId] = useState(search.get('outletId') ?? '');
  const [vendorId, setVendorId] = useState('');
  const [showAllItems, setShowAllItems] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(() => toBusinessDate());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [taxOpen, setTaxOpen] = useState(false);
  const [taxAmount, setTaxAmount] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [done, setDone] = useState<Purchase | null>(null);

  const requestId = search.get('requestId');

  useEffect(() => {
    if (!outletId && defaultOutletId) setOutletId(defaultOutletId);
  }, [outletId, defaultOutletId]);

  const vendorParams = { isActive: true, pageSize: 100 };
  const vendors = useQuery({
    queryKey: purchaseKeys.vendors(vendorParams),
    queryFn: () => listVendors(vendorParams),
    staleTime: 5 * 60 * 1000,
  });

  const vendor = useQuery({
    queryKey: purchaseKeys.vendor(vendorId),
    queryFn: () => getVendor(vendorId),
    enabled: Boolean(vendorId),
    staleTime: 5 * 60 * 1000,
  });

  // An approved request carries the item list, so the bill starts half keyed in.
  const request = useQuery({
    queryKey: purchaseKeys.request(requestId ?? ''),
    queryFn: () => getRequest(requestId ?? ''),
    enabled: Boolean(requestId),
  });
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !request.data) return;
    prefilled.current = true;
    setOutletId(request.data.outletId);
    setLines(
      request.data.lines.map((l) => ({
        key: crypto.randomUUID(),
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: '',
      })),
    );
  }, [request.data]);

  const allItems = master.data ?? [];
  const linkedIds = new Set(vendor.data?.itemIds ?? []);
  const items =
    showAllItems || !vendorId || linkedIds.size === 0
      ? allItems
      : allItems.filter((i) => linkedIds.has(i.id));

  const complete = lines.filter((l) => l.itemId && Number(l.quantity) > 0 && l.unitPrice !== '');
  const subtotal = safeAddMoney(
    complete.map((l) => safeMultiplyMoney(l.quantity, l.unitPrice)),
  );
  const total = safeAddMoney([subtotal, taxOpen && taxAmount ? taxAmount : '0.00']);

  const chosen = lines.map((l) => l.itemId).filter(Boolean);
  const duplicate = new Set(chosen).size !== chosen.length;

  const payload = useMemo(
    () => ({
      outletId,
      vendorId,
      ...(requestId ? { requestId } : {}),
      ...(invoiceNo.trim() ? { invoiceNo: invoiceNo.trim() } : {}),
      purchaseDate,
      taxAmount: taxOpen && taxAmount ? Number(taxAmount) : 0,
      ...(note.trim() ? { note: note.trim() } : {}),
      lines: complete.map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
      })),
    }),
    [outletId, vendorId, requestId, invoiceNo, purchaseDate, taxOpen, taxAmount, note, complete],
  );

  // Same rule as the stock entry screen: one key per submit attempt, reused by
  // a retry of that attempt so a lost response does not receive stock twice.
  const attemptKey = useRef<string | null>(null);
  const fingerprint = JSON.stringify(payload);
  useEffect(() => {
    attemptKey.current = null;
  }, [fingerprint]);

  const save = useMutation({
    mutationFn: () => {
      attemptKey.current ??= crypto.randomUUID();
      return createPurchase(payload, attemptKey.current);
    },
    onSuccess: (purchase) => {
      attemptKey.current = null;
      setDone(purchase);
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  if (done) {
    return (
      <SuccessView
        purchase={done}
        onAnother={() => {
          setDone(null);
          setLines([blank()]);
          setInvoiceNo('');
          setNote('');
          setTaxAmount('');
          save.reset();
        }}
      />
    );
  }

  if (vendors.isSuccess && vendors.data.data.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[560px] p-4">
        <EmptyState
          title="No vendors yet"
          description="A purchase needs a supplier to belong to. Add one first."
          action={
            can('vendor.vendor.create') ? (
              <Link href="/vendors/new">
                <Button>Add vendor</Button>
              </Link>
            ) : null
          }
        />
      </div>
    );
  }

  const blocker = !vendorId
    ? 'Pick a vendor'
    : !outletId
      ? 'Pick an outlet'
      : complete.length === 0
        ? 'Add at least one line with a quantity and a price'
        : duplicate
          ? 'The same item appears twice'
          : null;

  const busy = save.isPending;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4 pb-48">
      <Link href="/purchases/records" className="text-sm underline">
        Back to purchases
      </Link>
      <PageHeader
        title="Record purchase"
        description="Key the vendor bill in, then check the total against the paper."
      />

      <fieldset disabled={busy} className="flex flex-col gap-4">
        <Field label="Vendor" htmlFor="vendor">
          {vendors.isPending ? (
            <Skeleton className="h-12 w-full rounded-lg" />
          ) : (
            <SelectInput
              id="vendor"
              value={vendorId}
              onChange={setVendorId}
              placeholder="Pick a vendor"
              options={(vendors.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
          )}
        </Field>

        {vendorId && linkedIds.size > 0 ? (
          <Checkbox
            id="showAllItems"
            label={`Show all items, not only the ${linkedIds.size} linked to this vendor`}
            checked={showAllItems}
            onChange={(e) => setShowAllItems(e.target.checked)}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Purchase date" htmlFor="purchaseDate">
            <DateInput
              id="purchaseDate"
              value={purchaseDate}
              onChange={setPurchaseDate}
              min={businessDateOffset(-BACKDATE_LIMIT_DAYS).toISOString().slice(0, 10)}
              max={toBusinessDate()}
            />
          </Field>
        </div>

        <Field label="Invoice number (optional)" htmlFor="invoiceNo">
          <TextInput id="invoiceNo" value={invoiceNo} onChange={setInvoiceNo} maxLength={40} />
        </Field>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-text">Items</p>
          {lines.map((line, index) => (
            <LineRow
              key={line.key}
              index={index}
              line={line}
              items={items}
              itemsLoading={master.isPending}
              vendorId={vendorId}
              removable={lines.length > 1}
              onChange={(patch) =>
                setLines(lines.map((l) => (l.key === line.key ? { ...l, ...patch } : l)))
              }
              onRemove={() => setLines(lines.filter((l) => l.key !== line.key))}
            />
          ))}
          <Button
            onClick={() => setLines([...lines, blank()])}
            variant="secondary" size="lg" fullWidth
          >
            Add item
          </Button>
        </div>

        {taxOpen ? (
          <Field label="Tax" htmlFor="tax">
            <MoneyInput id="tax" value={taxAmount} onChange={setTaxAmount} />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setTaxOpen(true)}
            className="min-h-[44px] self-start text-sm font-medium underline"
          >
            Add tax
          </button>
        )}

        <Field label="Note (optional)" htmlFor="note">
          <TextArea id="note" value={note} onChange={setNote} maxLength={500} />
        </Field>
      </fieldset>

      <FormError message={save.isError ? errorMessage(save.error) : null}>
        <p className="mt-1">
          Tap Save again to retry. The retry reuses the same key, so nothing is recorded twice.
        </p>
      </FormError>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface p-4">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text-muted">Subtotal</span>
            <span className="text-sm tabular-nums text-text">{fmtMoney(subtotal)}</span>
          </div>
          {taxOpen ? (
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-text-muted">Tax</span>
              <span className="text-sm tabular-nums text-text">
                {fmtMoney(taxAmount || '0.00')}
              </span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between">
            <span className="text-base font-medium text-text">Total</span>
            <span className="text-3xl font-semibold tabular-nums text-text">
              {fmtMoney(total)}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Check this against the paper bill. The server works the total out again from the lines
            and saves its own figure.
          </p>
          {blocker ? <p className="text-sm text-text-muted">{blocker}</p> : null}
          <Button
            onClick={() => save.mutate()}
            disabled={busy || blocker !== null}
            size="lg" fullWidth
          >
            {busy ? 'Saving' : save.isError ? 'Retry save' : 'Save purchase'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function RecordPurchasePage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-96 rounded-lg" />}>
      <RecordPurchaseForm />
    </Suspense>
  );
}
