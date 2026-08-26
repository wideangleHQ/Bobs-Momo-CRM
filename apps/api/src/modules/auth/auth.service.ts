import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import {
  ERROR_CODES,
  PERMISSIONS,
  type AdminResetDto,
  type ChangePasswordDto,
  type LoginDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PERMISSION_HASHES } from '../../common/permissions';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { OutletCacheService } from '../../common/outlets/outlet-cache.service';
import type { AuthedUser, OutletScope } from '../../common/types/request';
import { AuthRepository } from './auth.repository';
import { PasswordService } from './password.service';
import { TokenService, sha256 } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const ROTATION_REPLAY_SECONDS = 5;

// Roles whose outlet scope is computed at login instead of read from UserOutlet,
// so opening outlet three does not need a data fix for these accounts.
const ALL_OUTLET_ROLES = new Set(['OWNER', 'OPERATIONS_MANAGER']);

export interface RequestCtx {
  ip: string | null;
  userAgent: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mustReset: boolean;
}

type UserWithScope = User & {
  employee: { id: string; fullName: string } | null;
  outlets: { outletId: string }[];
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly outlets: OutletCacheService,
  ) {}

  async login(dto: LoginDto, ctx: RequestCtx) {
    const user = (await this.repo.findUserByIdentifier(dto.identifier)) as UserWithScope | null;

    // Unknown user still costs a full argon2 verify, so response timing does
    // not enumerate accounts.
    if (!user) {
      await this.passwords.burnTime(dto.password);
      throw this.invalidCredentials();
    }

    // Verify before checking the lock, so a locked account with the wrong
    // password cannot learn that the account is locked.
    const ok = await this.passwords.verify(user.passwordHash, dto.password);

    if (!ok) {
      await this.registerFailure(user);
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new DomainError(
        HttpStatus.LOCKED,
        ERROR_CODES.AUTH_ACCOUNT_LOCKED,
        'Too many attempts. Try again shortly',
        { retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000) },
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.AUTH_ACCOUNT_DISABLED,
        'This account is not active. Contact your manager',
      );
    }

    const familyId = randomUUID();
    const issued = await this.prisma.$transaction(async (tx) => {
      await this.repo.recordSuccessfulLogin(tx, user.id);
      const pair = await this.issuePair(tx, user, familyId, ctx);
      await this.repo.writeAudit(tx, this.auditRow(user, 'auth.session.create', ctx));
      return pair;
    });

    return { ...issued, user: await this.profile(user) };
  }

  async refresh(presented: string, ctx: RequestCtx): Promise<TokenPair> {
    const tokenHash = sha256(presented);
    const row = await this.repo.findRefreshToken(tokenHash);

    if (!row) throw this.tokenError(ERROR_CODES.AUTH_TOKEN_INVALID, 'Sign in again');
    if (row.expiresAt < new Date()) {
      throw this.tokenError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Your session expired');
    }

    if (row.revokedAt) {
      // Three browser tabs can refresh within milliseconds of each other and
      // the loser presents an already rotated token through nobody's fault.
      // Five seconds covers that. It does not cover a token stolen an hour ago.
      const replay = await this.redis.get<TokenPair>(`auth:rot:${tokenHash}`);
      if (replay) return replay;

      await this.repo.revokeFamily(row.familyId);
      this.logger.warn(`refresh token reuse detected for user ${row.userId}`);
      await this.prisma.auditLog.create({
        data: {
          actorId: row.userId,
          actorLabel: row.userId,
          action: 'auth.token.reuse',
          entityType: 'RefreshToken',
          entityId: row.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      });
      throw this.tokenError(ERROR_CODES.AUTH_TOKEN_REUSED, 'Sign in again');
    }

    const user = (await this.repo.findUserById(row.userId)) as UserWithScope | null;
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.AUTH_ACCOUNT_DISABLED,
        'This account is not active. Contact your manager',
      );
    }

    const issued = await this.prisma.$transaction(async (tx) => {
      await this.repo.revokeToken(tx, row.id);
      return this.issuePair(tx, user, row.familyId, ctx);
    });

    await this.redis.set(`auth:rot:${tokenHash}`, issued, ROTATION_REPLAY_SECONDS);
    return issued;
  }

  /** Idempotent. A second call with no cookie still succeeds. */
  async logout(presented: string | null, user: AuthedUser, ctx: RequestCtx): Promise<void> {
    if (presented) {
      const row = await this.repo.findRefreshToken(sha256(presented));
      // The whole family, not just this token: logging out on the counter
      // tablet must not leave a live rotation chain behind.
      if (row) await this.repo.revokeFamily(row.familyId);
    }
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        actorLabel: user.sub,
        action: 'auth.session.end',
        entityType: 'User',
        entityId: user.sub,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
  }

  async changePassword(dto: ChangePasswordDto, authed: AuthedUser, ctx: RequestCtx) {
    const user = (await this.repo.findUserById(authed.sub)) as UserWithScope | null;
    if (!user) throw DomainError.notFound();

    // Verified even when mustReset is true. A borrowed unlocked phone should
    // not be able to take the account over.
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw this.invalidCredentials();
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.AUTH_SAME_PASSWORD,
        'The new password must be different',
      );
    }
    const weak = this.passwords.weakness(dto.newPassword, user.username);
    if (weak) {
      throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, ERROR_CODES.AUTH_WEAK_PASSWORD, weak);
    }

    const hash = await this.passwords.hash(dto.newPassword);
    const familyId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.repo.setPassword(tx, user.id, hash, false);
      await this.repo.revokeAllForUser(tx, user.id);
      await this.repo.writeAudit(tx, this.auditRow(user, 'auth.password.change', ctx));
      // A fresh session, so the user is not bounced to login the moment they
      // set a password.
      return this.issuePair(tx, { ...user, mustReset: false }, familyId, ctx);
    });
  }

  async adminReset(dto: AdminResetDto, actor: AuthedUser, allowedOutletIds: string[], ctx: RequestCtx) {
    if (dto.userId === actor.sub) {
      throw DomainError.conflict(
        ERROR_CODES.COMMON_CONFLICT,
        'Use change password for your own account',
      );
    }

    const target = (await this.repo.findUserById(dto.userId)) as UserWithScope | null;
    // 404 rather than 403 for a user outside scope, same reasoning as OutletGuard.
    if (!target) throw DomainError.notFound();
    if (!ALL_OUTLET_ROLES.has(actor.roleKey)) {
      const overlap = target.outlets.some((o) => allowedOutletIds.includes(o.outletId));
      if (!overlap) throw DomainError.notFound();
    }

    const temporaryPassword = this.passwords.generateTemporary();
    const hash = await this.passwords.hash(temporaryPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.repo.setPassword(tx, target.id, hash, true);
      await this.repo.revokeAllForUser(tx, target.id);
      await this.repo.writeAudit(tx, {
        actorId: actor.sub,
        actorLabel: actor.sub,
        action: 'auth.password.reset_other',
        entityType: 'User',
        entityId: target.id,
        after: { reason: dto.reason } as Prisma.InputJsonValue,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    });

    // Returned exactly once, never logged, never persisted. Most floor staff
    // have no email and the manager is going to read it out loud.
    return {
      userId: target.id,
      username: target.username,
      temporaryPassword,
      mustReset: true,
    };
  }

  async me(userId: string) {
    const user = (await this.repo.findUserById(userId)) as UserWithScope | null;
    if (!user) throw DomainError.notFound();
    return this.profile(user);
  }

  async profile(user: UserWithScope) {
    const { outletIds, scope } = await this.resolveScope(user);
    return {
      id: user.id,
      username: user.username,
      roleKey: user.roleKey,
      employeeId: user.employee?.id ?? null,
      fullName: user.employee?.fullName ?? user.username,
      outletIds,
      scope,
      permissions: PERMISSIONS[user.roleKey] ?? {},
    };
  }

  private async resolveScope(
    user: UserWithScope,
  ): Promise<{ outletIds: string[]; scope: OutletScope }> {
    if (ALL_OUTLET_ROLES.has(user.roleKey)) {
      return { outletIds: await this.outlets.activeOutletIds(), scope: 'ALL_OUTLETS' };
    }
    return { outletIds: user.outlets.map((o) => o.outletId), scope: 'OWN_OUTLET' };
  }

  private async issuePair(
    tx: Prisma.TransactionClient,
    user: UserWithScope,
    familyId: string,
    ctx: RequestCtx,
  ): Promise<TokenPair> {
    const { outletIds, scope } = await this.resolveScope(user);
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      roleKey: user.roleKey,
      employeeId: user.employee?.id ?? null,
      outletIds,
      scope,
      permHash: PERMISSION_HASHES[user.roleKey] ?? '',
      mustReset: user.mustReset,
    });

    const { token, tokenHash } = this.tokens.newRefreshToken();
    await this.repo.createRefreshToken(tx, {
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt: this.tokens.refreshExpiry(),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      accessToken,
      refreshToken: token,
      expiresIn: 900,
      mustReset: user.mustReset,
    };
  }

  /**
   * A lock is set once, on the attempt that crosses the threshold, and is never
   * pushed forward by later attempts.
   *
   * Renewing it on every failure meant a cook who kept mistyping locked himself
   * out permanently: he cannot see the lock, because a wrong password returns
   * the same 401 as always, so he keeps trying and keeps resetting the clock.
   * It also let anyone who knows a username hold that account shut with one
   * request every fifteen minutes.
   *
   * The counter is also allowed to go stale. Once the window has passed with no
   * further attempts the count restarts, so five typos spread over a month do
   * not add up to a lockout.
   */
  private async registerFailure(user: User): Promise<void> {
    const now = Date.now();
    const lockActive = user.lockedUntil !== null && user.lockedUntil.getTime() > now;
    if (lockActive) return;

    const windowMs = LOCKOUT_MINUTES * 60 * 1000;
    const stale = user.lockedUntil !== null && user.lockedUntil.getTime() <= now;
    const failedLogins = stale ? 1 : user.failedLogins + 1;

    const lockedUntil =
      failedLogins >= MAX_FAILED_LOGINS ? new Date(now + windowMs) : null;
    await this.repo.recordFailedLogin(user.id, failedLogins, lockedUntil);
  }

  private auditRow(
    user: UserWithScope,
    action: string,
    ctx: RequestCtx,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      actorId: user.id,
      actorLabel: user.username,
      action,
      entityType: 'User',
      entityId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    };
  }

  private invalidCredentials(): DomainError {
    // Deliberately identical for an unknown user and a wrong password.
    return new DomainError(
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      'Wrong username or password',
    );
  }

  private tokenError(code: string, message: string): DomainError {
    return new DomainError(HttpStatus.UNAUTHORIZED, code, message);
  }
}
