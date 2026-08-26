import type { ReactNode } from 'react';

/** No nav, no outlet switcher. One centred card and nothing to tap by mistake. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-text">Bob&apos;s Momo</h1>
        {children}
      </div>
    </div>
  );
}
