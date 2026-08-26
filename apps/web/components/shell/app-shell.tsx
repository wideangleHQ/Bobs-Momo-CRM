'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { NAV_ITEMS, type NavItem } from '@/lib/nav.config';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icons';
import { Sheet } from '@/components/ui/sheet';
import { NotificationBell } from './notification-bell';
import { OutletSwitcher } from './outlet-switcher';
import { UserMenu } from './user-menu';

// Four destinations plus More. A fifth tab on a 360px screen leaves 72px per
// cell, which is below a comfortable thumb.
const TAB_COUNT = 4;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const can = useCan();
  const [moreOpen, setMoreOpen] = useState(false);

  const items = useMemo(() => NAV_ITEMS.filter((i) => can(i.permission)), [can]);
  const tabs = items.slice(0, TAB_COUNT);

  return (
    <div className="min-h-dvh bg-bg">
      <Sidebar items={items} pathname={pathname} />

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
          <Link href="/dashboard" className="mr-auto text-base font-semibold text-text lg:hidden">
            Bob&apos;s Momo
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <OutletSwitcher />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl pb-20 lg:pb-8">{children}</main>
      </div>

      <BottomNav tabs={tabs} pathname={pathname} onMore={() => setMoreOpen(true)} />

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="Go to">
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-md px-3 text-base',
                  isActive(pathname, item.href) ? 'text-primary' : 'text-text',
                )}
              >
                <Icon name={item.icon} className="h-6 w-6" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

function Sidebar({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-14 items-center border-b border-border px-4 text-base font-semibold text-text">
        Bob&apos;s Momo
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium',
                    active
                      ? 'bg-primary-bg text-primary'
                      : 'text-text-muted hover:bg-surface-muted hover:text-text',
                  )}
                >
                  <Icon name={item.icon} className="h-5 w-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function BottomNav({
  tabs,
  pathname,
  onMore,
}: {
  tabs: NavItem[];
  pathname: string;
  onMore: () => void;
}) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface shadow-bar lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium',
              active ? 'text-primary' : 'text-text-muted',
            )}
          >
            <Icon name={item.icon} className="h-6 w-6" />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium text-text-muted"
      >
        <Icon name="more" className="h-6 w-6" />
        <span>More</span>
      </button>
    </nav>
  );
}
