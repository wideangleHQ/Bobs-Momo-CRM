'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCan } from '@/lib/auth';
import { NAV_ITEMS } from '@/lib/nav.config';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

interface SearchItem {
  label: string;
  href: string;
  icon: string;
  section: string;
  permission: string;
  keywords?: string[];
}

const EXTRA_ITEMS: SearchItem[] = [
  // Inventory sub-pages
  { label: 'Inventory Items', href: '/inventory/items', icon: 'box', section: 'Inventory', permission: 'inventory.stock.read', keywords: ['stock', 'items', 'products', 'sku'] },
  { label: 'Stock Entry', href: '/inventory/entry', icon: 'box', section: 'Inventory', permission: 'inventory.stock.read', keywords: ['stock in', 'add stock', 'entry'] },
  { label: 'Stock Levels', href: '/inventory/stock', icon: 'box', section: 'Inventory', permission: 'inventory.stock.read', keywords: ['quantity', 'levels', 'available'] },
  { label: 'Stock History', href: '/inventory/history', icon: 'box', section: 'Inventory', permission: 'inventory.stock.read', keywords: ['audit', 'logs', 'ledger'] },
  // Purchases sub-pages
  { label: 'Purchase Requests', href: '/purchases/requests', icon: 'cart', section: 'Purchases', permission: 'purchase.request.read', keywords: ['pr', 'procurement', 'orders'] },
  { label: 'New Purchase Request', href: '/purchases/requests/new', icon: 'cart', section: 'Purchases', permission: 'purchase.request.read', keywords: ['create pr', 'buy'] },
  { label: 'Purchase Records', href: '/purchases/records', icon: 'cart', section: 'Purchases', permission: 'purchase.request.read', keywords: ['po', 'invoices', 'bills'] },
  { label: 'New Purchase Record', href: '/purchases/records/new', icon: 'cart', section: 'Purchases', permission: 'purchase.request.read', keywords: ['add bill', 'record purchase'] },
  { label: 'Price Trends', href: '/purchases/price-trends', icon: 'cart', section: 'Purchases', permission: 'purchase.request.read', keywords: ['costs', 'inflation', 'price chart'] },
  // Sales
  { label: 'Sales Entry', href: '/sales/entry', icon: 'rupee', section: 'Sales', permission: 'sales.entry.read', keywords: ['pos', 'billing', 'revenue', 'money'] },
  // Reports sub-pages
  { label: 'Sales Reports', href: '/reports/sales', icon: 'chart', section: 'Reports', permission: 'analytics.dashboard.read', keywords: ['revenue', 'sales chart', 'analytics'] },
  { label: 'P&L Report', href: '/reports/pnl', icon: 'chart', section: 'Reports', permission: 'analytics.dashboard.read', keywords: ['profit', 'loss', 'income', 'financials'] },
  { label: 'Wastage Report', href: '/reports/wastage', icon: 'chart', section: 'Reports', permission: 'analytics.dashboard.read', keywords: ['waste', 'loss', 'scrap', 'spoilage'] },
  { label: 'Consumption Report', href: '/reports/consumption', icon: 'chart', section: 'Reports', permission: 'analytics.dashboard.read', keywords: ['usage', 'raw materials', 'ingredients'] },
  { label: 'Performance Report', href: '/reports/performance', icon: 'chart', section: 'Reports', permission: 'analytics.dashboard.read', keywords: ['kpi', 'target', 'store metric'] },
  { label: 'Price History', href: '/reports/price-history', icon: 'chart', section: 'Reports', permission: 'analytics.dashboard.read', keywords: ['rates', 'inflation'] },
  // Attendance
  { label: 'Attendance Board', href: '/attendance/board', icon: 'clock', section: 'Attendance', permission: 'workforce.attendance.punch_self', keywords: ['punch in', 'punch out', 'clock in', 'staff'] },
  { label: 'Attendance History', href: '/attendance/history', icon: 'clock', section: 'Attendance', permission: 'workforce.attendance.punch_self', keywords: ['timesheet', 'punches', 'logs'] },
  // Shifts
  { label: 'Shifts Roster', href: '/shifts/roster', icon: 'calendar', section: 'Shifts', permission: 'workforce.shift.read', keywords: ['schedule', 'timetable', 'roster'] },
  // Leave
  { label: 'Leave Approvals', href: '/leave/approvals', icon: 'leave', section: 'Leave', permission: 'workforce.leave.read', keywords: ['vacation', 'time off', 'requests'] },
  { label: 'New Leave Request', href: '/leave/new', icon: 'leave', section: 'Leave', permission: 'workforce.leave.read', keywords: ['apply leave', 'vacation'] },
  // Employees
  { label: 'Employee Directory', href: '/employees', icon: 'users', section: 'Employees', permission: 'workforce.employee.read', keywords: ['staff', 'team', 'workers'] },
  { label: 'New Employee', href: '/employees/new', icon: 'users', section: 'Employees', permission: 'workforce.employee.read', keywords: ['add staff', 'hire', 'onboard'] },
  // Tasks
  { label: 'Tasks Board', href: '/tasks/board', icon: 'tasks', section: 'Tasks', permission: 'task.task.read', keywords: ['todo', 'kanban', 'work'] },
  { label: 'Task Templates', href: '/tasks/templates', icon: 'tasks', section: 'Tasks', permission: 'task.task.read', keywords: ['checklist', 'sop'] },
  { label: 'Recurring Tasks', href: '/tasks/recurrences', icon: 'tasks', section: 'Tasks', permission: 'task.task.read', keywords: ['daily tasks', 'routines'] },
  { label: 'New Task', href: '/tasks/new', icon: 'tasks', section: 'Tasks', permission: 'task.task.read', keywords: ['create task', 'assign'] },
  // Vendors
  { label: 'New Vendor', href: '/vendors/new', icon: 'truck', section: 'Vendors', permission: 'vendor.vendor.read', keywords: ['supplier', 'distributor'] },
  // Admin
  { label: 'Manage Users', href: '/admin/users', icon: 'settings', section: 'Admin', permission: 'admin.user.read', keywords: ['permissions', 'roles', 'accounts'] },
  { label: 'Manage Outlets', href: '/admin/outlets', icon: 'settings', section: 'Admin', permission: 'admin.user.read', keywords: ['stores', 'branches', 'locations'] },
  { label: 'Audit Log', href: '/admin/audit-log', icon: 'settings', section: 'Admin', permission: 'admin.user.read', keywords: ['activity', 'security', 'logs'] },
  // Notifications
  { label: 'Notification Preferences', href: '/notifications/preferences', icon: 'bell', section: 'Notifications', permission: 'notification.own.read', keywords: ['alerts', 'push', 'email'] },
];

