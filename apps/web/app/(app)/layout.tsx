'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { AppShell } from '@/components/shell/app-shell';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Client-side only, and not security. The API checks the permission key on
 * every request whatever the browser decided to render.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading, mustReset } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (mustReset) router.replace('/change-password');
  }, [user, loading, mustReset, router]);

  // A shell skeleton, not a login redirect: the boot refresh has not answered
  // yet and bouncing a signed-in user to /login on every reload is worse.
  if (loading || !user || mustReset) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-3 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
