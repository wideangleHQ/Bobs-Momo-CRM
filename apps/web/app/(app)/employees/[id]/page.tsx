'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { displayUsername, exitEmployeeSchema, toBusinessDate } from '@bobs-momo/shared';
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
import {
  exitEmployee,
  getEmployee,
  listEmployees,
  resetEmployeePassword,
  setEligibility,
  updateEmployee,
} from '@/features/workforce/api';
import { CredentialRow } from '@/features/workforce/credential-row';
import { roleLabel } from '@/features/workforce/roles';
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
  const [resetting, setResetting] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [resetResult, setResetResult] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const [eligibilityOpen, setEligibilityOpen] = useState(false);
  const [eligibilityReason, setEligibilityReason] = useState('');

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

  const reset = useMutation({
    mutationFn: (userId: string) => resetEmployeePassword(userId, resetReason.trim()),
    onSuccess: (res) => {
      setResetResult({ username: res.username, temporaryPassword: res.temporaryPassword });
      invalidate();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const eligibility = useMutation({
    mutationFn: (eligible: boolean) =>
      setEligibility(id, { eligible, reason: eligibilityReason.trim() }),
    onSuccess: () => {
      setEligibilityOpen(false);
      setEligibilityReason('');
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
          {e.user ? (
            <>
              <Field label="Username" value={displayUsername(e.user.username)} />
              <Field label="Login role" value={roleLabel(e.user.roleKey)} />
              <Field label="Account" value={e.user.status.toLowerCase()} />
              <div className="flex items-baseline justify-between gap-3 border-b py-1">
                <span className="text-sm text-text-muted">Password</span>
                {e.user.mustReset ? (
                  <Badge variant="warning">Change pending at next sign-in</Badge>
                ) : (
                  <span className="text-right font-medium">Chosen by the employee</span>
                )}
              </div>
              <Field
                label="Last sign-in"
                value={e.user.lastLoginAt ? longDate(e.user.lastLoginAt) : 'Never'}
              />
            </>
          ) : (
            <Field label="Login" value="None" />
          )}
          <Field
            label="Attendance and tasks"
            value={e.eligibleForWorkflows ? 'Included' : 'Left out by the Owner'}
          />
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
                variant="secondary"
                className="min-h-[44px]"
                disabled={update.isPending}
                onClick={() => {
                  setProblem(null);
                  update.mutate({ status: e.status === 'ON_NOTICE' ? 'ACTIVE' : 'ON_NOTICE' });
                }}
              >
                {e.status === 'ON_NOTICE' ? 'Mark as active' : 'Mark as on notice'}
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
          {e.user && e.status !== 'EXITED' && can('auth.password.reset_other') ? (
            <div className="pt-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px]"
                onClick={() => {
                  setProblem(null);
                  setResetResult(null);
                  setResetReason('');
                  setResetting(true);
                }}
              >
                Reset password
              </Button>
            </div>
          ) : null}
          {can('workforce.employee.account') ? (
            <div className="pt-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px]"
                onClick={() => {
                  setProblem(null);
                  setEligibilityReason('');
                  setEligibilityOpen(true);
                }}
              >
                {e.eligibleForWorkflows
                  ? 'Leave out of attendance and tasks'
                  : 'Include in attendance and tasks'}
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

      {resetting && e.user ? (
        <Dialog
          open
          onClose={() => setResetting(false)}
          title={resetResult ? 'New temporary password' : `Reset ${e.fullName}'s password?`}
        >
          {resetResult ? (
            <div className="space-y-4" role="status">
              <p className="text-sm">
                Give this to {e.fullName} now. It is not shown again and is not stored. They must
                choose a new password when they next sign in.
              </p>
              <CredentialRow label="Username" value={displayUsername(resetResult.username)} />
              <CredentialRow label="Temporary password" value={resetResult.temporaryPassword} />
              <Button type="button" className="min-h-[44px] w-full" onClick={() => setResetting(false)}>
                Done
              </Button>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                setProblem(null);
                if (resetReason.trim().length < 3) {
                  setProblem('Say why, in at least three characters. It is kept in the audit log.');
                  return;
                }
                if (e.user) reset.mutate(e.user.id);
              }}
            >
              <p className="text-sm text-text-muted">
                This ends every sign-in they have open and replaces their password with a temporary
                one. You will not be able to see their current password.
              </p>
              <div className="space-y-1">
                <Label htmlFor="resetReason">Why, required</Label>
                <Textarea
                  id="resetReason"
                  rows={2}
                  maxLength={200}
                  value={resetReason}
                  onChange={(ev) => setResetReason(ev.target.value)}
                />
              </div>
              {problem ? (
                <p role="alert" className="text-sm text-danger">
                  {problem}
                </p>
              ) : null}
              <div className="flex gap-3">
                <Button type="button" variant="secondary" className="min-h-[44px] flex-1" onClick={() => setResetting(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" className="min-h-[44px] flex-1" disabled={reset.isPending}>
                  {reset.isPending ? 'Resetting...' : 'Reset password'}
                </Button>
              </div>
            </form>
          )}
        </Dialog>
      ) : null}

      {eligibilityOpen ? (
        <Dialog
          open
          onClose={() => setEligibilityOpen(false)}
          title={e.eligibleForWorkflows ? 'Leave out of attendance and tasks?' : 'Include again?'}
        >
          <form
            className="space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              setProblem(null);
              if (eligibilityReason.trim().length < 3) {
                setProblem('Say why, in at least three characters. It is kept in the audit log.');
                return;
              }
              eligibility.mutate(!e.eligibleForWorkflows);
            }}
          >
            <p className="text-sm text-text-muted">
              {e.eligibleForWorkflows
                ? 'They will no longer appear on the attendance board, in task assignment or in employee reports, and cannot punch in. Nothing is deleted and their history stays on file.'
                : 'They will appear on the attendance board, in task assignment and in employee reports again.'}
            </p>
            <div className="space-y-1">
              <Label htmlFor="eligibilityReason">Why, required</Label>
              <Textarea
                id="eligibilityReason"
                rows={2}
                maxLength={280}
                value={eligibilityReason}
                onChange={(ev) => setEligibilityReason(ev.target.value)}
              />
            </div>
            {problem ? (
              <p role="alert" className="text-sm text-danger">
                {problem}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="min-h-[44px] flex-1" onClick={() => setEligibilityOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="min-h-[44px] flex-1" disabled={eligibility.isPending}>
                {eligibility.isPending ? 'Saving...' : 'Confirm'}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

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
