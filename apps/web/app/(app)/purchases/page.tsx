'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';

const LINKS: { href: string; label: string; blurb: string; permission: string }[] = [
  {
    href: '/purchases/records/new',
    label: 'Record a purchase',
    blurb: 'Turn the vendor bill in front of you into data',
    permission: 'purchase.record.create',
  },
  {
    href: '/purchases/requests',
    label: 'Purchase requests',
    blurb: 'What the kitchen and store asked for',
    permission: 'purchase.request.read',
  },
  {
    href: '/purchases/records',
    label: 'Purchase records',
    blurb: 'Find a past bill, or void one',
    permission: 'purchase.record.read',
  },
  {
    href: '/purchases/price-trends',
    label: 'Prices',
    blurb: 'What an item costs now and what it cost before',
    permission: 'purchase.price_history.read',
  },
  {
    href: '/vendors',
    label: 'Vendors',
    blurb: 'Suppliers and the items they sell you',
    permission: 'vendor.vendor.read',
  },
];

export default function PurchaseHomePage() {
  const can = useCan();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <PageHeader title="Purchase" description="Requests, bills and what things cost." />
      <nav className="flex flex-col gap-3">
        {LINKS.filter((l) => can(l.permission)).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-[64px] flex-col justify-center rounded-lg border border-border bg-surface px-4 py-3"
          >
            <span className="text-base font-medium text-text">{l.label}</span>
            <span className="text-sm text-text-muted">{l.blurb}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
