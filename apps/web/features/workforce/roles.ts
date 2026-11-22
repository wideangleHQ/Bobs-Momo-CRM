import type { RoleKey } from '@bobs-momo/shared';

export const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: 'Owner',
  OPERATIONS_MANAGER: 'Operations Manager',
  STORE_MANAGER: 'Store Manager',
  KITCHEN_MANAGER: 'Kitchen Manager',
  INVENTORY_MANAGER: 'Inventory Manager',
  PURCHASE_MANAGER: 'Purchase Manager',
  HR_ACCOUNTS: 'HR / Accounts',
  KITCHEN_STAFF: 'Kitchen Staff',
  COUNTER_CASHIER: 'Counter Cashier',
};

export function roleLabel(roleKey: string): string {
  return (ROLE_LABELS as Record<string, string>)[roleKey] ?? roleKey;
}
