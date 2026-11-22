'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { displayUsername } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { createEmployee, listEmployees, type CreatedEmployee } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { CredentialRow } from '@/features/workforce/credential-row';
import { EmployeeForm, outletOptionsFrom } from '@/features/workforce/employee-form';
import { roleLabel } from '@/features/workforce/roles';

export default function NewEmployeePage() {
  const router = useRouter();
  const can = useCan();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedEmployee | null>(null);

  // The key belongs to one submission. A retry of the same body (a double tap, a
  // lost response) reuses it and replays the original result; a changed body gets
  // a new key, so an edited form is a new employee, not a conflict.
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const roster = useQuery({
    queryKey: workforceKeys.employees({ pageSize: 100, forOptions: true }),
    queryFn: () => listEmployees({ pageSize: 100 }),
    staleTime: 5 * 60_000,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      const serialised = JSON.stringify(body);
      if (attempt.current?.body !== serialised) {
        attempt.current = { key: crypto.randomUUID(), body: serialised };
      }
      return createEmployee(body, attempt.current.key);
    },
    onSuccess: (result) => {
      attempt.current = null;
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      setCreated(result);
    },
    onError: (err: Error) => setProblem(err.message),
  });

  if (!can('workforce.employee.create')) {
    return (
      <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
        <PageHeader title="Add employee" />
        <Card className="p-4 text-sm">
          Only the Owner can add employees. Ask the Owner to create the account.
        </Card>
      </div>
    );
  }

  if (created) {
    const { employee, account } = created;
    return (
      <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
        <PageHeader title="Employee created" subtitle={`${employee.fullName} · ${employee.employeeCode}`} />
        <Card className="space-y-4 p-4" role="status">
          <p className="text-sm">
            {employee.fullName} now has their own login ({roleLabel(account.roleKey)}). Give them
            these two details. This is the only time the initial password is shown here.
          </p>
          <CredentialRow label="Username" value={displayUsername(account.username)} />
          <CredentialRow label="Initial password" value={account.initialPassword} />
          <p className="text-sm text-text-muted">
            They sign in on the employee page and must choose a new password straight away. The
            initial password stops working once they do.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/employees/${employee.id}`}>
              <Button type="button" className="min-h-[48px]">
                View employee
              </Button>
            </Link>
            <Button
              type="button"
              variant="secondary"
              className="min-h-[48px]"
              onClick={() => {
                setCreated(null);
                setProblem(null);
              }}
            >
              Add another
            </Button>
            <Link href="/employees">
              <Button type="button" variant="secondary" className="min-h-[48px]">
                Back to the roster
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
      <PageHeader title="Add employee" subtitle="Creates the employee and their own login" />
      {roster.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : roster.isError ? (
        <ErrorState
          title="Could not load outlets"
          message={(roster.error as Error).message}
          onRetry={() => void roster.refetch()}
        />
      ) : (
        <EmployeeForm
          outlets={outletOptionsFrom(roster.data?.data ?? [])}
          pending={create.isPending}
          problem={problem}
          onSubmit={(body) => {
            setProblem(null);
            create.mutate(body);
          }}
          onCancel={() => router.push('/employees')}
        />
      )}
    </div>
  );
}
