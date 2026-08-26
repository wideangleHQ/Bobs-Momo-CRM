import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Bob's Momo",
  description: 'Operations, workforce and inventory for Bob’s Momo',
};

// Staff use this on a 360px phone in a kitchen. Mobile is the primary target.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
