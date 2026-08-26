import type { Metadata, Viewport } from 'next';
import './globals.css';
import { QueryProvider } from '@/lib/query';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/toast';

export const metadata: Metadata = {
  title: "Bob's Momo",
  description: "Operations, workforce and inventory for Bob's Momo",
};

// Staff use this on a 360px phone in a kitchen. Mobile is the primary target.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#FAFAF9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <QueryProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
