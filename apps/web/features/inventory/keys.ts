import type { ListItemsParams, ListStockParams, ListTxnParams } from './api';

export const inventoryKeys = {
  all: ['inventory'] as const,
  items: (p: ListItemsParams = {}) => ['inventory', 'items', p] as const,
  item: (id: string) => ['inventory', 'item', id] as const,
  stock: (p: ListStockParams = {}) => ['inventory', 'stock', p] as const,
  transactions: (p: ListTxnParams = {}) => ['inventory', 'transactions', p] as const,
};
