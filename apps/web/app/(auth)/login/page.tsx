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

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, mustReset, login } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get('reason') === 'expired');
  }, []);

  useEffect(() => {
    if (!user) return;
    // change-password is the only endpoint a provisioned account can reach, so
    // the redirect happens here rather than after a bounce off the shell.
    router.replace(mustReset ? '/change-password' : '/dashboard');
  }, [user, mustReset, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      // The password stays in the field. Nothing is retyped after a failure.
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
            <h2 className="text-xl font-semibold text-text">Sign in</h2>
            <p className="mt-1 text-sm text-text-muted">
              Use the username your manager gave you.
            </p>
          </div>

          {expired && !error ? (
            <p className="rounded-md bg-warning-bg p-3 text-sm text-warning">
              You were signed out. Sign in again to continue.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="identifier">Username or phone</Label>
            <Input
              id="identifier"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              invalid={!!error}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>

          <FieldMessage id="login-error" error={error ?? undefined} />

          <Button
            type="submit"
            size="lg"
            fullWidth
            pending={pending || (loading && !error)}
            disabled={identifier.trim().length === 0 || password.length === 0}
          >
            Sign in
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
