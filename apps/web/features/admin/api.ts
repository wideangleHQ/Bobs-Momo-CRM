import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { qs } from '@/features/analytics/api';

export interface AdminUser {
  id: string;
  username: string;
  roleKey: string;
  status?: string;
  isActive?: boolean;
  mustReset?: boolean;
  employeeId?: string | null;
  fullName?: string | null;
  outletIds?: string[];
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface AdminUserList {
  data: AdminUser[];
  meta: { page: number; pageSize: number; total: number };
}

export interface CreateUserBody {
  username: string;
  roleKey: string;
  employeeId?: string | null;
  outletIds: string[];
}

/** The plaintext comes back once, on create and on reset, and is never stored. */
export interface ProvisionedCredential {
  userId?: string;
  id?: string;
  username: string;
  temporaryPassword: string;
  mustReset?: boolean;
}

export interface Outlet {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  isActive?: boolean;
}

export interface Department {
  id: string;
  name: string;
  outletId?: string | null;
  outletCode?: string | null;
}

export interface Category {
  id: string;
  name: string;
  itemCount?: number;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorLabel: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  outletId?: string | null;
  outletCode?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  createdAt: string;
}

export interface AuditList {
  data: AuditEntry[];
  meta: { page: number; pageSize: number; total: number };
}

export interface EmployeeOption {
  id: string;
  employeeCode: string;
  fullName: string;
  outletId?: string;
}

const adm = ['admin'] as const;

export const adminKeys = {
  all: () => adm,
  users: (f: Record<string, string | number | undefined>) => [...adm, 'users', f] as const,
  outlets: () => [...adm, 'outlets'] as const,
  departments: () => [...adm, 'departments'] as const,
  categories: () => [...adm, 'categories'] as const,
  units: () => [...adm, 'units'] as const,
  employees: () => [...adm, 'employees'] as const,
  auditLog: (f: Record<string, string | number | undefined>) => [...adm, 'audit-log', f] as const,
};

export const listUsers = (f: { q?: string; page?: number; pageSize?: number }) =>
  apiGet<AdminUserList>(`/admin/users${qs({ ...f })}`);

export const createUser = (body: CreateUserBody) =>
  apiPost<ProvisionedCredential>('/admin/users', body);

export const updateUser = (id: string, body: Partial<Omit<CreateUserBody, 'username'>> & { status?: string }) =>
  apiPatch<AdminUser>(`/admin/users/${id}`, body);

export const resetUserPassword = (userId: string, reason: string) =>
  apiPost<ProvisionedCredential>('/auth/admin/reset-password', { userId, reason });

export const listOutlets = () => apiGet<{ data: Outlet[] }>('/outlets');

export const createOutlet = (body: { code: string; name: string; address?: string }) =>
  apiPost<Outlet>('/outlets', body);

export const listDepartments = () => apiGet<{ data: Department[] }>('/departments');

export const createDepartment = (outletId: string, body: { name: string }) =>
  apiPost<Department>(`/outlets/${outletId}/departments`, body);

export const listCategories = () => apiGet<{ data: Category[] }>('/inventory/categories');

export const createCategory = (body: { name: string }) =>
  apiPost<Category>('/inventory/categories', body);

export const listUnits = () => apiGet<{ data: Unit[] }>('/inventory/units');

export const createUnit = (body: { code: string; name: string }) =>
  apiPost<Unit>('/inventory/units', body);

export const listEmployees = () =>
  apiGet<{ data: EmployeeOption[] }>('/employees?pageSize=100');

export const listAuditLog = (f: {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  outletId?: string;
  page?: number;
  pageSize?: number;
}) => apiGet<AuditList>(`/admin/audit-log${qs({ ...f })}`);
