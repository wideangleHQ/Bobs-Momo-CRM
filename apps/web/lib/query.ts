'use client';

import { createElement, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Master data defaults from chapter 29. Live boards, notifications and detail
 * records override staleTime and refetchOnWindowFocus in their own hooks.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // A 403 or a 404 does not get better by asking again, and a 401 has
          // already been through the refresh path in lib/api.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        // A POST that moves stock is retried only when the user taps again.
        retry: false,
      },
    },
  });
}

export function QueryProvider(props: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return createElement(QueryClientProvider, { client }, props.children);
}
