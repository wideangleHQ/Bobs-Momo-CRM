'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth';
import { listItems, listTransactions, type Item } from './api';
import { inventoryKeys } from './keys';
import { rank } from './search';
import { inputClass, Input } from '@/components/ui/input';

const MASTER_PAGE_SIZE = 100;
const MASTER_PAGE_CAP = 6;

/**
 * The whole active item master, fetched once per session. Around 200 rows and
 * 12 KB, which is cheaper than a server round trip per keystroke.
 */
export function useItemMaster() {
  return useQuery({
    queryKey: inventoryKeys.items({ pageSize: MASTER_PAGE_SIZE }),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Item[]> => {
      const out: Item[] = [];
      for (let page = 1; page <= MASTER_PAGE_CAP; page += 1) {
        const res = await listItems({ page, pageSize: MASTER_PAGE_SIZE });
        out.push(...res.data);
        if (out.length >= res.meta.total) break;
      }
      return out;
    },
  });
}

/**
 * The last eight distinct items this user moved at this outlet. A kitchen
 * manager touches the same twelve items every day, so the strip removes typing
 * from the common path.
 */
function useRecentItemIds(outletId: string): string[] {
  const { user } = useSession();
  const params = { outletId, createdById: user?.id, pageSize: 50 };
  const { data } = useQuery({
    queryKey: inventoryKeys.transactions(params),
    queryFn: () => listTransactions(params),
    staleTime: 60 * 1000,
    enabled: Boolean(outletId && user?.id),
  });
  const seen: string[] = [];
  for (const row of data?.data ?? []) {
    if (!seen.includes(row.item.id)) seen.push(row.item.id);
    if (seen.length === 8) break;
  }
  return seen;
}

export function ItemPicker(props: {
  items: Item[];
  loading?: boolean;
  value: string;
  onChange: (itemId: string) => void;
  /** Set to show the recent-items strip above the search box. */
  outletId?: string;
  disabled?: boolean;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const recentIds = useRecentItemIds(props.outletId ?? '');

  const selected = props.items.find((i) => i.id === props.value) ?? null;
  const matches = useMemo(
    () => rank(props.items, query, (i) => `${i.name} ${i.sku}`, 20),
    [props.items, query],
  );
  const recents = recentIds
    .map((id) => props.items.find((i) => i.id === id))
    .filter((i): i is Item => Boolean(i));

  if (selected && !open) {
    return (
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => {
          setOpen(true);
          setQuery('');
        }}
        className={`${inputClass} flex items-center justify-between text-left`}
      >
        <span className="font-medium">{selected.name}</span>
        <span className="text-sm text-text-muted">{selected.unitCode}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {props.outletId && recents.length > 0 && query === '' ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {recents.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={props.disabled}
              onClick={() => {
                props.onChange(item.id);
                setOpen(false);
                setQuery('');
              }}
              className="min-h-[56px] shrink-0 rounded-lg border border-border-strong bg-surface px-4 text-left"
            >
              <span className="block text-sm font-medium text-text">{item.name}</span>
              <span className="block text-xs text-text-muted">{item.unitCode}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Input
        type="search"
        autoComplete="off"
        placeholder="Search items"
        value={query}
        disabled={props.disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />

      {props.loading ? (
        <p className="px-1 py-2 text-sm text-text-muted">Loading items</p>
      ) : props.items.length === 0 ? (
        <p className="px-1 py-2 text-sm text-text-muted">
          {props.emptyHint ?? 'No items yet. Add one to the item master first.'}
        </p>
      ) : matches.length === 0 ? (
        <p className="px-1 py-2 text-sm text-text-muted">
          Nothing matches &quot;{query}&quot;. Try fewer letters.
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface">
          {matches.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => {
                  props.onChange(item.id);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-b-0"
              >
                <span className="text-base text-text">{item.name}</span>
                <span className="shrink-0 text-sm text-text-muted">{item.unitCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
