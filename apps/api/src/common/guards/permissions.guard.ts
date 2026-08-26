import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type PermissionKey } from '@bobs-momo/shared';
import { DomainError } from '../errors/domain.error';
import { PERMISSION_HASHES, grantsFor } from '../permissions';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthedRequest } from '../types/request';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) {
      throw new DomainError(HttpStatus.UNAUTHORIZED, ERROR_CODES.AUTH_TOKEN_MISSING, 'Sign in to continue');
    }

    // A role change or a release that edits the matrix invalidates the token
    // now rather than in fifteen minutes.
    if (user.permHash !== PERMISSION_HASHES[user.roleKey]) {
      throw new DomainError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.AUTH_PERMISSIONS_STALE,
        'Your access changed, sign in again',
      );
    }

    const grants = grantsFor(user.roleKey);
    const key = required.find((k) => k in grants);
    if (!key) {
      throw new DomainError(HttpStatus.FORBIDDEN, ERROR_CODES.COMMON_FORBIDDEN, 'Not allowed', {
        required,
      });
    }

    req.grant = { key, modifier: grants[key]! };
    return true;
  }
}
