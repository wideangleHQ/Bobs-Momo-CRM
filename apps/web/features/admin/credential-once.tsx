'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ProvisionedCredential } from './api';

// Most staff here have no email address, so the manager reads this out loud or
// writes it down. The server hashes it and never returns it again, so the panel
// says so plainly instead of implying it can be looked up later.
export function CredentialOnce({
  credential,
  onDone,
}: {
  credential: ProvisionedCredential;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <Card className="border-warning/40 bg-warning-bg p-4">
      <h2 className="text-base font-semibold text-warning">
        Temporary password for {credential.username}
      </h2>
      <p className="mt-1 text-sm text-warning">
        This is the only time it is shown. It is stored hashed, so nobody, including the owner, can
        read it back. Write it down or send it now.
      </p>

      <p className="mt-3 select-all break-all rounded-md border border-warning/40 bg-surface px-3 py-3 font-mono text-lg text-text">
        {credential.temporaryPassword}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" className="min-h-[44px]" onClick={() => void copy()}>
          {copied === 'done' ? 'Copied' : 'Copy password'}
        </Button>
        <Button type="button" variant="secondary" className="min-h-[44px]" onClick={onDone}>
          I have saved it
        </Button>
      </div>

      {copied === 'failed' ? (
        <p role="alert" className="mt-2 text-sm text-warning">
          The browser blocked the copy. Select the text above and copy it by hand.
        </p>
      ) : null}

      <p className="mt-3 text-sm text-warning">
        {credential.username} must change this at first sign in.
      </p>
    </Card>
  );
}
