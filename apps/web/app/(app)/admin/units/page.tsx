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
import { adminKeys, createUnit, listUnits } from '@/features/admin/api';

export default function AdminUnitsPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const query = useQuery({
    queryKey: adminKeys.units(),
    queryFn: listUnits,
    staleTime: 5 * 60 * 1000,
  });

  const create = useMutation({
    mutationFn: () => createUnit({ code: code.trim().toUpperCase(), name: name.trim() }),
    onSuccess: () => {
      setCode('');
      setName('');
      void queryClient.invalidateQueries({ queryKey: adminKeys.units() });
    },
  });

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Units" description="What quantities are measured in" />

      <p className="text-sm text-text-muted">
        The system holds no conversion factors, so a quantity in kilograms is never added to a
        quantity in pieces. A unit cannot be renamed or removed once the ledger has used it.
      </p>

      {can('inventory.unit.manage') ? (
        <Card className="p-3">
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim() === '' || name.trim().length < 2) return;
              create.mutate();
            }}
          >
            <div>
              <Label htmlFor="unit-code">Code</Label>
              <Input
                id="unit-code"
                className="min-h-[44px]"
                placeholder="KG"
                maxLength={6}
                value={code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="unit-name">Name</Label>
              <Input
                id="unit-name"
                className="min-h-[44px]"
                placeholder="Kilogram"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="min-h-[44px]" disabled={create.isPending}>
                {create.isPending ? 'Adding' : 'Add unit'}
              </Button>
            </div>
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
          title="No units yet"
          description="Units are normally seeded. Add kilogram, litre and piece before adding items."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {query.data.data.map((unit) => (
            <li key={unit.id} className="flex items-center justify-between px-3 py-3">
              <span className="font-medium text-text">{unit.code}</span>
              <span className="text-sm text-text-muted">{unit.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
