'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldMessage } from '@/components/ui/field';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, mustReset, login } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get('reason') === 'expired');
  }, []);

  useEffect(() => {
    if (!user) return;
    router.replace(mustReset ? '/change-password' : '/dashboard');
  }, [user, mustReset, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <Card className="w-full border-none shadow-2xl rounded-[15px] overflow-hidden bg-white/95 backdrop-blur-sm">
        {/* Top Navigation */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center">
          <Link href="/" className="text-xs font-semibold text-zinc-500 hover:text-black transition-colors flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back to Home page
          </Link>
        </div>

        <CardBody className="p-8 pb-10">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-6">
              <Image src="/assets/logo.png" alt="Bobs Momo Logo" width={140} height={48} className="object-contain" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-black mb-2">Welcome back</h1>
            <p className="text-sm text-zinc-500 font-medium">
              Don&apos;t have an account yet? <Link href="/signup" className="text-red-600 font-semibold hover:underline">Sign up</Link>
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {expired && !error ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs font-semibold text-red-800">
                Session expired. Please sign in again.
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-xs font-bold text-black">
                Name
              </Label>
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
                placeholder="e.g. John Doe"
                className="bg-zinc-50/50 border-zinc-200 focus:bg-white h-11"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-bold text-black">
                  Password
                </Label>
                <Link href="#" className="text-xs font-semibold text-zinc-600 hover:text-red-600 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  placeholder="Password"
                  className="bg-zinc-50/50 border-zinc-200 focus:bg-white h-11 pr-10"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-black" 
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <FieldMessage id="login-error" error={error ?? undefined} />

            <Button
              type="submit"
              size="lg"
              fullWidth
              pending={pending || (loading && !error)}
              disabled={identifier.trim().length === 0 || password.length === 0}
              className="mt-6 !bg-red-600 !hover:bg-red-700 text-white rounded-lg shadow-sm font-bold text-sm tracking-wide"
            >
              Log in
            </Button>
          </form>
        </CardBody>
      </Card>



      <div className="text-center mt-2 flex justify-center gap-3 text-[10px] font-medium text-white/50 lg:text-white/40">
        <span>© 2026 Bobs Momo CRM</span>
        <span>•</span>
        <span>All Rights Reserved</span>
        <span>•</span>
        <span>Version: 4.6.1</span>
      </div>
    </div>
  );
}

