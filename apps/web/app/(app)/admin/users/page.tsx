'use client';

import { useState } from 'react';
import Link from 'next/link';
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
import { Pagination } from '@/components/ui/pagination';
import { useCan } from '@/lib/auth';
import { relative } from '@/lib/format';
import { errorMessage } from '@/features/analytics/report-frame';
import {
  adminKeys,
  listUsers,
  resetUserPassword,
  updateUser,
  type AdminUser,
  type ProvisionedCredential,
} from '@/features/admin/api';
import { CredentialOnce } from '@/features/admin/credential-once';

export default function AdminUsersPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [credential, setCredential] = useState<ProvisionedCredential | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');

  const filters = { q: q.trim() || undefined, page, pageSize: 25 };
  const query = useQuery({
    queryKey: adminKeys.users(filters),
    queryFn: () => listUsers(filters),
    staleTime: 60 * 1000,
  });

  const reset = useMutation({
    mutationFn: (input: { userId: string; reason: string }) =>
      resetUserPassword(input.userId, input.reason),
    onSuccess: (result) => {
      setCredential(result);
      setResetting(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: adminKeys.all() });
    },
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      updateUser(input.id, { status: input.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all() });
    },
  });

  const total = query.data?.meta.total ?? 0;
  const pageSize = query.data?.meta.pageSize ?? 25;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="User accounts" description="Logins, roles and password resets" />

      {credential ? (
        <CredentialOnce credential={credential} onDone={() => setCredential(null)} />
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="user-search">Search</Label>
          <Input
            id="user-search"
            className="min-h-[44px]"
            placeholder="Username or name"
            value={q}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {can('admin.user.create') ? (
          <Link href="/admin/users/new">
            <Button type="button" className="min-h-[44px]">
              Create user
            </Button>
          </Link>
        ) : null}
      </div>

      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          title="No user accounts match"
          description="Clear the search, or create the account from the button above. Every person who signs in needs one."
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((user) => {
            const disabled = user.status === 'DISABLED' || user.isActive === false;
            return (
              <li key={user.id}>
                <Card className="p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-text">{user.username}</p>
                      <p className="text-sm text-text-muted">
                        {user.fullName ?? 'No employee linked'} ·{' '}
                        {user.roleKey.toLowerCase().replaceAll('_', ' ')}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {user.lastLoginAt
                          ? `Last signed in ${relative(user.lastLoginAt)}`
                          : 'Has never signed in'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {disabled ? <Badge>Disabled</Badge> : <Badge>Active</Badge>}
                      {user.mustReset ? <Badge>Must reset password</Badge> : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {can('auth.password.reset_other') ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-[44px]"
                        onClick={() => {
                          setResetting(user);
                          setReason('');
                        }}
                      >
                        Reset password
                      </Button>
                    ) : null}
                    {can('admin.user.disable') ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-[44px]"
                        disabled={toggle.isPending}
                        onClick={() =>
                          toggle.mutate({ id: user.id, status: disabled ? 'ACTIVE' : 'DISABLED' })
                        }
                      >
                        {disabled ? 'Re-enable' : 'Disable'}
                      </Button>
                    ) : null}
                  </div>

                  {resetting?.id === user.id ? (
                    <form
                      className="mt-3 border-t border-border pt-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (reason.trim().length < 3) return;
                        reset.mutate({ userId: user.id, reason: reason.trim() });
                      }}
                    >
                      <Label htmlFor={`reason-${user.id}`}>Why are you resetting this?</Label>
                      <Input
                        id={`reason-${user.id}`}
                        className="min-h-[44px]"
                        placeholder="Forgot password, phone lost, and so on"
                        value={reason}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setReason(e.target.value)
                        }
                      />
                      <p className="mt-1 text-xs text-text-muted">
                        The reason is written to the audit log. Every signed-in session for this
                        user ends.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="submit"
                          className="min-h-[44px]"
                          disabled={reset.isPending || reason.trim().length < 3}
                        >
                          {reset.isPending ? 'Resetting' : 'Reset and show password'}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-[44px]"
                          onClick={() => setResetting(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                      {reset.isError ? (
                        <p role="alert" className="mt-2 text-sm text-danger">
                          {errorMessage(reset.error)}
                        </p>
                      ) : null}
                    </form>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {toggle.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(toggle.error)}
        </p>
      ) : null}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
      />
    </div>
  );
}
