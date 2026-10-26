'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NAV_ITEMS, type NavItem } from '@/lib/nav.config';
import { useCan, useSession, type SessionUser } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icons';
import { Sheet } from '@/components/ui/sheet';
import { OutletSwitcher } from './outlet-switcher';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './user-menu';
import { SearchPalette } from './search-palette';

const TAB_COUNT = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const can = useCan();
  const { user } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const items = useMemo(() => NAV_ITEMS.filter((i) => can(i.permission)), [can]);
  const tabs = items.slice(0, TAB_COUNT);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-dvh bg-[var(--color-bg)] text-[var(--color-text)] font-sans flex">
      <Sidebar items={items} pathname={pathname} user={user} />

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-[272px]">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 lg:pb-10">
          {children}
        </main>
      </div>

      <BottomNav tabs={tabs} pathname={pathname} onMore={() => setMoreOpen(true)} />

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="Navigation">
        <ul className="divide-y divide-[var(--color-border)] py-1">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    'flex min-h-12 items-center gap-3 px-3 text-sm font-semibold transition-all duration-150 rounded-xl',
                    active ? 'text-[var(--color-text)] bg-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]',
                  )}
                >
                  <Icon name={item.icon} className={cn('h-5 w-5', active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]')} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}

function TopBar({ onSearchOpen }: { onSearchOpen: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === '/dashboard' || pathname === '/';

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8">
      {/* Mobile Back button & logo */}
      <div className="flex items-center gap-2 lg:hidden mr-2 flex-shrink-0">
        {!isHome && (
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back to last visited page"
            title="Go back"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] transition-all outline-none focus:outline-none focus-visible:outline-none ring-0 select-none cursor-pointer"
          >
            <Icon name="arrowLeft" className="h-4 w-4" />
          </button>
        )}
        <Link href="/dashboard" className="flex items-center">
          <img src="/assets/logo.png" alt="Bob's Momo" className="h-7 object-contain" />
        </Link>
      </div>

      {/* Desktop Back button */}
      {!isHome && (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back to last visited page"
          title="Go back"
          className="hidden lg:flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] text-xs font-medium transition-all outline-none focus:outline-none focus-visible:outline-none ring-0 select-none cursor-pointer flex-shrink-0"
        >
          <Icon name="arrowLeft" className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <span>Back</span>
        </button>
      )}

      {/* Search trigger — desktop */}
      <button
        type="button"
        onClick={onSearchOpen}
        aria-label="Search (Ctrl+K)"
        className="relative hidden lg:flex flex-1 max-w-xs items-center h-9 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] pl-3 pr-3 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-muted)] transition-all cursor-text outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 select-none"
      >
        <Icon name="search" className="h-4 w-4 flex-shrink-0 mr-2 text-[var(--color-text-muted)]" />
        <span className="flex-1 text-left text-[13px]">Search…</span>
        <kbd className="ml-2 hidden sm:flex items-center gap-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Search trigger — mobile only */}
        <button
          type="button"
          onClick={onSearchOpen}
          aria-label="Search"
          className="lg:hidden flex h-9 w-9 items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] transition-colors outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0"
        >
          <Icon name="search" className="h-4 w-4" />
        </button>
        <OutletSwitcher />
        <NotificationBell />
        <div className="hidden sm:block">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function Sidebar({
  items,
  pathname,
  user,
}: {
  items: NavItem[];
  pathname: string;
  user: SessionUser | null;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] lg:flex">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-[var(--color-border)] px-6">
        <Link href="/dashboard" className="flex items-center hover:opacity-85 transition-opacity">
          <img src="/assets/logo.png" alt="Bob's Momo" className="h-9 object-contain" />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex min-h-[42px] items-center gap-3 rounded-xl px-3.5 text-[14px] font-medium transition-all duration-150 select-none',
                active
                  ? 'bg-[var(--color-accent)] text-[var(--color-text)] font-semibold'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]',
              )}
            >
              <Icon
                name={item.icon}
                className={cn(
                  'h-[18px] w-[18px] flex-shrink-0 transition-colors',
                  active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]',
                )}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom — user profile */}
      <div className="p-3 border-t border-[var(--color-border)]">
        {/* User profile */}
        {user ? (
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl cursor-pointer hover:bg-[var(--color-surface-muted)] transition-colors">
            <div className="h-9 w-9 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)] flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials(user.fullName)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{user.fullName}</p>
              <p className="truncate text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                {user.roleKey.replace(/_/g, ' ')}
              </p>
            </div>
            <Icon name="chevronRight" className="h-3.5 w-3.5 text-[var(--color-border-strong)] flex-shrink-0" />
          </div>
        ) : null}
      </div>
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
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:hidden"
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
              'group flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors select-none',
              active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            <div className={cn('p-1.5 rounded-xl transition-colors', active ? 'bg-[var(--color-accent)]' : '')}>
              <Icon
                name={item.icon}
                className={cn(
                  'h-5 w-5 transition-colors',
                  active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]',
                )}
              />
            </div>
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="group flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors select-none cursor-pointer"
      >
        <div className="p-1.5 rounded-xl">
          <Icon name="more" className="h-5 w-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
        </div>
        <span>More</span>
      </button>
    </nav>
  );
}
