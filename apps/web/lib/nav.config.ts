export interface NavItem {
  href: string;
  label: string;
  /** A key from packages/shared/src/permissions.ts. Nav is filtered, never
   *  hardcoded per role, so a role that gains a permission gains the entry. */
  permission: string;
  /** A name in components/ui/icons.tsx. */
  icon: string;
}

/**
 * Top-level destinations, grouped by area and in shell order. Agents 8, 9 and
 * 10 append their child routes to their own group. Append only, never reorder:
 * the first four entries a user can see become their bottom nav tabs.
 */
export const NAV_ITEMS: NavItem[] = [
  // Home
  // Every role holds auth.session.create, which is the closest key the matrix
  // has to "any signed-in user". There is no analytics permission that floor
  // staff hold and the dashboard is their home screen.
  { href: '/dashboard', label: 'Home', permission: 'auth.session.create', icon: 'home' },

  // Work
  { href: '/tasks', label: 'Tasks', permission: 'task.task.read', icon: 'tasks' },

  // Workforce
  {
    href: '/attendance',
    label: 'Attendance',
    permission: 'workforce.attendance.punch_self',
    icon: 'clock',
  },
  { href: '/shifts', label: 'Shifts', permission: 'workforce.shift.read', icon: 'calendar' },
  { href: '/leave', label: 'Leave', permission: 'workforce.leave.read', icon: 'leave' },
  {
    href: '/employees',
    label: 'Employees',
    permission: 'workforce.employee.read',
    icon: 'users',
  },

  // Stock and buying
  { href: '/inventory', label: 'Inventory', permission: 'inventory.stock.read', icon: 'box' },
  {
    href: '/purchases',
    label: 'Purchases',
    permission: 'purchase.request.read',
    icon: 'cart',
  },
  { href: '/vendors', label: 'Vendors', permission: 'vendor.vendor.read', icon: 'truck' },

  // Money
  { href: '/sales', label: 'Sales', permission: 'sales.entry.read', icon: 'rupee' },
  {
    href: '/reports',
    label: 'Reports',
    permission: 'analytics.dashboard.read',
    icon: 'chart',
  },

  // Communication
  {
    href: '/messages',
    label: 'Messages',
    permission: 'messaging.message.read',
    icon: 'message',
  },
  {
    href: '/notifications',
    label: 'Notifications',
    permission: 'notification.own.read',
    icon: 'bell',
  },

  // Administration
  { href: '/admin', label: 'Admin', permission: 'admin.user.read', icon: 'settings' },
];
