import { NotFoundException } from '@nestjs/common';
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

/**
 * Narrows an optional requested outlet against what the caller can reach.
 *
 * Lived in two service files under two names, which is how an outlet scoping
 * rule eventually gets fixed in one copy and not the other. An outlet the
 * caller cannot reach reads as not existing, per the 404-not-403 rule.
 */
export function narrowOutlets(asked: string | undefined, scope: RequestScope): string[] {
  if (!asked) return scope.outletIds;
  const allowed = scope.outletIds.filter((id) => id === asked);
  if (allowed.length === 0) {
    throw new NotFoundException({ code: 'COMMON_NOT_FOUND', message: 'Not found' });
  }
  return allowed;
}
