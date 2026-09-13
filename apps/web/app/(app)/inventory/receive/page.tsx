'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ReceiveStockFlow } from '@/features/inventory/receive-stock-flow';

export default function RecordNewStockPage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-96 rounded-xl" />}>
      <ReceiveStockFlow />
    </Suspense>
  );
}
