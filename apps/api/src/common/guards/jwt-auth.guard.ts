import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@bobs-momo/shared';
import { DomainError } from '../errors/domain.error';
import {
  ALLOW_MUST_RESET_KEY,
  IS_PUBLIC_KEY,
} from '../decorators/permissions.decorator';
import { TokenService } from '../../modules/auth/token.service';
import type { AuthedRequest } from '../types/request';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new DomainError(HttpStatus.UNAUTHORIZED, ERROR_CODES.AUTH_TOKEN_MISSING, 'Sign in to continue');
    }

    try {
      req.user = await this.tokens.verifyAccess(header.slice(7));
    } catch {
      throw new DomainError(HttpStatus.UNAUTHORIZED, ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Your session expired');
    }

    // A user who has not set their own password can reach exactly one endpoint.
    const allowMustReset = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_RESET_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (req.user.mustReset && !allowMustReset) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.AUTH_PASSWORD_RESET_REQUIRED,
        'Set a new password before continuing',
      );
    }
    return true;
  }
}
