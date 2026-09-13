'use client';

import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';
import { Icon } from '@/components/ui/icons';

const REPORTS = [
  {
    href: '/reports/sales',
    permission: 'analytics.sales.read',
    title: 'Sales & Revenue',
    description: 'Net sales by day and outlet, payment method mix (cash/UPI/card), and day-on-day growth metrics.',
    icon: 'currencyRupee',
    accentColor: 'red' as const,
  },
  {
    href: '/reports/pnl',
    permission: 'analytics.pnl.read',
    title: 'Gross Margin (P&L)',
    description: 'Operational net sales less recorded purchases and ingredient costs. Real-time margin telemetry.',
    icon: 'chart',
    accentColor: 'amber' as const,
  },
  {
    href: '/reports/consumption',
    permission: 'analytics.consumption.read',
    title: 'Stock Consumption',
    description: 'Track ingredient usage issued to kitchen and spoilage per item in its own unit of measure.',
    icon: 'warehouse',
    accentColor: 'blue' as const,
  },
  {
    href: '/reports/wastage',
    permission: 'analytics.waste.read',
    title: 'Wastage & Spoilage',
    description: 'Detailed analysis of items thrown away, grouped by reason, category, and rupee loss value.',
    icon: 'package',
    accentColor: 'purple' as const,
  },
  {
    href: '/reports/performance',
    permission: 'analytics.performance.read',
    title: 'Employee Performance',
    description: 'Staff punctuality, punch consistency, task checklist completions, and shift attendance rates.',
    icon: 'users',
    accentColor: 'emerald' as const,
  },
  {
    href: '/reports/price-history',
    permission: 'purchase.price_history.read',
    title: 'Price Trend History',
    description: 'Historical ingredient and packaging unit purchase price fluctuations across suppliers.',
    icon: 'trendUp',
    accentColor: 'zinc' as const,
  },
] as const;

export default function ReportsIndexPage() {
  const can = useCan();
  const visible = REPORTS.filter((report) => can(report.permission));

  const colorMap = {
    red: { bg: 'bg-red-50', text: 'text-red-600', border: 'hover:border-red-300' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'hover:border-emerald-300' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'hover:border-blue-300' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'hover:border-amber-300' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'hover:border-purple-300' },
    zinc: { bg: 'bg-zinc-100', text: 'text-zinc-700', border: 'hover:border-zinc-300' },
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="pb-2 border-b border-zinc-100">
        <PageHeader
          title="Reports & Analytics"
          description="Business intelligence, sales trends, consumption reports, and staff performance telemetry."
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No reports available for your role"
          description="Reports access is configured based on role permissions. Contact your administrator if you need access."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {visible.map((report) => {
            const scheme = colorMap[report.accentColor];
            return (
              <Link
                key={report.href}
                href={report.href}
                className={`group relative flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md ${scheme.border} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div
                      className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${scheme.bg} ${scheme.text}`}
                    >
                      <Icon name={report.icon} className="h-6 w-6" />
                    </div>
                    <Icon
                      name="arrowUpRight"
                      className="h-4 w-4 text-zinc-300 group-hover:text-zinc-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-zinc-900 group-hover:text-red-600 transition-colors">
                    {report.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">
                    {report.description}
                  </p>
                </div>

                <div className="mt-6 pt-3 border-t border-zinc-100 flex items-center gap-1.5 text-xs font-semibold text-zinc-400 group-hover:text-zinc-800 transition-colors">
                  <span>View report</span>
                  <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
