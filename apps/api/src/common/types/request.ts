import type { Request } from 'express';
import type { PermissionKey, ScopeModifier } from '@bobs-momo/shared';

export type OutletScope = 'ALL_OUTLETS' | 'OWN_OUTLET';

export interface AuthedUser {
  sub: string;
  roleKey: string;
  employeeId: string | null;
  outletIds: string[];
  scope: OutletScope;
  permHash: string;
  mustReset: boolean;
}

export interface Grant {
  key: PermissionKey;
  modifier: ScopeModifier;
}

/** What every repository drops into its `where` clause. */
export interface RequestScope {
  outletIds: string[];
  selfEmployeeId: string | null;
  /**
   * True when the grant was ALL_OUTLETS. Not the same as "outletIds happens to
   * contain every outlet today": a store manager at the only open shop must
   * still be treated as outlet scoped, or opening a second shop silently widens
   * what they can see.
   */
  allOutlets: boolean;
}

export interface AuthedRequest extends Request {
  user?: AuthedUser;
  grant?: Grant;
  scope?: RequestScope;
}
