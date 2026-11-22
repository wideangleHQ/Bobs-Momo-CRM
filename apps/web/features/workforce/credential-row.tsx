'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * A value somebody has to read out or copy once, with a copy button. The value is
 * selectable text, so a browser that blocks the clipboard still works.
 */
export function CredentialRow({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  };

  return (
    <div className="space-y-1">
      <p className="text-sm text-text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          data-testid={`credential-${label.toLowerCase().replace(/\s+/g, '-')}`}
          className="select-all rounded bg-[var(--color-surface-muted)] px-3 py-2 text-lg font-semibold tracking-wide"
        >
          {value}
        </code>
        <Button type="button" variant="secondary" className="min-h-[44px]" onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy it' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
