'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The access token lives in memory, so only the browser knows whether there is
 * a session. This route waits for the boot refresh and then sends the user on.
 */
export default function Home() {
  const router = useRouter();
  const { user, loading, mustReset } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (mustReset) router.replace('/change-password');
    else router.replace('/dashboard');
  }, [user, loading, mustReset, router]);

  return (
    <div className="mx-auto w-full max-w-md space-y-3 p-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
