'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useCan } from '@/lib/auth';
import { money as fmtMoney, longDate, qty as fmtQty } from '@/lib/format';
import {
  createCategory,
  createItem,
  errorMessage,
  listCategories,
  listUnits,
  type Category,
  type Item,
  type Unit,
} from '@/features/inventory/api';
import { useItemMaster } from '@/features/inventory/item-picker';
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
  createVendor,
  getVendor,
  listPriceHistory,
  listPurchases,
  listVendors,
  type PriceWarning,
  type Purchase,
  type Vendor,
  type VendorRow,
} from '@/features/purchase/api';
import {
  emptyVendorDraft,
  vendorIssues,
  vendorPayload,
  VendorFields,
  type VendorDraft,
} from '@/features/purchase/vendor-form';
import { purchaseKeys } from '@/features/purchase/keys';
import { inventoryKeys } from '@/features/inventory/keys';
import { changePct, safeAddMoney, safeMultiplyMoney } from '@/features/purchase/decimal';
import { rank } from '@/features/inventory/search';

const PRICE_DEVIATION_PCT = 25;
const BACKDATE_LIMIT_DAYS = 7;
const GST_RATES = [
  { value: '0', label: '0%' },
  { value: '5', label: '5%' },
  { value: '12', label: '12%' },
  { value: '18', label: '18%' },
  { value: '28', label: '28%' },
];

export interface StockLine {
  key: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
  gstRate: string; // "0", "5", "12", "18", "28"
}

const createBlankLine = (): StockLine => ({
  key: crypto.randomUUID(),
  itemId: '',
  quantity: '',
  unitPrice: '',
  gstRate: '5',
});

// ── Inline Add Supplier Dialog with Duplicate Handling ──────────────────────
function InlineAddSupplierDialog({
  open,
  initialName = '',
  onClose,
  onCreated,
  onSelectExisting,
}: {
  open: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated: (vendor: Vendor) => void;
  onSelectExisting: (vendorId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<VendorDraft>(() => ({
    ...emptyVendorDraft,
    name: initialName,
  }));
  const [duplicateMatch, setDuplicateMatch] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft({ ...emptyVendorDraft, name: initialName });
      setDuplicateMatch(null);
    }
  }, [open, initialName]);

  const issues = vendorIssues(draft);
  const hasErrors = Object.keys(issues).length > 0;

  const save = useMutation({
    mutationFn: () => createVendor(vendorPayload(draft)),
    onSuccess: (vendor) => {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      setDraft({ ...emptyVendorDraft });
      setDuplicateMatch(null);
      onCreated(vendor);
    },
    onError: (err: unknown) => {
      if (err && typeof err === 'object' && 'details' in err) {
        const details = (err as { details?: Array<{ existingId?: string; existingName?: string }> }).details;
        if (Array.isArray(details)) {
          const firstDetail = details[0];
          if (firstDetail?.existingId) {
            setDuplicateMatch({
              id: firstDetail.existingId,
              name: firstDetail.existingName || draft.name,
            });
          }
        }
      }
    },
  });

  const busy = save.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          setDraft({ ...emptyVendorDraft });
          setDuplicateMatch(null);
          save.reset();
          onClose();
        }
      }}
      title="Add Supplier"
      description="Enter supplier details. Once saved, they will be selected automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={busy || hasErrors || !draft.name.trim()}
          >
            {busy ? 'Saving…' : 'Save Supplier'}
          </Button>
        </>
      }
    >
      {duplicateMatch ? (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm text-warning">
          <p className="font-medium">A supplier with this name already exists:</p>
          <p className="mt-0.5 font-semibold text-text">{duplicateMatch.name}</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onSelectExisting(duplicateMatch.id);
                onClose();
              }}
            >
              Use Existing Supplier
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDuplicateMatch(null)}
            >
              Change Name
            </Button>
          </div>
        </div>
      ) : null}

      <VendorFields draft={draft} onChange={setDraft} disabled={busy} />

      {save.isError && !duplicateMatch ? (
        <p className="mt-3 text-sm text-danger">{errorMessage(save.error)}</p>
      ) : null}
    </Dialog>
  );
}

