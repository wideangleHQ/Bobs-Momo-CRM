'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/features/analytics/report-frame';
import { adminKeys, createCategory, listCategories } from '@/features/admin/api';

export default function AdminCategoriesPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const query = useQuery({
    queryKey: adminKeys.categories(),
    queryFn: listCategories,
    staleTime: 5 * 60 * 1000,
  });

  const create = useMutation({
    mutationFn: () => createCategory({ name: name.trim() }),
    onSuccess: () => {
      setName('');
      void queryClient.invalidateQueries({ queryKey: adminKeys.categories() });
    },
  });

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Item categories"
        description="How the item master and the consumption report group things"
      />

      {can('inventory.category.manage') ? (
        <Card className="p-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim().length < 2) return;
              create.mutate();
            }}
          >
            <div className="min-w-0 flex-1">
              <Label htmlFor="category-name">New category</Label>
              <Input
                id="category-name"
                className="min-h-[44px]"
                placeholder="Vegetables"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" className="min-h-[44px]" disabled={create.isPending}>
              {create.isPending ? 'Adding' : 'Add'}
            </Button>
          </form>
          {create.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(create.error)}
            </p>
          ) : null}
        </Card>
      ) : null}

      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Every inventory item belongs to a category, so add the first one before adding items."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {query.data.data.map((category) => (
            <li key={category.id} className="flex items-center justify-between px-3 py-3">
              <span className="text-text">{category.name}</span>
              <span className="text-sm text-text-muted">
                {category.itemCount === undefined
                  ? ''
                  : `${category.itemCount} item${category.itemCount === 1 ? '' : 's'}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
