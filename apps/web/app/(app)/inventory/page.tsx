'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage, listStock } from '@/features/inventory/api';
import { inventoryKeys } from '@/features/inventory/keys';
import { Icon } from '@/components/ui/icons';

export default function InventoryHomePage() {
  const router = useRouter();
  const can = useCan();
  const params = { belowReorder: true, pageSize: 100 };
  const low = useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () => listStock(params),
    enabled: can('inventory.stock.read'),
  });

  const lowCount = low.data?.data?.length ?? 0;

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8">
      {/* ── 1. PAGE HEADER ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Compact back button + Title block */}
        <div className="flex items-start gap-3 sm:gap-4">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back to previous page"
            title="Go back"
            className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E8E5E2] bg-white text-[#151515] transition-all duration-150 hover:bg-[#FAF9F7] hover:border-[#D4CFC9] hover:text-[#E60012] cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E60012]"
          >
            <Icon name="arrowLeft" className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-[#151515] leading-tight">
              Inventory Management
            </h1>
            <p className="mt-1 text-xs sm:text-[14px] text-[#686868]">
              Track incoming stock, stock balances, movements, and item definitions.
            </p>
          </div>
        </div>

        {/* Right: Primary Call to Action */}
        {(can('purchase.record.create') || can('inventory.transaction.create')) && (
          <Link
            href="/inventory/receive"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E60012] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-[#C90010] active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E60012] shrink-0 self-start sm:self-auto"
          >
            <Icon name="plus" className="h-4 w-4 shrink-0" />
            <span>Record New Stock</span>
          </Link>
        )}
      </div>

      {/* ── 2. LOW-STOCK ALERT BANNER ───────────────────────── */}
      {can('inventory.stock.read') && (
        <>
          {low.isPending ? (
            <Skeleton className="h-20 sm:h-24 w-full rounded-xl" />
          ) : low.isError ? (
            <ErrorState message={errorMessage(low.error)} onRetry={() => void low.refetch()} />
          ) : lowCount > 0 ? (
            <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-[#F4D675] bg-[#FFF8E7] p-5 sm:p-6 transition-all duration-200 shadow-xs">
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-amber-100/90 text-amber-800 border border-amber-200/80 flex items-center justify-center shrink-0">
                  <Icon name="warning" className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base sm:text-lg font-extrabold tracking-tight text-amber-950">
                      {lowCount} {lowCount === 1 ? 'Item Below Reorder Level' : 'Items Below Reorder Level'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-amber-900/80 mt-0.5">
                    Stock levels are running low. Review items that need replenishment.
                  </p>
                </div>
              </div>

              <Link
                href="/inventory/stock?low=1"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300/80 bg-white px-4 py-2 text-xs sm:text-sm font-bold text-[#E60012] shadow-xs hover:bg-red-50 hover:border-red-200 transition-colors shrink-0 self-start sm:self-auto"
              >
                <span>View Low Stock</span>
                <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
              </Link>
            </div>
          ) : (
            <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-[#E8E5E2] bg-white p-5 sm:p-6 shadow-xs">
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center shrink-0">
                  <Icon name="check" className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-[#151515]">
                    All Items Within Safe Reorder Thresholds
                  </h3>
                  <p className="text-xs sm:text-sm text-[#686868] mt-0.5">
                    Zero items currently below minimum operating stock levels across active outlets.
                  </p>
                </div>
              </div>

              <Link
                href="/inventory/stock"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E8E5E2] bg-[#FAF9F7] px-4 py-2 text-xs sm:text-sm font-semibold text-[#151515] hover:bg-white hover:border-[#D4CFC9] transition-colors shrink-0 self-start sm:self-auto"
              >
                <span>Check Live Stock</span>
                <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0 text-[#686868]" />
              </Link>
            </div>
          )}
        </>
      )}

      {/* ── 3. INVENTORY WORKFLOW SECTION (ASYMMETRIC GRID) ─── */}
      <section className="space-y-4">
        {/* Section Heading */}
        <div>
          <h2 className="text-xs sm:text-[13px] font-extrabold uppercase tracking-wider text-[#151515]">
            Inventory Workflows
          </h2>
          <p className="text-xs sm:text-sm text-[#686868] mt-0.5">
            Manage daily stock receipts, adjustments and catalogs.
          </p>
        </div>

        {/* 12-Column Asymmetric Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
          {/* ── ROW 1: Card 1 (Record New Stock - 58-60% width = col-span-7) ── */}
          {(can('purchase.record.create') || can('inventory.transaction.create')) && (
            <Link
              href="/inventory/receive"
              className="group relative flex flex-col justify-between rounded-xl border border-red-200/90 bg-gradient-to-br from-[#FFF1F2]/60 via-white to-white p-6 sm:p-7 shadow-xs hover:border-[#E60012]/50 hover:shadow-md transition-all duration-200 col-span-12 lg:col-span-7"
            >
              <div>
                {/* Header row: Red Icon + Badge */}
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="h-12 w-12 rounded-xl bg-[#FFF1F2] text-[#E60012] border border-red-200/60 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-xs">
                    <Icon name="package" className="h-6 w-6 text-[#E60012]" />
                  </div>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-[#FFF1F2] text-[#E60012] border border-red-200/80">
                    Primary Workflow
                  </span>
                </div>

                {/* Title & Description */}
                <h3 className="text-[20px] sm:text-[22px] font-extrabold text-[#151515] tracking-tight group-hover:text-[#E60012] transition-colors">
                  Record New Stock
                </h3>
                <p className="text-[14px] sm:text-[15px] text-[#686868] mt-2 leading-relaxed max-w-xl">
                  Unified receiving workflow: add supplier, invoice, missing items, and update stock atomically with live rate and batch tracking.
                </p>

                {/* Workflow Feature Badges */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-white border border-[#E8E5E2] text-[#151515]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#E60012]" />
                    Invoice & PO Match
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-white border border-[#E8E5E2] text-[#151515]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#E60012]" />
                    Auto-updates Live Stock
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-white border border-[#E8E5E2] text-[#151515]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#E60012]" />
                    Zero Loss Ledger
                  </span>
                </div>
              </div>

              {/* Bottom Action Footer */}
              <div className="mt-6 pt-4 border-t border-red-100/70 flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold text-[#E60012] group-hover:text-[#C90010] inline-flex items-center gap-1.5">
                  Launch Receiving Workflow
                  <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
                <span className="text-xs font-medium text-[#686868] hidden sm:inline">
                  Step-by-step assistant
                </span>
              </div>
            </Link>
          )}

          {/* ── ROW 1: Card 2 (Check Stock - 40-42% width = col-span-5) ── */}
          {can('inventory.stock.read') && (
            <Link
              href="/inventory/stock"
              className="group relative flex flex-col justify-between rounded-xl border border-[#E8E5E2] bg-white p-6 sm:p-7 shadow-xs hover:border-red-200 hover:shadow-md transition-all duration-200 col-span-12 lg:col-span-5"
            >
              <div>
                {/* Header row: Red Icon + Arrow */}
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="h-12 w-12 rounded-xl bg-[#FFF1F2] text-[#E60012] border border-red-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-xs">
                    <Icon name="warehouse" className="h-6 w-6 text-[#E60012]" />
                  </div>
                  <Icon
                    name="arrowUpRight"
                    className="h-4 w-4 text-[#686868] group-hover:text-[#E60012] transition-colors"
                  />
                </div>

                {/* Title & Description */}
                <h3 className="text-[19px] sm:text-[21px] font-bold text-[#151515] tracking-tight group-hover:text-[#E60012] transition-colors">
                  Check Stock
                </h3>
                <p className="text-[14px] text-[#686868] mt-2 leading-relaxed">
                  Inspect live on-hand quantities, reorder thresholds, and filter by product category or outlet balance in real time.
                </p>

                {/* Quick Info Tags */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[#FAF9F7] border border-[#E8E5E2] text-[#686868]">
                    Live Balances
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[#FAF9F7] border border-[#E8E5E2] text-[#686868]">
                    Reorder Thresholds
                  </span>
                </div>
              </div>

              {/* Bottom Action Footer */}
              <div className="mt-6 pt-4 border-t border-[#E8E5E2]/60 flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold text-[#E60012] group-hover:text-[#C90010] inline-flex items-center gap-1.5">
                  Inspect Stock Balances
                  <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          )}

          {/* ── ROW 2: Card 3 (Stock History - 40-42% width = col-span-5) ── */}
          {can('inventory.transaction.read') && (
            <Link
              href="/inventory/history"
              className="group relative flex flex-col justify-between rounded-xl border border-[#E8E5E2] bg-white p-6 shadow-xs hover:border-red-200 hover:shadow-md transition-all duration-200 col-span-12 md:col-span-6 lg:col-span-5"
            >
              <div>
                {/* Header row: Red Icon + Arrow */}
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="h-11 w-11 rounded-xl bg-[#FFF1F2] text-[#E60012] border border-red-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-xs">
                    <Icon name="history" className="h-5 w-5 text-[#E60012]" />
                  </div>
                  <Icon
                    name="arrowUpRight"
                    className="h-4 w-4 text-[#686868] group-hover:text-[#E60012] transition-colors"
                  />
                </div>

                <h3 className="text-[18px] sm:text-[20px] font-bold text-[#151515] tracking-tight group-hover:text-[#E60012] transition-colors">
                  Stock History
                </h3>
                <p className="text-[14px] text-[#686868] mt-2 leading-relaxed">
                  Audit log of every stock movement: received purchases, kitchen issues, adjustments, and wastage logs.
                </p>
              </div>

              <div className="mt-6 pt-3 border-t border-[#E8E5E2]/60 flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold text-[#E60012] group-hover:text-[#C90010] inline-flex items-center gap-1.5">
                  View Movement Ledger
                  <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          )}

          {/* ── ROW 2: Card 4 (Stock Movements & Wastage - 34-36% width = col-span-4) ── */}
          {can('inventory.transaction.create') && (
            <Link
              href="/inventory/entry"
              className="group relative flex flex-col justify-between rounded-xl border border-[#E8E5E2] bg-white p-6 shadow-xs hover:border-red-200 hover:shadow-md transition-all duration-200 col-span-12 md:col-span-6 lg:col-span-4"
            >
              <div>
                {/* Header row: Red Icon + Arrow */}
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="h-11 w-11 rounded-xl bg-[#FFF1F2] text-[#E60012] border border-red-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-xs">
                    <Icon name="sparkles" className="h-5 w-5 text-[#E60012]" />
                  </div>
                  <Icon
                    name="arrowUpRight"
                    className="h-4 w-4 text-[#686868] group-hover:text-[#E60012] transition-colors"
                  />
                </div>

                <h3 className="text-[18px] sm:text-[20px] font-bold text-[#151515] tracking-tight group-hover:text-[#E60012] transition-colors">
                  Stock Movements & Wastage
                </h3>
                <p className="text-[14px] text-[#686868] mt-2 leading-relaxed">
                  Record kitchen consumption, register spoilage wastage, or log physical inventory count differences.
                </p>
              </div>

              <div className="mt-6 pt-3 border-t border-[#E8E5E2]/60 flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold text-[#E60012] group-hover:text-[#C90010] inline-flex items-center gap-1.5">
                  Record Entry
                  <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          )}

          {/* ── ROW 2: Card 5 (Manage Items - 22-26% width = col-span-3) ── */}
          {can('inventory.item.read') && (
            <Link
              href="/inventory/items"
              className="group relative flex flex-col justify-between rounded-xl border border-[#E8E5E2] bg-white p-6 shadow-xs hover:border-red-200 hover:shadow-md transition-all duration-200 col-span-12 md:col-span-12 lg:col-span-3"
            >
              <div>
                {/* Header row: Red Icon + Arrow */}
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="h-11 w-11 rounded-xl bg-[#FFF1F2] text-[#E60012] border border-red-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-xs">
                    <Icon name="layers" className="h-5 w-5 text-[#E60012]" />
                  </div>
                  <Icon
                    name="arrowUpRight"
                    className="h-4 w-4 text-[#686868] group-hover:text-[#E60012] transition-colors"
                  />
                </div>

                <h3 className="text-[18px] sm:text-[20px] font-bold text-[#151515] tracking-tight group-hover:text-[#E60012] transition-colors">
                  Manage Items
                </h3>
                <p className="text-[14px] text-[#686868] mt-2 leading-relaxed">
                  Master inventory catalog: configure item names, categories, measurement units & reorder triggers.
                </p>
              </div>

              <div className="mt-6 pt-3 border-t border-[#E8E5E2]/60 flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold text-[#E60012] group-hover:text-[#C90010] inline-flex items-center gap-1.5">
                  Open Catalog
                  <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          )}
        </div>

        {/* ── 4. COMPLEMENTARY UTILITY: SUPPLIERS & VENDORS ───── */}
        {can('vendor.read') && (
          <div className="pt-2">
            <Link
              href="/vendors"
              className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-[#E8E5E2] bg-white p-4 sm:p-5 shadow-xs hover:border-red-200 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-center gap-3.5">
                <div className="h-10 w-10 rounded-xl bg-[#FFF1F2] text-[#E60012] border border-red-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
                  <Icon name="building" className="h-5 w-5 text-[#E60012]" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-[#151515] group-hover:text-[#E60012] transition-colors">
                    Suppliers & Approved Vendors
                  </h4>
                  <p className="text-xs text-[#686868]">
                    Directory of approved food, packaging & kitchen suppliers with GSTIN, terms, and contact details.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#E60012] group-hover:text-[#C90010] shrink-0 self-start sm:self-auto">
                <span>Manage Vendor Directory</span>
                <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
