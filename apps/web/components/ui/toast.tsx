'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icons';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastRow {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastApi {
  (message: string, tone?: ToastTone): void;
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

interface ToastValue {
  toast: ToastApi;
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
  dismiss(id: number): void;
}

const TONES: Record<ToastTone, string> = {
  success: 'border-success bg-success-bg text-success',
  error: 'border-danger bg-danger-bg text-danger',
  warning: 'border-warning bg-warning-bg text-warning',
  info: 'border-info bg-info-bg text-info',
};

const ToastContext = createContext<ToastValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<ToastRow[]>([]);

  const dismiss = useCallback((id: number) => {
    setRows((r) => r.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++nextId;
      setRows((r) => [...r, { id, message, tone }]);
      // Long enough to read a two line API message on a phone.
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const value = useMemo<ToastValue>(() => {
    const toast = Object.assign(
      (message: string, tone?: ToastTone) => push(message, tone),
      {
        success: (m: string) => push(m, 'success'),
        error: (m: string) => push(m, 'error'),
        warning: (m: string) => push(m, 'warning'),
        info: (m: string) => push(m, 'info'),
      },
    ) as ToastApi;
    return {
      toast,
      success: toast.success,
      error: toast.error,
      warning: toast.warning,
      info: toast.info,
      dismiss,
    };
  }, [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {rows.map((r) => (
          <div
            key={r.id}
            role={r.tone === 'error' ? 'alert' : undefined}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border p-3 text-sm shadow-xl',
              TONES[r.tone],
            )}
          >
            <span className="flex-1">{r.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(r.id)}
              className="-m-1 shrink-0 p-1"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