const ALL_ITEMS: SearchItem[] = [
  ...NAV_ITEMS.map((i) => ({ ...i, section: 'Navigation' })),
  ...EXTRA_ITEMS,
];

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const can = useCan();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const allowed = useMemo(() => {
    return ALL_ITEMS.filter((item) => can(item.permission));
  }, [can]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allowed;

    return allowed
      .map((item) => {
        const labelLower = item.label.toLowerCase();
        const sectionLower = item.section.toLowerCase();
        const hrefLower = item.href.toLowerCase();
        const keywords = item.keywords || [];

        let score = 0;
        if (labelLower === q) score = 100;
        else if (labelLower.startsWith(q)) score = 80;
        else if (labelLower.includes(q)) score = 60;
        else if (keywords.some((k) => k.toLowerCase().startsWith(q))) score = 50;
        else if (keywords.some((k) => k.toLowerCase().includes(q))) score = 40;
        else if (sectionLower.includes(q)) score = 30;
        else if (hrefLower.includes(q)) score = 20;

        return { item, score };
      })
      .filter((res) => res.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((res) => res.item);
  }, [allowed, query]);

  const navigate = useCallback(
    (href: string) => {
      onClose();
      setQuery('');
      router.push(href);
    },
    [onClose, router],
  );

  // Focus input on open, reset state
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Reset cursor when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Escape key — window-level so it always works even if input loses focus
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const li = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    li?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search navigation"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] sm:pt-[14vh] px-4"
      onMouseDown={onClose}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity" />

      {/* Palette card */}
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-2xl transition-all select-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4">
          <Icon name="search" className="h-4 w-4 flex-shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, reports, and actions…"
            autoComplete="off"
            spellCheck={false}
            className="h-13 w-full bg-transparent text-[14.5px] font-normal text-zinc-800 placeholder:text-zinc-400 border-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none shadow-none"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const item = results[activeIndex];
                if (item) navigate(item.href);
              }
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors outline-none focus:outline-none focus-visible:outline-none"
              aria-label="Clear search"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:flex items-center rounded-md border border-zinc-200/80 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              Esc
            </kbd>
          )}
        </div>

        {/* Results list */}
        <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5 space-y-0.5">
          {results.length === 0 ? (
            <li className="px-4 py-10 text-center select-none">
              <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-50 border border-zinc-100 text-zinc-400">
                <Icon name="search" className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-zinc-700">No results found</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                No matches for &ldquo;{query}&rdquo;. Try another term.
              </p>
            </li>
          ) : (
            results.map((item, i) => {
              const active = i === activeIndex;
              return (
                <li key={`${item.href}-${i}`}>
                  <button
                    type="button"
                    data-active={active ? 'true' : 'false'}
                    onMouseDown={() => navigate(item.href)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-100 outline-none focus:outline-none focus-visible:outline-none ring-0',
                      active ? 'bg-zinc-100/90 text-zinc-900' : 'text-zinc-700 hover:bg-zinc-50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
                        active ? 'bg-white shadow-xs text-zinc-900' : 'bg-zinc-100/70 text-zinc-400 group-hover:text-zinc-600',
                      )}
                    >
                      <Icon name={item.icon} className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={cn('block truncate text-[13.5px]', active ? 'font-semibold text-zinc-900' : 'font-medium text-zinc-800')}>
                        {item.label}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-[11px] font-medium text-zinc-400 bg-zinc-100/70 px-2 py-0.5 rounded-md">
                      {item.section}
                    </span>
                    <span
                      className={cn(
                        'text-zinc-400 text-xs font-mono pl-0.5 transition-opacity',
                        active ? 'opacity-100 text-zinc-500' : 'opacity-0',
                      )}
                    >
                      ↵
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {/* Footer hints */}
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/50 px-4 py-2 text-[11px] text-zinc-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-zinc-200/80 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 shadow-2xs">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-zinc-200/80 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 shadow-2xs">↵</kbd>
              open
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-200/80 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 shadow-2xs">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}

