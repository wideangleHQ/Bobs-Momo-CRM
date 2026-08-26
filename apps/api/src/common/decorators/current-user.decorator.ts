import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest, AuthedUser, RequestScope } from '../types/request';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new Error('CurrentUser used on a route without JwtAuthGuard');
    return req.user;
  },
);

export const Scope = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestScope => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.scope) throw new Error('Scope used on a route without OutletGuard');
  return req.scope;
});
