import type {
  ListPurchasesParams,
  ListRequestsParams,
  ListVendorsParams,
  PriceHistoryParams,
} from './api';

export const purchaseKeys = {
  all: ['purchase'] as const,
  vendors: (p: ListVendorsParams = {}) => ['purchase', 'vendors', p] as const,
  vendor: (id: string) => ['purchase', 'vendor', id] as const,
  requests: (p: ListRequestsParams = {}) => ['purchase', 'requests', p] as const,
  request: (id: string) => ['purchase', 'request', id] as const,
  purchases: (p: ListPurchasesParams = {}) => ['purchase', 'purchases', p] as const,
  purchase: (id: string) => ['purchase', 'purchase', id] as const,
  prices: (p: PriceHistoryParams = {}) => ['purchase', 'prices', p] as const,
};
