'use client';

/**
 * Last resort: the root layout itself failed, so there is no shell, no theme
 * and no component library to lean on. Everything here is inline and
 * self-contained on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, sans-serif',
          background: '#faf9f7',
          color: '#1c1917',
        }}
      >
        <div style={{ maxWidth: '22rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', margin: '0 0 8px' }}>The app did not start</h1>
          <p style={{ fontSize: '0.875rem', color: '#57534e', margin: '0 0 20px' }}>
            Nothing you entered was lost. Try again, and tell your manager if it keeps
            happening.
          </p>
          {error.digest ? (
            <p style={{ fontSize: '0.75rem', color: '#78716c', margin: '0 0 20px' }}>
              Reference {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              minHeight: '48px',
              padding: '0 24px',
              borderRadius: '8px',
              border: 0,
              background: '#b45309',
              color: '#fff',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