// ── Inline Add Item Dialog ──────────────────────────────────────────────────
function InlineAddItemDialog({
  open,
  initialName = '',
  onClose,
  onCreated,
}: {
  open: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated: (item: Item) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [sku, setSku] = useState('');
  const [isPerishable, setIsPerishable] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [showAddCat, setShowAddCat] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSku('');
      setIsPerishable(false);
      setShowAddCat(false);
    }
  }, [open, initialName]);

  const categories = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn: listCategories,
    staleTime: 5 * 60 * 1000,
  });

  const units = useQuery({
    queryKey: ['inventory', 'units'],
    queryFn: listUnits,
    staleTime: 10 * 60 * 1000,
  });

  const categoryList: Category[] = categories.data?.data ?? [];
  const unitList: Unit[] = units.data?.data ?? [];

  // Auto-select first category and unit if none selected
  useEffect(() => {
    const firstCategory = categoryList[0];
    if (!categoryId && firstCategory) {
      setCategoryId(firstCategory.id);
    }
  }, [categoryId, categoryList]);

  useEffect(() => {
    if (!unitId && unitList.length > 0) {
      const defaultKg = unitList.find((u) => u.code === 'KG') ?? unitList[0];
      if (defaultKg) setUnitId(defaultKg.id);
    }
  }, [unitId, unitList]);

  const addCat = useMutation({
    mutationFn: (catName: string) => createCategory({ name: catName }),
    onSuccess: (newCat) => {
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'categories'] });
      setCategoryId(newCat.id);
      setShowAddCat(false);
      setNewCatName('');
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: {
        name: string;
        categoryId: string;
        unitId: string;
        isPerishable: boolean;
        sku?: string;
      } = {
        name: name.trim(),
        categoryId,
        unitId,
        isPerishable,
      };
      if (sku.trim()) payload.sku = sku.trim().toUpperCase();
      return createItem(payload);
    },
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      onCreated(item);
    },
  });

  const busy = save.isPending || addCat.isPending;
  const canSave = name.trim().length >= 2 && Boolean(categoryId) && Boolean(unitId);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          save.reset();
          onClose();
        }
      }}
      title="Add Inventory Item"
      description="Create a new item. It will be added to the items list and selected immediately."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={busy || !canSave}>
            {busy ? 'Saving Item…' : 'Save Item'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Item Name *" htmlFor="inline-item-name">
          <TextInput
            id="inline-item-name"
            value={name}
            onChange={setName}
            placeholder="e.g. Momo Wrapper, Potato, Chicken Mince"
            disabled={busy}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category *" htmlFor="inline-item-category">
            <div className="flex flex-col gap-1">
              <SelectInput
                id="inline-item-category"
                value={categoryId}
                onChange={setCategoryId}
                options={categoryList.map((c) => ({ value: c.id, label: c.name }))}
                disabled={busy || showAddCat}
              />
              {!showAddCat ? (
                <button
                  type="button"
                  onClick={() => setShowAddCat(true)}
                  className="self-start text-xs text-primary underline"
                >
                  + Add new category
                </button>
              ) : null}
            </div>
          </Field>

          <Field label="Unit of Measure *" htmlFor="inline-item-unit">
            <SelectInput
              id="inline-item-unit"
              value={unitId}
              onChange={setUnitId}
              options={unitList.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))}
              disabled={busy}
            />
          </Field>
        </div>

        {showAddCat ? (
          <div className="flex items-end gap-2 rounded-lg border border-border bg-surface-muted p-3">
            <div className="flex-1">
              <Field label="New Category Name" htmlFor="new-cat-name">
                <TextInput
                  id="new-cat-name"
                  value={newCatName}
                  onChange={setNewCatName}
                  placeholder="e.g. Packaging, Dairy, Meat"
                  disabled={busy}
                />
              </Field>
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (newCatName.trim()) addCat.mutate(newCatName.trim());
              }}
              disabled={busy || !newCatName.trim()}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setShowAddCat(false);
                setNewCatName('');
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        <Field
          label="SKU (Optional)"
          htmlFor="inline-item-sku"
          hint="Leave blank to auto-generate (e.g. ITM-MOMO-WRAPPER)"
        >
          <TextInput
            id="inline-item-sku"
            value={sku}
            onChange={setSku}
            placeholder="ITM-..."
            disabled={busy}
          />
        </Field>

        <Checkbox
          id="inline-item-perishable"
          label="Perishable item (short shelf life / requires daily tracking)"
          checked={isPerishable}
          onChange={(e) => setIsPerishable(e.target.checked)}
          disabled={busy}
        />

        {save.isError ? (
          <p className="text-sm text-danger">{errorMessage(save.error)}</p>
        ) : null}
      </div>
    </Dialog>
  );
}

