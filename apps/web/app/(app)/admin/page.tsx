'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useCan } from '@/lib/auth';

const SECTIONS = [
  {
    href: '/admin/users',
    permission: 'admin.user.read',
    title: 'User accounts',
    description: 'Create logins, change a role, reset a password.',
  },
  {
    href: '/admin/outlets',
    permission: 'admin.outlet.manage',
    title: 'Outlets and departments',
    description: 'The org structure every scope rule and broadcast reads from.',
  },
  {
    href: '/admin/categories',
    permission: 'inventory.category.manage',
    title: 'Item categories',
    description: 'How the item master and the consumption report group things.',
  },
  {
    href: '/admin/units',
    permission: 'inventory.unit.manage',
    title: 'Units',
    description: 'Kilograms, litres, pieces. Quantities are never converted between them.',
  },
  {
    href: '/tasks/templates',
    permission: 'task.template.manage',
    title: 'Checklist templates',
    description: 'The opening and closing checklists staff run each day.',
  },
  {
    href: '/admin/audit-log',
    permission: 'admin.audit.read',
    title: 'Audit log',
    description: 'Who changed what, when. Append only, with no delete path.',
  },
] as const;

export default function AdminIndexPage() {
  const can = useCan();
  const visible = SECTIONS.filter((section) => can(section.permission));

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title="Admin" description="Accounts, org structure and the record of changes" />

      {visible.length === 0 ? (
        <EmptyState
          title="No admin sections for your role"
          description="Administration is limited to the owner and the operations manager. Ask one of them for the change you need."
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((section) => (
            <li key={section.href}>
              <Link href={section.href} className="block">
                <Card className="min-h-[44px] p-4 hover:border-primary">
                  <h2 className="font-semibold text-text">{section.title}</h2>
                  <p className="mt-1 text-sm text-text-muted">{section.description}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
