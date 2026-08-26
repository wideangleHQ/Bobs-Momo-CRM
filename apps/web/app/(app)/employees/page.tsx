'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { listEmployees, type EmploymentStatus } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';

export default function EmployeesPage() {
  const can = useCan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EmploymentStatus | ''>('');
  const [page, setPage] = useState(1);

  const query = {
    page,
    pageSize: 25,
    search: search.trim().length >= 2 ? search.trim() : undefined,
    status: status === '' ? undefined : status,
  };
  const employees = useQuery({
    queryKey: workforceKeys.employees(query),
    queryFn: () => listEmployees(query),
  });

  const rows = employees.data?.data ?? [];
  const meta = employees.data?.meta;

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Employees"
        subtitle={meta ? `${meta.total} on the roster` : undefined}
        action={
          can('workforce.employee.create') ? (
            <Link href="/employees/new">
              <Button type="button" className="min-h-[44px]">
                Add employee
              </Button>
            </Link>
          ) : null
        }
      />

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <Input
          aria-label="Search by name, code or phone"
          placeholder="Search by name, code or phone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Employment status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as EmploymentStatus | '');
            setPage(1);
          }}
        >
          <option value="">Working and on notice</option>
          <option value="ACTIVE">Active</option>
          <option value="ON_NOTICE">On notice</option>
          <option value="EXITED">Exited</option>
        </Select>
      </Card>

      {employees.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : employees.isError ? (
        <ErrorState
          title="Could not load the roster"
          message={(employees.error as Error).message}
          onRetry={() => void employees.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nobody matches this search"
          description="Clear the search box, or add the person from the Add employee button."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id}>
              <Link href={`/employees/${e.id}`}>
                <Card className="flex items-start justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{e.fullName}</p>
                    <p className="text-sm text-text-muted">
                      {e.employeeCode}
                      {e.designation ? ` · ${e.designation}` : ''}
                    </p>
                    <p className="text-sm text-text-muted">
                      {e.outletCode}
                      {e.departmentName ? ` · ${e.departmentName}` : ''}
                    </p>
                  </div>
                  <Badge variant={e.status === 'EXITED' ? 'neutral' : 'success'}>{e.status}</Badge>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-text-muted">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