// ── Searchable Item Select or Inline Create ─────────────────────────────────
function ItemRowPicker({
  items,
  loading,
  value,
  onChange,
  onAddNewItem,
}: {
  items: Item[];
  loading?: boolean;
  value: string;
  onChange: (itemId: string) => void;
  onAddNewItem: (searchQuery: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = items.find((i) => i.id === value) ?? null;
  const matches = useMemo(
    () => rank(items, query, (i) => `${i.name} ${i.sku}`, 20),
    [items, query],
  );

  if (selected && !open) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex flex-col">
          <span className="text-base font-semibold text-text">{selected.name}</span>
          <span className="text-xs text-text-muted">
            {selected.categoryName} · {selected.sku}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setQuery('');
          }}
          className="min-h-[36px] rounded px-2 text-sm text-primary underline hover:text-primary-hover"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" onFocusCapture={() => setOpen(true)}>
      <TextInput
        type="search"
        placeholder="Search item by name or SKU…"
        value={query}
        onChange={(v) => {
          setQuery(v);
          setOpen(true);
        }}
      />

      {loading ? (
        <p className="px-1 py-1 text-sm text-text-muted">Loading items…</p>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-sm text-text-muted">
            {query ? `No item found matching "${query}".` : 'No items found.'}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAddNewItem(query)}
            className="text-primary"
          >
            + Add &quot;{query || 'New Item'}&quot; to Inventory
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <ul className="max-h-60 overflow-y-auto rounded-lg border border-border bg-surface">
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex min-h-[48px] w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-muted"
                >
                  <span className="text-base font-medium text-text">{item.name}</span>
                  <span className="shrink-0 text-xs font-semibold text-text-muted">
                    {item.unitCode} · {item.categoryName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => onAddNewItem(query)}
            className="self-start px-1 py-1 text-xs font-medium text-primary underline"
          >
            + Item not listed? Add New Item
          </button>
        </div>
      )}
    </div>
  );
}

