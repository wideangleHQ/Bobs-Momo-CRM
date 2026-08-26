import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ERROR_CODES,
  adminResetSchema,
  changePasswordSchema,
  loginSchema,
  type AdminResetDto,
  type ChangePasswordDto,
  type LoginDto,
} from '@bobs-momo/shared';
import { env } from '../../config/env';
import { DomainError } from '../../common/errors/domain.error';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AllowMustReset,
  Permissions,
  Public,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import type { AuthedRequest, AuthedUser, RequestScope } from '../../common/types/request';
import { AuthService, type RequestCtx, type TokenPair } from './auth.service';

const COOKIE = 'bm_rt';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.login(dto, ctxOf(req));
    this.setCookie(res, refreshToken);
    return rest;
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    // The custom header is what a cross-site form post cannot forge, which is
    // why the cookie alone is not enough. Chapter 13, the CSRF position.
    const presented = readCookie(req, COOKIE);
    if (!presented || req.headers['x-refresh-request'] !== '1') {
      throw new DomainError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.AUTH_TOKEN_MISSING,
        'Sign in to continue',
      );
    }

    try {
      const pair = await this.auth.refresh(presented, ctxOf(req));
      return this.respondWithPair(res, pair);
    } catch (e) {
      // A dead token must stop being re-presented on every page load.
      this.clearCookie(res);
      throw e;
    }
  }

  // The refresh response carries only a token, so a browser reload has nothing
  // to rebuild a display name from. This is that endpoint.
  @Get('me')
  @Permissions('auth.session.create')
  @AllowMustReset()
  me(@CurrentUser() user: AuthedUser) {
    return this.auth.me(user.sub);
  }

  @Post('logout')
  @Permissions('auth.session.create')
  @AllowMustReset()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthedUser,
  ): Promise<void> {
    await this.auth.logout(readCookie(req, COOKIE), user, ctxOf(req));
    this.clearCookie(res);
  }

  @Post('change-password')
  @Permissions('auth.password.change')
  @AllowMustReset()
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthedUser,
  ) {
    const pair = await this.auth.changePassword(dto, user, ctxOf(req));
    return this.respondWithPair(res, pair);
  }

  @Post('admin/reset-password')
  @Permissions('auth.password.reset_other')
  @HttpCode(HttpStatus.OK)
  adminReset(
    @Body(new ZodValidationPipe(adminResetSchema)) dto: AdminResetDto,
    @Req() req: AuthedRequest,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.auth.adminReset(dto, user, scope.outletIds, ctxOf(req));
  }

  private respondWithPair(res: Response, pair: TokenPair) {
    const { refreshToken, ...rest } = pair;
    this.setCookie(res, refreshToken);
    return rest;
  }

  private setCookie(res: Response, token: string): void {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: env().NODE_ENV !== 'development',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: env().JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  private clearCookie(res: Response): void {
    res.clearCookie(COOKIE, { path: '/api/v1/auth' });
  }
}

function ctxOf(req: AuthedRequest): RequestCtx {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

function readCookie(req: AuthedRequest, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
