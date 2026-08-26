'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { createEmployee, listEmployees } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { EmployeeForm, outletOptionsFrom } from '@/features/workforce/employee-form';

export default function NewEmployeePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: workforceKeys.employees({ pageSize: 100, forOptions: true }),
    queryFn: () => listEmployees({ pageSize: 100 }),
    staleTime: 5 * 60_000,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => createEmployee(body),
    onSuccess: (employee) => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      router.push(`/employees/${employee.id}`);
    },
    onError: (err: Error) => setProblem(err.message),
  });

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
      <PageHeader title="Add employee" subtitle="Onboard somebody onto the roster" />
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
