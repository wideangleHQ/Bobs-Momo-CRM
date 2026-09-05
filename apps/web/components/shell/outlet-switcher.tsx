'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { Select } from '@/components/ui/select';

interface Outlet {
  id: string;
  code: string;
  name: string;
}

const STORAGE_KEY = 'bm.outletId';

/** The chosen outlet, or null for all outlets. Read it before a scoped fetch. */
export function selectedOutletId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Hidden for a single outlet user, which is most of the staff. There is no
 * GET /outlets yet, so a failed lookup falls back to positional labels rather
 * than showing a uuid to a store manager.
 */
export function OutletSwitcher() {
  const { user } = useSession();
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(selectedOutletId() ?? '');
  }, []);

  const { data } = useQuery({
    queryKey: ['admin', 'outlets'],
    queryFn: () => apiGet<{ data: Outlet[] } | Outlet[]>('/outlets'),
    enabled: (user?.outletIds.length ?? 0) > 1,
    retry: false,
  });

  if (!user || user.outletIds.length <= 1) return null;

  const rows = Array.isArray(data) ? data : (data?.data ?? []);
  const nameOf = (id: string, index: number) =>
    rows.find((o) => o.id === id)?.name ?? `Outlet ${index + 1}`;

  return (
    <>
      <label htmlFor="outlet-switcher" className="sr-only">
        Outlet
      </label>
      <Select
        id="outlet-switcher"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          try {
            if (next) localStorage.setItem(STORAGE_KEY, next);
            else localStorage.removeItem(STORAGE_KEY);
          } catch {
            // Storage off. The choice still applies for this page view.
          }
        }}
        className="h-9 w-40 text-xs font-semibold"
      >
        {user.scope === 'ALL_OUTLETS' ? <option value="">All outlets</option> : null}
        {user.outletIds.map((id, i) => (
          <option key={id} value={id}>
            {nameOf(id, i)}
          </option>
        ))}
      </Select>
    </>
  );
}

