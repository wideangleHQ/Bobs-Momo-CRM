'use client';

import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';
import { Icon } from '@/components/ui/icons';

const SECTIONS = [
  {
    href: '/admin/users',
    permission: 'admin.user.read',
    title: 'User Accounts & Roles',
    description: 'Manage staff logins, assign role-based permissions, and reset employee passwords.',
    icon: 'users',
    accentColor: 'red' as const,
  },
  {
    href: '/admin/outlets',
    permission: 'admin.outlet.manage',
    title: 'Outlets & Store Locations',
    description: 'Configure store outlets, department scoping, and location parameters.',
    icon: 'building',
    accentColor: 'amber' as const,
  },
  {
    href: '/admin/categories',
    permission: 'inventory.category.manage',
    title: 'Item Categories',
    description: 'Manage category taxonomy for inventory items and consumption reports.',
    icon: 'tag',
    accentColor: 'emerald' as const,
  },
  {
    href: '/admin/units',
    permission: 'inventory.unit.manage',
    title: 'Measurement Units',
    description: 'Configure official units of measure (KG, PCS, LTR) with precision constraints.',
    icon: 'layers',
    accentColor: 'blue' as const,
  },
  {
    href: '/tasks/templates',
    permission: 'task.template.manage',
    title: 'Checklist Templates',
    description: 'Design recurring shift checklists for store opening, hygiene, and kitchen closing.',
    icon: 'clipboard',
    accentColor: 'purple' as const,
  },
  {
    href: '/admin/audit-log',
    permission: 'admin.audit.read',
    title: 'System Audit Log',
    description: 'Immutable, append-only security log tracking all critical data modifications and logins.',
    icon: 'shield',
    accentColor: 'zinc' as const,
  },
] as const;

export default function AdminIndexPage() {
  const can = useCan();
  const visible = SECTIONS.filter((section) => can(section.permission));

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
          title="System Administration"
          description="User accounts, organizational structure, inventory taxonomy, and audit logs."
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No admin sections for your role"
          description="Administration is limited to system owners and operations managers. Contact an administrator if you require access."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {visible.map((section) => {
            const scheme = colorMap[section.accentColor];
            return (
              <Link
                key={section.href}
                href={section.href}
                className={`group relative flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md ${scheme.border} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div
                      className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${scheme.bg} ${scheme.text}`}
                    >
                      <Icon name={section.icon} className="h-6 w-6" />
                    </div>
                    <Icon
                      name="arrowUpRight"
                      className="h-4 w-4 text-zinc-300 group-hover:text-zinc-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-zinc-900 group-hover:text-red-600 transition-colors">
                    {section.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">
                    {section.description}
                  </p>
                </div>

                <div className="mt-6 pt-3 border-t border-zinc-100 flex items-center gap-1.5 text-xs font-semibold text-zinc-400 group-hover:text-zinc-800 transition-colors">
                  <span>Manage section</span>
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
