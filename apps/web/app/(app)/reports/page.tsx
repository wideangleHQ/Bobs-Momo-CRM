'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';

const REPORTS = [
  {
    href: '/reports/sales',
    permission: 'analytics.sales.read',
    title: 'Sales',
    description: 'Net sales by day and outlet, with the payment mix and day on day comparisons.',
  },
  {
    href: '/reports/consumption',
    permission: 'analytics.consumption.read',
    title: 'Consumption',
    description: 'What was issued and wasted per item, in the item’s own unit.',
  },
  {
    href: '/reports/wastage',
    permission: 'analytics.waste.read',
    title: 'Wastage',
    description: 'What is being thrown away, grouped by item, category or reason.',
  },
  {
    href: '/reports/performance',
    permission: 'analytics.performance.read',
    title: 'Employee performance',
    description: 'Task completion, punctuality and attendance consistency per person.',
  },
  {
    href: '/reports/price-history',
    permission: 'purchase.price_history.read',
    title: 'Price trend',
    description: 'How the price paid for an item has moved, per vendor.',
  },
  {
    href: '/reports/pnl',
    permission: 'analytics.pnl.read',
    title: 'Gross margin',
    description: 'Net sales less recorded purchases. An approximation, not an accounting P&L.',
  },
] as const;

export default function ReportsIndexPage() {
  const can = useCan();
  const visible = REPORTS.filter((report) => can(report.permission));

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Reports" description="Pick a report" />

      {visible.length === 0 ? (
        <EmptyState
          title="No reports for your role"
          description="Reports are limited by what your role can read. Ask the owner if you need one of them."
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((report) => (
            <li key={report.href}>
              <Link href={report.href} className="block">
                <Card className="min-h-[44px] p-4 hover:border-primary">
                  <h2 className="font-semibold text-text">{report.title}</h2>
                  <p className="mt-1 text-sm text-text-muted">{report.description}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
