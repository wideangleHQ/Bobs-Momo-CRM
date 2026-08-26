'use client';

import { useQuery } from '@tanstack/react-query';
import { listStock, type StockRow } from './api';
import { inventoryKeys } from './keys';

/**
 * The balance for one item at one outlet. GET /inventory/stock has no itemId
 * filter, so this searches by name and picks the row out of the page.
 *
 * ponytail: name search plus a client-side pick. Swap for an itemId filter the
 * day listStockQuery grows one.
 */
export function useOnHand(
  itemId: string,
  itemName: string,
  outletId: string,
): { row: StockRow | null; loading: boolean } {
  const params = { outletId, search: itemName, pageSize: 100 };
  const { data, isFetching } = useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => listStock(params),
    enabled: Boolean(itemId && itemName && outletId),
    staleTime: 15 * 1000,
  });
  return {
    row: data?.data.find((r) => r.itemId === itemId && r.outletId === outletId) ?? null,
    loading: isFetching,
  };
}