// ── Single Item Row in Receiving Table ──────────────────────────────────────
function ItemRow({
  index,
  line,
  items,
  itemsLoading,
  removable,
  onChange,
  onRemove,
  onAddNewItem,
}: {
  index: number;
  line: StockLine;
  items: Item[];
  itemsLoading: boolean;
  removable: boolean;
  onChange: (patch: Partial<StockLine>) => void;
  onRemove: () => void;
  onAddNewItem: (query: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const item = items.find((i) => i.id === line.itemId) ?? null;

  const historyParams = { itemId: line.itemId, pageSize: 1 };
  const { data: history } = useQuery({
    queryKey: purchaseKeys.prices(historyParams),
    queryFn: () => listPriceHistory(historyParams),
    enabled: Boolean(line.itemId),
    staleTime: 5 * 60 * 1000,
  });
  const last = history?.data[0] ?? null;

  const lineSubtotal = safeMultiplyMoney(line.quantity, line.unitPrice);
  const gstMultiplier = (Number(line.gstRate) || 0) / 100;
  const lineTax = (Number(lineSubtotal) * gstMultiplier).toFixed(2);
  const lineTotal = (Number(lineSubtotal) + Number(lineTax)).toFixed(2);

  const drift = last && line.unitPrice ? changePct(last.unitPrice, line.unitPrice) : null;
  const warn = drift !== null && Math.abs(Number(drift)) >= PRICE_DEVIATION_PCT && !dismissed;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">#{index + 1}</Badge>
          {item ? <span className="text-sm font-medium text-text">{item.name}</span> : null}
        </div>
        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-[36px] px-2 text-sm font-medium text-danger hover:underline"
          >
            Remove
          </button>
        ) : null}
      </div>

      <ItemRowPicker
        items={items}
        loading={itemsLoading}
        value={line.itemId}
        onChange={(itemId) => onChange({ itemId })}
        onAddNewItem={onAddNewItem}
      />

      <div className="grid grid-cols-3 gap-2">
        <Field label={`Qty ${item ? `(${item.unitCode})` : ''}`}>
          <QtyInput
            value={line.quantity}
            unit={item?.unitCode ?? ''}
            onChange={(quantity) => onChange({ quantity })}
          />
        </Field>

        <Field label="Unit Price (₹)">
          <MoneyInput
            value={line.unitPrice}
            onChange={(unitPrice) => {
              setDismissed(false);
              onChange({ unitPrice });
            }}
          />
        </Field>

        <Field label="GST %">
          <SelectInput
            value={line.gstRate}
            onChange={(gstRate) => onChange({ gstRate })}
            options={GST_RATES}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-muted">
        <span>
          {last
            ? `Last: ${fmtMoney(last.unitPrice)} (${longDate(last.observedOn)})`
            : 'No prior price on record'}
        </span>
        <span className="text-sm font-semibold tabular-nums text-text">
          Subtotal: {fmtMoney(lineSubtotal)} + Tax ({line.gstRate}%): {fmtMoney(lineTax)} ={' '}
          <span className="text-primary">{fmtMoney(lineTotal)}</span>
        </span>
      </div>

      {warn && last ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-warning/40 bg-warning-bg p-2.5 text-xs text-warning">
          <p>
            <strong>Price Alert:</strong> {last.itemName} was {fmtMoney(last.unitPrice)} previously.
            This is {Math.abs(Number(drift))}% {Number(drift) > 0 ? 'higher' : 'lower'}.
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 font-semibold underline"
          >
            Confirm
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Success View ────────────────────────────────────────────────────────────
function SuccessView({
  purchase,
  onRecordMore,
}: {
  purchase: Purchase;
  onRecordMore: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success text-3xl font-bold text-white shadow-sm">
          ✓
        </div>
        <h2 className="text-2xl font-bold text-text">Stock Received Successfully</h2>
        <p className="text-base text-text-muted">
          Supplier: <strong className="text-text">{purchase.vendorName}</strong> · Ref:{' '}
          <strong className="text-text">{purchase.purchaseNo}</strong>
        </p>
        {purchase.invoiceNo ? (
          <p className="text-xs text-text-muted">Invoice No: {purchase.invoiceNo}</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
          Items Added to Inventory ({purchase.lines.length})
        </h3>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {purchase.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-surface-muted/50"
            >
              <div className="flex flex-col">
                <span className="text-base font-medium text-text">{line.name}</span>
                <span className="text-xs text-text-muted">
                  {fmtQty(line.quantity, line.unitCode)} @ {fmtMoney(line.unitPrice)}
                </span>
              </div>
              <span className="text-base font-bold tabular-nums text-success">
                +{fmtQty(line.quantity, line.unitCode)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
          <div className="flex flex-col">
            <span className="text-xs text-text-muted">Subtotal: {fmtMoney(purchase.subtotal)}</span>
            <span className="text-xs text-text-muted">Tax / GST: {fmtMoney(purchase.taxAmount)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs text-text-muted">Total Recorded</span>
            <span className="text-2xl font-extrabold tabular-nums text-text">
              {fmtMoney(purchase.totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {purchase.priceWarnings && purchase.priceWarnings.length > 0 ? (
        <div className="rounded-xl border border-warning/40 bg-warning-bg p-4 text-sm text-warning">
          <p className="font-semibold">Price deviations noted during receipt:</p>
          <ul className="mt-1 list-inside list-disc">
            {purchase.priceWarnings.map((w: PriceWarning) => (
              <li key={w.itemId}>
                {w.name}: {fmtMoney(w.unitPrice)} vs {fmtMoney(w.lastUnitPrice)} previous (
                {w.changePct}% difference).
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 pt-2 sm:flex-row">
        <Button onClick={onRecordMore} size="lg" className="flex-1">
          Record More Stock
        </Button>
        <Link href={`/purchases/records/${purchase.id}`} className="flex-1">
          <Button variant="secondary" size="lg" fullWidth>
            View Purchase Slip
          </Button>
        </Link>
        <Link href="/inventory/stock" className="flex-1">
          <Button variant="secondary" size="lg" fullWidth>
            View Stock Balance
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ── Main Canonical Flow ─────────────────────────────────────────────────────
export function ReceiveStockFlow() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const master = useItemMaster();
  const { options: outletOptions } = useOutlets();
  const defaultOutletId = useDefaultOutletId();

  // Contextual prefilled state
  const prefillVendorId = searchParams.get('vendorId') || '';
  const prefillItemId = searchParams.get('itemId') || '';
  const prefillOutletId = searchParams.get('outletId') || '';

  const [outletId, setOutletId] = useState(prefillOutletId);
  const [vendorId, setVendorId] = useState(prefillVendorId);
  const [vendorSearch, setVendorSearch] = useState('');
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [supplierInitName, setSupplierInitName] = useState('');

  // Purchase slip mode: 'NEW' | 'EXISTING' | 'NO_SLIP'
  const [slipMode, setSlipMode] = useState<'NEW' | 'EXISTING' | 'NO_SLIP'>('NEW');
  const [purchaseDate, setPurchaseDate] = useState(() => toBusinessDate());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [selectedExistingPurchaseId, setSelectedExistingPurchaseId] = useState('');
  const [attachmentName, setAttachmentName] = useState('');

  // Items entry
  const [lines, setLines] = useState<StockLine[]>([
    prefillItemId ? { ...createBlankLine(), itemId: prefillItemId } : createBlankLine(),
  ]);

  // Inline Item Dialog state
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemInitName, setItemInitName] = useState('');
  const [activeLineIndexForNewItem, setActiveLineIndexForNewItem] = useState<number | null>(null);

  // Completed Receipt state
  const [completedPurchase, setCompletedPurchase] = useState<Purchase | null>(null);

  // Set default outlet if not set
  useEffect(() => {
    if (!outletId && defaultOutletId) setOutletId(defaultOutletId);
  }, [outletId, defaultOutletId]);

  // Queries
  const vendorsQuery = useQuery({
    queryKey: purchaseKeys.vendors({ isActive: true, pageSize: 100 }),
    queryFn: () => listVendors({ isActive: true, pageSize: 100 }),
    staleTime: 5 * 60 * 1000,
  });

  const existingPurchasesQuery = useQuery({
    queryKey: purchaseKeys.purchases({ vendorId, pageSize: 20 }),
    queryFn: () => listPurchases({ vendorId, pageSize: 20 }),
    enabled: Boolean(vendorId && slipMode === 'EXISTING'),
  });

  const allVendors: VendorRow[] = vendorsQuery.data?.data ?? [];
  const selectedVendor = allVendors.find((v) => v.id === vendorId) ?? null;
  const filteredVendors = vendorSearch.trim()
    ? allVendors.filter(
        (v) =>
          v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
          (v.phone ?? '').includes(vendorSearch) ||
          (v.gstin ?? '').toLowerCase().includes(vendorSearch.toLowerCase()),
      )
    : allVendors;

  const allItems: Item[] = master.data ?? [];

  // Calculations
  const validLines = lines.filter((l) => l.itemId && Number(l.quantity) > 0 && l.unitPrice !== '');
  const subtotal = safeAddMoney(
    validLines.map((l) => safeMultiplyMoney(l.quantity, l.unitPrice)),
  );
  const computedTaxTotal = validLines
    .reduce((acc, l) => {
      const lineSub = Number(safeMultiplyMoney(l.quantity, l.unitPrice)) || 0;
      const rate = (Number(l.gstRate) || 0) / 100;
      return acc + lineSub * rate;
    }, 0)
    .toFixed(2);
  const grandTotal = (Number(subtotal) + Number(computedTaxTotal)).toFixed(2);

  // Duplicate item check
  const chosenItemIds = lines.map((l) => l.itemId).filter(Boolean);
  const hasDuplicateItems = new Set(chosenItemIds).size !== chosenItemIds.length;

  // Payload formulation
  const payload = useMemo(() => {
    return {
      outletId,
      vendorId,
      purchaseDate,
      invoiceNo: slipMode === 'NEW' && invoiceNo.trim() ? invoiceNo.trim() : undefined,
      taxAmount: Number(computedTaxTotal) || 0,
      note: note.trim()
        ? `${note.trim()}${attachmentName ? ` [Attached: ${attachmentName}]` : ''}`
        : attachmentName
          ? `[Attached: ${attachmentName}]`
          : undefined,
      lines: validLines.map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxRate: Number(l.gstRate) || 0,
      })),
    };
  }, [outletId, vendorId, purchaseDate, invoiceNo, slipMode, computedTaxTotal, note, attachmentName, validLines]);

  const attemptKeyRef = useRef<string | null>(null);
  const fingerprint = JSON.stringify(payload);
  useEffect(() => {
    attemptKeyRef.current = null;
  }, [fingerprint]);

  const saveReceipt = useMutation({
    mutationFn: () => {
      attemptKeyRef.current ??= crypto.randomUUID();
      return createPurchase(payload, attemptKeyRef.current);
    },
    onSuccess: (res) => {
      attemptKeyRef.current = null;
      setCompletedPurchase(res);
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });

  if (completedPurchase) {
    return (
      <SuccessView
        purchase={completedPurchase}
        onRecordMore={() => {
          setCompletedPurchase(null);
          setLines([createBlankLine()]);
          setInvoiceNo('');
          setNote('');
          setAttachmentName('');
          saveReceipt.reset();
        }}
      />
    );
  }

  const blockerMessage = !outletId
    ? 'Select an outlet to continue'
    : !vendorId
      ? 'Search or add a supplier to continue'
      : validLines.length === 0
        ? 'Add at least one item with quantity and price'
        : hasDuplicateItems
          ? 'The same item appears multiple times — combine or remove duplicates'
          : null;

  const busy = saveReceipt.isPending;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 pb-32">
      <div className="flex items-center justify-between">
        <Link href="/inventory" className="text-sm text-text-muted hover:underline">
          ← Back to Inventory
        </Link>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Operational Flow
        </span>
      </div>

      <PageHeader
        title="Record New Stock"
        description="Receive stock delivered by a supplier. Missing suppliers and items can be added directly."
      />

      {/* Inline Supplier Dialog */}
      <InlineAddSupplierDialog
        open={showAddSupplier}
        initialName={supplierInitName}
        onClose={() => setShowAddSupplier(false)}
        onCreated={(newVendor) => {
          setVendorId(newVendor.id);
          setShowAddSupplier(false);
          setVendorSearch('');
        }}
        onSelectExisting={(existingId) => {
          setVendorId(existingId);
          setShowAddSupplier(false);
          setVendorSearch('');
        }}
      />

      {/* Inline Item Dialog */}
      <InlineAddItemDialog
        open={showAddItem}
        initialName={itemInitName}
        onClose={() => setShowAddItem(false)}
        onCreated={(newItem) => {
          if (activeLineIndexForNewItem !== null && activeLineIndexForNewItem < lines.length) {
            setLines((prev) =>
              prev.map((l, idx) =>
                idx === activeLineIndexForNewItem ? { ...l, itemId: newItem.id } : l,
              ),
            );
          } else {
            setLines((prev) => [...prev, { ...createBlankLine(), itemId: newItem.id }]);
          }
          setShowAddItem(false);
        }}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Form Steps */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          {/* ── 1. Outlet Selection ─────────────────────────── */}
          {outletOptions.length > 1 ? (
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <Field label="Receiving Outlet *" htmlFor="rec-outlet">
                <SelectInput
                  id="rec-outlet"
                  value={outletId}
                  onChange={setOutletId}
                  options={outletOptions}
                  disabled={busy}
                />
              </Field>
            </div>
          ) : null}

          {/* ── 2. Supplier Step ────────────────────────────── */}
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-text">1. Supplier</h3>
              {selectedVendor ? (
                <Badge variant="outline" className="text-success border-success/30">
                  Selected
                </Badge>
              ) : null}
            </div>

            {selectedVendor ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/5 p-3.5">
                <div>
                  <p className="text-base font-bold text-text">{selectedVendor.name}</p>
                  <p className="text-xs text-text-muted">
                    {selectedVendor.phone ? `Phone: ${selectedVendor.phone}` : ''}
                    {selectedVendor.gstin ? ` · GSTIN: ${selectedVendor.gstin}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setVendorId('')}
                  disabled={busy}
                >
                  Change Supplier
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <TextInput
                  type="search"
                  value={vendorSearch}
                  onChange={setVendorSearch}
                  placeholder="Search suppliers by name, phone or GSTIN…"
                  disabled={busy}
                />

                {vendorsQuery.isPending ? (
                  <Skeleton className="h-12 w-full rounded-lg" />
                ) : filteredVendors.length > 0 ? (
                  <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface">
                    {filteredVendors.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setVendorId(v.id);
                            setVendorSearch('');
                          }}
                          className="flex min-h-[52px] w-full flex-col justify-center px-3 py-2 text-left hover:bg-surface-muted"
                        >
                          <span className="text-sm font-semibold text-text">{v.name}</span>
                          <span className="text-xs text-text-muted">
                            {v.phone ? `Phone: ${v.phone}` : ''}
                            {v.gstin ? ` · GSTIN: ${v.gstin}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : vendorSearch ? (
                  <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-text-muted">
                    No supplier found matching &quot;{vendorSearch}&quot;.
                  </div>
                ) : null}

                <div className="mt-1 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setSupplierInitName(vendorSearch);
                      setShowAddSupplier(true);
                    }}
                    className="min-h-[40px] text-sm font-semibold text-primary underline hover:text-primary-hover"
                  >
                    + Add New Supplier Inline
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── 3. Purchase Slip / Invoice Step ──────────────── */}
          {vendorId ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <h3 className="text-base font-semibold text-text">2. Purchase Slip / Invoice</h3>

              {/* Mode Toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSlipMode('NEW')}
                  className={`min-h-[40px] flex-1 rounded-lg border text-xs font-semibold sm:text-sm ${
                    slipMode === 'NEW'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface text-text-muted hover:bg-surface-muted'
                  }`}
                >
                  Create New Slip
                </button>
                <button
                  type="button"
                  onClick={() => setSlipMode('EXISTING')}
                  className={`min-h-[40px] flex-1 rounded-lg border text-xs font-semibold sm:text-sm ${
                    slipMode === 'EXISTING'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface text-text-muted hover:bg-surface-muted'
                  }`}
                >
                  Existing Purchase
                </button>
                <button
                  type="button"
                  onClick={() => setSlipMode('NO_SLIP')}
                  className={`min-h-[40px] flex-1 rounded-lg border text-xs font-semibold sm:text-sm ${
                    slipMode === 'NO_SLIP'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface text-text-muted hover:bg-surface-muted'
                  }`}
                >
                  No Slip
                </button>
              </div>

              {slipMode === 'NEW' ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Delivery / Purchase Date *" htmlFor="purchaseDate">
                      <DateInput
                        id="purchaseDate"
                        value={purchaseDate}
                        onChange={setPurchaseDate}
                        min={businessDateOffset(-BACKDATE_LIMIT_DAYS).toISOString().slice(0, 10)}
                        max={toBusinessDate()}
                        disabled={busy}
                      />
                    </Field>
                    <Field label="Supplier Bill / Invoice #" htmlFor="invoiceNo">
                      <TextInput
                        id="invoiceNo"
                        value={invoiceNo}
                        onChange={setInvoiceNo}
                        placeholder="e.g. INV-2026-0042"
                        maxLength={40}
                        disabled={busy}
                      />
                    </Field>
                  </div>

                  {/* Attachment Upload UX */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-text">Invoice Photo / Attachment</span>
                    {attachmentName ? (
                      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted p-2.5">
                        <span className="text-xs font-medium text-text">
                          📄 {attachmentName}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachmentName('')}
                          className="text-xs text-danger hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-4 text-xs font-medium text-text-muted hover:bg-surface-muted">
                        <span>📷 Upload Photo / PDF Slip</span>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setAttachmentName(file.name);
                          }}
                          disabled={busy}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ) : slipMode === 'EXISTING' ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-text-muted">
                    Select a previous purchase recorded for {selectedVendor?.name}:
                  </p>
                  {existingPurchasesQuery.isPending ? (
                    <Skeleton className="h-10 w-full rounded-lg" />
                  ) : existingPurchasesQuery.data?.data.length ? (
                    <SelectInput
                      value={selectedExistingPurchaseId}
                      onChange={setSelectedExistingPurchaseId}
                      placeholder="Select existing purchase…"
                      options={existingPurchasesQuery.data.data.map((p) => ({
                        value: p.id,
                        label: `${p.purchaseNo} · ${p.invoiceNo ? `Inv: ${p.invoiceNo} · ` : ''}${fmtMoney(p.totalAmount)} on ${longDate(p.purchaseDate)}`,
                      }))}
                      disabled={busy}
                    />
                  ) : (
                    <p className="text-xs text-text-muted">
                      No recorded purchases found for this supplier.
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-lg bg-surface-muted p-3 text-xs text-text-muted">
                  Continuing without invoice details. Stock will still be received and accounted for.
                </p>
              )}
            </div>
          ) : null}

          {/* ── 4. Items Received Step ───────────────────────── */}
          {vendorId ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-text">3. Items Received</h3>
                <span className="text-xs text-text-muted">
                  {validLines.length} {validLines.length === 1 ? 'item' : 'items'} ready
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {lines.map((line, index) => (
                  <ItemRow
                    key={line.key}
                    index={index}
                    line={line}
                    items={allItems}
                    itemsLoading={master.isPending}
                    removable={lines.length > 1}
                    onChange={(patch) =>
                      setLines(lines.map((l) => (l.key === line.key ? { ...l, ...patch } : l)))
                    }
                    onRemove={() => setLines(lines.filter((l) => l.key !== line.key))}
                    onAddNewItem={(queryStr) => {
                      setActiveLineIndexForNewItem(index);
                      setItemInitName(queryStr);
                      setShowAddItem(true);
                    }}
                  />
                ))}
              </div>

              <Button
                type="button"
                variant="secondary"
                onClick={() => setLines([...lines, createBlankLine()])}
                disabled={busy}
                className="mt-1"
              >
                + Add Another Item
              </Button>
            </div>
          ) : null}

          {/* ── 5. Optional Notes ───────────────────────────── */}
          {vendorId ? (
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <Field label="Notes (Optional)" htmlFor="delivery-notes">
                <TextArea
                  id="delivery-notes"
                  value={note}
                  onChange={setNote}
                  placeholder="e.g. Delivered directly to kitchen deep freezer"
                  maxLength={500}
                  disabled={busy}
                />
              </Field>
            </div>
          ) : null}
        </div>

        {/* Right Column: Live Sticky Summary (Desktop) */}
        <div className="flex flex-col gap-4">
          <div className="sticky top-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
            <h3 className="text-base font-bold text-text">Stock Receipt Summary</h3>

            <div className="flex flex-col divide-y divide-border text-sm">
              <div className="flex justify-between py-2">
                <span className="text-text-muted">Supplier</span>
                <span className="font-medium text-text">
                  {selectedVendor ? selectedVendor.name : '—'}
                </span>
              </div>

              <div className="flex justify-between py-2">
                <span className="text-text-muted">Date</span>
                <span className="font-medium text-text">{longDate(purchaseDate)}</span>
              </div>

              <div className="flex justify-between py-2">
                <span className="text-text-muted">Slip Ref</span>
                <span className="font-medium text-text">
                  {slipMode === 'NEW' && invoiceNo
                    ? invoiceNo
                    : slipMode === 'EXISTING'
                      ? 'Existing Purchase'
                      : slipMode === 'NO_SLIP'
                        ? 'No Slip'
                        : 'Auto-assigned'}
                </span>
              </div>

              <div className="flex justify-between py-2">
                <span className="text-text-muted">Valid Items</span>
                <span className="font-medium text-text">{validLines.length}</span>
              </div>

              <div className="flex justify-between py-2">
                <span className="text-text-muted">Subtotal</span>
                <span className="font-medium tabular-nums text-text">{fmtMoney(subtotal)}</span>
              </div>

              <div className="flex justify-between py-2">
                <span className="text-text-muted">Total Tax / GST</span>
                <span className="font-medium tabular-nums text-text">{fmtMoney(computedTaxTotal)}</span>
              </div>

              <div className="flex items-baseline justify-between pt-3">
                <span className="text-base font-bold text-text">Grand Total</span>
                <span className="text-2xl font-extrabold tabular-nums text-primary">
                  {fmtMoney(grandTotal)}
                </span>
              </div>
            </div>

            {blockerMessage ? (
              <p className="rounded-lg bg-surface-muted p-2.5 text-center text-xs text-text-muted">
                {blockerMessage}
              </p>
            ) : null}

            <FormError message={saveReceipt.isError ? errorMessage(saveReceipt.error) : null}>
              <p className="mt-1 text-xs">
                Your entered items and details are preserved. Click to retry.
              </p>
            </FormError>

            <Button
              onClick={() => saveReceipt.mutate()}
              disabled={busy || blockerMessage !== null}
              size="lg"
              fullWidth
              className="mt-2 text-base font-bold"
            >
              {busy ? 'Receiving Stock…' : saveReceipt.isError ? 'Retry Receipt' : 'RECEIVE STOCK'}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Bottom Bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 shadow-lg lg:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-xs text-text-muted">Total Amount</span>
            <span className="text-xl font-bold tabular-nums text-text">{fmtMoney(grandTotal)}</span>
          </div>
          <Button
            onClick={() => saveReceipt.mutate()}
            disabled={busy || blockerMessage !== null}
            size="lg"
            className="flex-1 font-bold"
          >
            {busy ? 'Receiving…' : 'RECEIVE STOCK'}
          </Button>
        </div>
      </div>
    </div>
  );
}
