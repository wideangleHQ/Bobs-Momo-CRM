'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth';
import { listStock } from './api';
import { inventoryKeys } from './keys';

/**
 * The session carries outlet ids but no names, and there is no /outlets
 * endpoint yet. Stock rows carry both, so the label map comes from there.
 *
 * ponytail: one page of stock is enough to name two outlets. Swap the query for
 * GET /outlets the day that endpoint exists.
 */
export function useOutlets(): {
  options: { value: string; label: string }[];
  ready: boolean;
} {
  const { user } = useSession();
  const ids = user?.outletIds ?? [];
  const params = { pageSize: 100 as const };
  const { data, isSuccess } = useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => listStock(params),
    staleTime: 5 * 60 * 1000,
    enabled: ids.length > 0,
  });

  const codes = new Map<string, string>();
  for (const row of data?.data ?? []) codes.set(row.outletId, row.outletCode);

  return {
    options: ids.map((id) => ({ value: id, label: codes.get(id) ?? 'Outlet' })),
    ready: ids.length === 0 || isSuccess,
  };
}

/** The outlet a form should start on: the only one, or the first in scope. */
export function useDefaultOutletId(): string {
  const { user } = useSession();
  return user?.outletIds[0] ?? '';
}
