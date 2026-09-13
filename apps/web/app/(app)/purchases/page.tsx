'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';
import { Icon } from '@/components/ui/icons';

interface PurchaseActionCardProps {
  title: string;
  description: string;
  href: string;
  icon: string;
  badge?: string;
  primary?: boolean;
  accentColor?: 'red' | 'emerald' | 'blue' | 'amber' | 'zinc';
}

function PurchaseActionCard({
  title,
  description,
  href,
  icon,
  badge,
  primary = false,
  accentColor = 'zinc',
}: PurchaseActionCardProps) {
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
        <span>Open section</span>
        <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

export default function PurchaseHomePage() {
  const can = useCan();

  return (
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-100">
        <PageHeader
          title="Procurement & Purchases"
          description="Manage vendor invoices, purchase orders, requisitions, and historical cost trends."
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

      {/* ── ACTION CARDS GRID ──────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Record New Stock / Purchase */}
        {(can('purchase.record.create') || can('inventory.transaction.create')) && (
          <PurchaseActionCard
            title="Record New Stock"
            description="Process a delivery slip or vendor bill directly: creates purchase and updates stock atomically."
            href="/inventory/receive"
            icon="package"
            badge="Primary"
            primary={true}
            accentColor="red"
          />
        )}

        {/* Purchase Invoices / Records */}
        {can('purchase.record.read') && (
          <PurchaseActionCard
            title="Purchase Invoices"
            description="Browse all historical purchase records, verified vendor bills, attachments, and line items."
            href="/purchases/records"
            icon="receipt"
            accentColor="emerald"
          />
        )}

        {/* Purchase Requests */}
        {can('purchase.request.read') && (
          <PurchaseActionCard
            title="Purchase Requests"
            description="Requisitions and item requests submitted by kitchen and store managers awaiting approval."
            href="/purchases/requests"
            icon="inbox"
            accentColor="amber"
          />
        )}

        {/* Price Trends */}
        {can('purchase.price_history.read') && (
          <PurchaseActionCard
            title="Price Trends & History"
            description="Track ingredient and packaging unit price fluctuations across suppliers over time."
            href="/purchases/price-trends"
            icon="trendUp"
            accentColor="blue"
          />
        )}

        {/* Suppliers & Vendors */}
        {can('vendor.vendor.read') && (
          <PurchaseActionCard
            title="Suppliers & Vendors"
            description="Manage vendor catalog, contact information, GSTIN details, and credit terms."
            href="/vendors"
            icon="building"
            accentColor="zinc"
          />
        )}
      </div>
    </div>
  );
}
