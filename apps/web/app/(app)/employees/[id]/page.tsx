'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { exitEmployeeSchema, toBusinessDate } from '@bobs-momo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/auth';
import { longDate } from '@/lib/format';
import { exitEmployee, getEmployee, listEmployees, updateEmployee } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { EmployeeForm, outletOptionsFrom } from '@/features/workforce/employee-form';
import { SalaryPanel } from '@/features/workforce/salary-panel';

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const can = useCan();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [exitedOn, setExitedOn] = useState(() => toBusinessDate());
  const [exitReason, setExitReason] = useState('');

  const employee = useQuery({
    queryKey: workforceKeys.employee(id),
    queryFn: () => getEmployee(id),
  });

  const roster = useQuery({
    queryKey: workforceKeys.employees({ pageSize: 100, forOptions: true }),
    queryFn: () => listEmployees({ pageSize: 100 }),
    staleTime: 5 * 60_000,
    enabled: editing,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['employees'] });
  };

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateEmployee(id, body),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const exit = useMutation({
    mutationFn: (body: unknown) => exitEmployee(id, body),
    onSuccess: () => {
      setExiting(false);
      invalidate();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  if (employee.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (employee.isError || !employee.data) {
    return (
      <div className="p-4">
        <ErrorState
          title="Could not load this employee"
          message={(employee.error as Error | null)?.message ?? 'That employee does not exist'}
          onRetry={() => void employee.refetch()}
        />
      </div>
    );
  }

  const e = employee.data;

  const submitExit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    const parsed = exitEmployeeSchema.safeParse({ exitedOn, reason: exitReason.trim() });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    exit.mutate(parsed.data);
  };

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 p-4">
      <PageHeader
        title={e.fullName}
        subtitle={`${e.employeeCode}${e.designation ? ` · ${e.designation}` : ''}`}
        action={<Badge variant={e.status === 'EXITED' ? 'neutral' : 'success'}>{e.status}</Badge>}
      />

      {editing ? (
        roster.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <EmployeeForm
            outlets={outletOptionsFrom(roster.data?.data ?? [e])}
            employee={e}
            pending={update.isPending}
            problem={problem}
            onSubmit={(body) => {
              setProblem(null);
              update.mutate(body);
            }}
            onCancel={() => setEditing(false)}
          />
        )
      ) : (
        <Card className="space-y-2 p-4">
          <Field label="Phone" value={e.phone} />
          <Field label="Outlet" value={e.outletCode} />
          <Field label="Department" value={e.departmentName ?? 'None'} />
          <Field label="Joined" value={longDate(`${e.joinedOn}T00:00:00.000Z`)} />
          {e.exitedOn ? (
            <Field label="Exited" value={longDate(`${e.exitedOn}T00:00:00.000Z`)} />
          ) : null}
          <Field label="Login" value={e.user ? `${e.user.username} (${e.user.roleKey})` : 'None'} />
          {can('workforce.employee.update') && e.status !== 'EXITED' ? (
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px]"
                onClick={() => setEditing(true)}
              >
                Edit profile
              </Button>
              <Button
                type="button"
                variant="danger"
                className="min-h-[44px]"
                onClick={() => setExiting(true)}
              >
                Record exit
              </Button>
            </div>
          ) : null}
        </Card>
      )}

      <SalaryPanel employeeId={id} />

      <div className="flex flex-wrap gap-3">
        <Link className="text-sm underline" href={`/attendance/history?employeeId=${id}`}>
          Attendance history
        </Link>
        <Link className="text-sm underline" href="/employees">
          Back to the roster
        </Link>
      </div>

      {exiting ? (
        <Dialog open onClose={() => setExiting(false)} title={`Record ${e.fullName}'s exit`}>
          <form className="space-y-4" onSubmit={submitExit}>
            <p className="text-sm text-text-muted">
              This closes their login and ends every live session. Attendance, leave and task
              history stay on file.
            </p>
            <div className="space-y-1">
              <Label htmlFor="exitedOn">Last working day</Label>
              <Input
                id="exitedOn"
                type="date"
                value={exitedOn}
                onChange={(ev) => setExitedOn(ev.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exitReason">Reason, required</Label>
              <Textarea
                id="exitReason"
                rows={3}
                value={exitReason}
                onChange={(ev) => setExitReason(ev.target.value)}
              />
            </div>
            {problem ? (
              <p role="alert" className="text-sm text-danger">
                {problem}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] flex-1"
                onClick={() => setExiting(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                className="min-h-[44px] flex-1"
                disabled={exit.isPending}
              >
                {exit.isPending ? 'Saving...' : 'Record exit'}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1 last:border-b-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
