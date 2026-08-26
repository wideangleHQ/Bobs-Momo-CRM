import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@bobs-momo/shared';
import { DomainError } from '../errors/domain.error';
import { IS_PUBLIC_KEY } from '../decorators/permissions.decorator';
import { OutletCacheService } from '../outlets/outlet-cache.service';
import type { AuthedRequest } from '../types/request';

// `S` carries two different meanings. On attendance, leave and tasks it means
// "rows tied to my employee record". On these three it means "my own login",
// and the caller may legitimately have no Employee row: the bootstrap OWNER is
// exactly that account, and demanding an employeeId here locks it out of its
// own password change.
const ACCOUNT_SELF_KEYS = new Set<string>([
  'auth.password.change',
  'notification.own.read',
  'notification.preference.update',
]);

function readOutletId(req: AuthedRequest): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  const candidate =
    (body?.['outletId'] as unknown) ?? req.query?.['outletId'] ?? req.params?.['outletId'];
  return typeof candidate === 'string' ? candidate : undefined;
}

@Injectable()
export class OutletGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly outlets: OutletCacheService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const grant = req.grant;
    if (!grant || !req.user) return true;

    const allowed =
      grant.modifier === 'A' ? await this.outlets.activeOutletIds() : req.user.outletIds;

    const asked = readOutletId(req);
    if (asked !== undefined) {
      // 404 rather than 403: a 403 confirms the resource exists somewhere, and
      // a manager probing ids should not be able to map the other outlet.
      if (!allowed.includes(asked)) {
        throw new DomainError(HttpStatus.NOT_FOUND, ERROR_CODES.COMMON_NOT_FOUND, 'Not found');
      }
      req.scope = { outletIds: [asked], selfEmployeeId: null, allOutlets: grant.modifier === 'A' };
    } else {
      // No outletId supplied: narrow rather than reject, so a list endpoint
      // works for both a single-outlet manager and the owner without a param.
      req.scope = { outletIds: allowed, selfEmployeeId: null, allOutlets: grant.modifier === 'A' };
    }

    if (grant.modifier === 'S' && !ACCOUNT_SELF_KEYS.has(grant.key)) {
      if (!req.user.employeeId) {
        throw new DomainError(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.COMMON_FORBIDDEN,
          'This account is not linked to an employee record',
        );
      }
      req.scope.selfEmployeeId = req.user.employeeId;
    }
    return true;
  }
}
