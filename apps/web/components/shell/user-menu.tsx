'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function UserMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Account, ${user.fullName}`}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white transition-all duration-150 hover:bg-red-700 hover:ring-2 hover:ring-red-500 hover:ring-offset-2 select-none cursor-pointer"
      >
        {initials(user.fullName)}
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="Account">
        <div className="space-y-4 p-2">
          <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-red-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                {initials(user.fullName)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{user.fullName}</p>
                <p className="text-xs font-medium text-zinc-500 truncate">{user.username}</p>
              </div>
            </div>
            <div className="inline-flex items-center rounded-md bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-700 uppercase tracking-wider">
              {user.roleKey.replace(/_/g, ' ')}
            </div>
          </div>
          <Button
            variant="secondary"
            fullWidth
            size="lg"
            pending={pending}
            onClick={() => {
              setPending(true);
              void logout().finally(() => setPending(false));
            }}
          >
            <Icon name="logout" className="h-5 w-5" />
            Sign out
          </Button>
        </div>
      </Sheet>
    </>
  );
}

