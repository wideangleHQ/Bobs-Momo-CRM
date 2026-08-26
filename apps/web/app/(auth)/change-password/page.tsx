'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldMessage } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';

const MIN_LENGTH = 10;

/**
 * Reachable while mustReset is true, which is the point: it is the only
 * endpoint a provisioned account is allowed to call, so it lives outside the
 * app shell and does its own session check.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, loading, mustReset, changePassword } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (done && !mustReset) router.replace('/dashboard');
  }, [done, mustReset, router]);

  if (loading || !user) {
    return (
      <Card>
        <CardBody className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardBody>
      </Card>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await changePassword(currentPassword, newPassword);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <h2 className="text-xl font-semibold text-text">Choose a new password</h2>
            <p className="mt-1 text-sm text-text-muted">
              {mustReset
                ? 'Your account still uses the password your manager set. Pick your own to carry on.'
                : 'Pick a password only you know.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="currentPassword" required>
              Current password
            </Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword" required>
              New password
            </Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              invalid={tooShort}
              aria-describedby="new-password-help"
            />
            <FieldMessage
              id="new-password-help"
              error={tooShort ? `Use at least ${MIN_LENGTH} characters` : undefined}
              hint={`At least ${MIN_LENGTH} characters. A short sentence works well.`}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm" required>
              Type it again
            </Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              invalid={mismatch}
              aria-describedby="confirm-help"
            />
            <FieldMessage
              id="confirm-help"
              error={mismatch ? 'The two passwords do not match' : undefined}
            />
          </div>

          <FieldMessage error={error ?? undefined} />

          <Button
            type="submit"
            size="lg"
            fullWidth
            pending={pending}
            disabled={
              currentPassword.length === 0 ||
              newPassword.length < MIN_LENGTH ||
              confirm !== newPassword
            }
          >
            Save and continue
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
