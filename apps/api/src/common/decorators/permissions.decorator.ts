import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@bobs-momo/shared';

export const PERMISSIONS_KEY = 'permissions';

/** Listing more than one key means "any of these is enough". */
export const Permissions = (...keys: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, keys);

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Reachable while `mustReset` is true. Only the password screen needs this. */
export const ALLOW_MUST_RESET_KEY = 'allowMustReset';
export const AllowMustReset = () => SetMetadata(ALLOW_MUST_RESET_KEY, true);
