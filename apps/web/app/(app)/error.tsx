'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui';

/**
 * Route-segment boundary for everything inside the shell.
 *
 * Query errors are handled per screen, but a render-time throw is not: a map
 * over an undefined field, an unexpected enum in a badge lookup. Without this
 * Next falls back to its own screen, which is unstyled, has no navigation and
 * no way back. On a phone mid-shift the only exit is killing the tab. Here the
 * bottom nav survives, so the cook can go somewhere else and keep working.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('screen failed to render', error);
  }, [error]);

  return (
    <div className="p-4">
      <ErrorState
        title="This screen did not load"
        message="Something on this page broke. The rest of the app still works."
        requestId={error.digest}
        onRetry={reset}
      />
    </div>
  );
}
