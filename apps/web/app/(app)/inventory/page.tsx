'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage, listStock } from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { Icon } from '@/components/ui/icons';

interface ActionCardProps {
  title: string;
  description: string;
  href: string;
  icon: string;
  badge?: string;
  primary?: boolean;
  accentColor?: 'red' | 'emerald' | 'blue' | 'amber' | 'purple' | 'zinc';
}

function ActionCard({
  title,
  description,
  href,
  icon,
  badge,
  primary = false,
  accentColor = 'zinc',
}: ActionCardProps) {
  const colorMap = {
    red: {
      bg: 'bg-red-50',
      text: 'text-red-600',
      border: 'hover:border-red-300',
      badge: 'bg-red-100 text-red-700',
    },
    emerald: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-600',
      border: 'hover:border-emerald-300',
      badge: 'bg-emerald-100 text-emerald-700',
    },
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      border: 'hover:border-blue-300',
      badge: 'bg-blue-100 text-blue-700',
    },
    amber: {
      bg: 'bg-amber-50',
      text: 'text-amber-600',
      border: 'hover:border-amber-300',
      badge: 'bg-amber-100 text-amber-700',
    },
    purple: {
      bg: 'bg-purple-50',
      text: 'text-purple-600',
      border: 'hover:border-purple-300',
      badge: 'bg-purple-100 text-purple-700',
    },
    zinc: {
      bg: 'bg-zinc-100',
      text: 'text-zinc-700',
      border: 'hover:border-zinc-300',
      badge: 'bg-zinc-200 text-zinc-700',
    },
  };

  const scheme = colorMap[accentColor];

  return (
    <Link
      href={href}
      className={`group relative flex flex-col justify-between rounded-2xl border p-5 sm:p-6 transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 hover:-translate-y-0.5 hover:shadow-md ${
        primary
          ? 'border-red-200 bg-gradient-to-br from-red-50/70 via-white to-white hover:border-red-300 shadow-sm'
          : `border-zinc-200/80 bg-white ${scheme.border} shadow-sm`
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div
            className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${
              primary ? 'bg-red-600 text-white shadow-sm' : `${scheme.bg} ${scheme.text}`
            }`}
          >
            <Icon name={icon} className="h-6 w-6" />
          </div>
          {badge ? (
            <span className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold ${scheme.badge}`}>
              {badge}
            </span>
          ) : (
            <Icon
              name="arrowUpRight"
              className="h-4 w-4 text-zinc-300 group-hover:text-zinc-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          )}
        </div>

        <h3 className="text-base sm:text-lg font-bold text-zinc-900 group-hover:text-red-600 transition-colors">
          {title}
        </h3>
        <p className="text-xs sm:text-sm text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">{description}</p>
      </div>

      <div className="mt-6 pt-3 border-t border-zinc-100 flex items-center gap-1.5 text-xs font-semibold text-zinc-400 group-hover:text-zinc-800 transition-colors">
        <span>Open workflow</span>
        <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

export default function InventoryHomePage() {
  const can = useCan();
  const params = { belowReorder: true, pageSize: 100 };
  const low = useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => listStock(params),
    enabled: can('inventory.stock.read'),
  });

  const lowCount = low.data?.data?.length ?? 0;

  return (
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-100">
        <PageHeader
          title="Inventory Management"
          description="Track incoming stock, stock balances, movements, and item definitions."
        />

        {(can('purchase.record.create') || can('inventory.transaction.create')) && (
          <Link
            href="/inventory/receive"
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 flex-shrink-0"
          >
            <Icon name="plus" className="h-4 w-4" />
            <span>Record New Stock</span>
          </Link>
        )}
      </div>

      {/* ── LOW STOCK TELEMETRY BANNER ────────────────────── */}
      {can('inventory.stock.read') && (
        <>
          {low.isPending ? (
            <Skeleton className="h-24 w-full rounded-2xl" />
          ) : low.isError ? (
            <ErrorState message={errorMessage(low.error)} onRetry={() => void low.refetch()} />
          ) : (
            <Link
              href="/inventory/stock?low=1"
              className={`group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border p-5 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                lowCount > 0
                  ? 'border-amber-200 bg-gradient-to-r from-amber-50/80 to-white'
                  : 'border-zinc-200/80 bg-white'
              }`}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    lowCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-600'
                  }`}
                >
                  <Icon name={lowCount > 0 ? 'warning' : 'check'} className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-2xl font-extrabold tracking-tight tabular-nums ${
                        lowCount > 0 ? 'text-amber-900' : 'text-zinc-900'
                      }`}
                    >
                      {lowCount}
                    </span>
                    <span className="text-sm font-bold text-zinc-800">
                      {lowCount === 1 ? 'Item below reorder level' : 'Items below reorder level'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-500 mt-0.5">
                    {lowCount > 0
                      ? 'Stock levels are running low. Click to view Restock checklist.'
                      : 'All tracked item balances are within safe operating levels.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs sm:text-sm font-semibold text-red-600 group-hover:text-red-700 transition-colors">
                <span>View Low Stock</span>
                <Icon name="chevronRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          )}
        </>
      )}

      {/* ── ACTION WORKFLOW CARDS GRID ─────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Inventory Workflows</h2>
          <p className="text-xs text-zinc-400">Manage daily stock receipts, adjustments & catalogs</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Record New Stock */}
          {(can('purchase.record.create') || can('inventory.transaction.create')) && (
            <ActionCard
              title="Record New Stock"
              description="Unified receiving workflow: add supplier, invoice, missing items, and update stock atomically."
              href="/inventory/receive"
              icon="package"
              badge="Primary"
              primary={true}
              accentColor="red"
            />
          )}

          {/* Check Stock */}
          {can('inventory.stock.read') && (
            <ActionCard
              title="Check Stock"
              description="Inspect live on-hand quantities, reorder thresholds, and filter by category or outlet."
              href="/inventory/stock"
              icon="warehouse"
              accentColor="amber"
            />
          )}

          {/* Stock History */}
          {can('inventory.transaction.read') && (
            <ActionCard
              title="Stock History"
              description="Audit log of every stock movement: received purchases, kitchen issues, and wastage entries."
              href="/inventory/history"
              icon="history"
              accentColor="blue"
            />
          )}

          {/* Other Stock Movements */}
          {can('inventory.transaction.create') && (
            <ActionCard
              title="Stock Movements & Wastage"
              description="Record kitchen consumption, register spoilage wastage, or fix inventory count differences."
              href="/inventory/entry"
              icon="sparkles"
              accentColor="purple"
            />
          )}

          {/* Manage Items */}
          {can('inventory.item.read') && (
            <ActionCard
              title="Manage Items"
              description="Master inventory catalog: configure item names, categories, measurement units & reorder levels."
              href="/inventory/items"
              icon="layers"
              accentColor="emerald"
            />
          )}

          {/* Suppliers */}
          {can('vendor.read') && (
            <ActionCard
              title="Suppliers & Vendors"
              description="Directory of approved food, packaging & kitchen suppliers with GSTIN and contact details."
              href="/vendors"
              icon="building"
              accentColor="zinc"
            />
          )}
        </div>
      </section>
    </div>
  );
}
