import { createHash } from 'node:crypto';
import { PERMISSIONS, type PermissionKey, type ScopeModifier } from '@bobs-momo/shared';

export { PERMISSIONS };

/**
 * First 12 hex chars of sha256 over the role's sorted permission list. Goes in
 * the access token so a role change or a release that edits the matrix
 * invalidates outstanding tokens instead of waiting 15 minutes.
 */
export function permissionHash(roleKey: string): string {
  const keys = Object.keys(PERMISSIONS[roleKey] ?? {}).sort();
  return createHash('sha256').update(keys.join(',')).digest('hex').slice(0, 12);
}

export const PERMISSION_HASHES: Record<string, string> = Object.fromEntries(
  Object.keys(PERMISSIONS).map((role) => [role, permissionHash(role)]),
);

export function grantsFor(roleKey: string): Partial<Record<PermissionKey, ScopeModifier>> {
  return PERMISSIONS[roleKey] ?? {};
}
