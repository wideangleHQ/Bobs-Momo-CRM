'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
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
import {
  adminKeys,
  createDepartment,
  createOutlet,
  listDepartments,
  listOutlets,
} from '@/features/admin/api';

export default function AdminOutletsPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [departmentName, setDepartmentName] = useState<Record<string, string>>({});

  const outlets = useQuery({
    queryKey: adminKeys.outlets(),
    queryFn: listOutlets,
    staleTime: 5 * 60 * 1000,
  });

  const departments = useQuery({
    queryKey: adminKeys.departments(),
    queryFn: listDepartments,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const addOutlet = useMutation({
    mutationFn: () =>
      createOutlet({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(address.trim() === '' ? {} : { address: address.trim() }),
      }),
    onSuccess: () => {
      setCode('');
      setName('');
      setAddress('');
      void queryClient.invalidateQueries({ queryKey: adminKeys.all() });
    },
  });

  const addDepartment = useMutation({
    mutationFn: (input: { outletId: string; name: string }) =>
      createDepartment(input.outletId, { name: input.name }),
    onSuccess: (_result, input) => {
      setDepartmentName((prev) => ({ ...prev, [input.outletId]: '' }));
      void queryClient.invalidateQueries({ queryKey: adminKeys.departments() });
    },
  });

  const canManage = can('admin.outlet.manage');
  const canManageDepartments = can('admin.department.manage');

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Outlets and departments"
        description="The structure every scope rule, roster and broadcast reads from"
      />

      {canManage ? (
        <Card className="p-3">
          <h2 className="text-sm font-semibold text-text">Add an outlet</h2>
          <form
            className="mt-2 grid gap-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim() === '' || name.trim() === '') return;
              addOutlet.mutate();
            }}
          >
            <div>
              <Label htmlFor="outlet-code">Code</Label>
              <Input
                id="outlet-code"
                className="min-h-[44px]"
                placeholder="BM-SAHEED"
                value={code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="outlet-name">Name</Label>
              <Input
                id="outlet-name"
                className="min-h-[44px]"
                placeholder="Saheed Nagar"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="outlet-address">Address</Label>
              <Input
                id="outlet-address"
                className="min-h-[44px]"
                value={address}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddress(e.target.value)}
              />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" className="min-h-[44px]" disabled={addOutlet.isPending}>
                {addOutlet.isPending ? 'Adding' : 'Add outlet'}
              </Button>
            </div>
          </form>
          {addOutlet.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(addOutlet.error)}
            </p>
          ) : null}
        </Card>
      ) : null}

      {outlets.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : outlets.isError ? (
        <ErrorState message={errorMessage(outlets.error)} onRetry={() => void outlets.refetch()} />
      ) : outlets.data.data.length === 0 ? (
        <EmptyState
          title="No outlets yet"
          description="Nothing in the system can be recorded until there is at least one outlet. Add one with the form above."
        />
      ) : (
        <ul className="space-y-3">
          {outlets.data.data.map((outlet) => {
            const own = (departments.data?.data ?? []).filter(
              (d) => d.outletId === outlet.id || d.outletCode === outlet.code,
            );
            return (
              <li key={outlet.id}>
                <Card className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-text">
                        {outlet.code} {outlet.name}
                      </p>
                      {outlet.address ? (
                        <p className="text-sm text-text-muted">{outlet.address}</p>
                      ) : null}
                    </div>
                    {outlet.isActive === false ? <Badge>Inactive</Badge> : <Badge>Active</Badge>}
                  </div>

                  <h3 className="mt-3 text-sm font-semibold text-text">Departments</h3>
                  {own.length === 0 ? (
                    <p className="mt-1 text-sm text-text-muted">
                      No departments here yet. A department is what a kitchen manager broadcasts to.
                    </p>
                  ) : (
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {own.map((department) => (
                        <li key={department.id}>
                          <Badge>{department.name}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canManageDepartments ? (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = (departmentName[outlet.id] ?? '').trim();
                        if (value === '') return;
                        addDepartment.mutate({ outletId: outlet.id, name: value });
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={`dept-${outlet.id}`}>New department</Label>
                        <Input
                          id={`dept-${outlet.id}`}
                          className="min-h-[44px]"
                          placeholder="Kitchen"
                          value={departmentName[outlet.id] ?? ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setDepartmentName((prev) => ({ ...prev, [outlet.id]: e.target.value }))
                          }
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="secondary"
                        className="min-h-[44px]"
                        disabled={addDepartment.isPending}
                      >
                        Add
                      </Button>
                    </form>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {addDepartment.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(addDepartment.error)}
        </p>
      ) : null}
    </div>
  );
}
