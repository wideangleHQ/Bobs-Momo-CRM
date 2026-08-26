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
        className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-bg text-sm font-semibold text-primary"
      >
        {initials(user.fullName)}
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="Account">
        <div className="space-y-4 p-2">
          <div>
            <p className="text-base font-semibold text-text">{user.fullName}</p>
            <p className="text-sm text-text-muted">{user.username}</p>
            <p className="mt-1 text-xs font-medium text-text-muted">
              {user.roleKey.replace(/_/g, ' ').toLowerCase()}
            </p>
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
