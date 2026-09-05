import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_ERRORS,
  paginate,
  type AssignOutletsDto,
  type AssignRoleDto,
  type CreateUserDto,
  type DisableUserDto,
  type ListUsersQuery,
  type UpdateUserDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestScope } from '../../common/types/request';
import { PasswordService } from '../auth/password.service';
import { writeAudit, type Actor } from './audit-writer';

const USER_INCLUDE = {
  outlets: { select: { outletId: true } },
  employee: { select: { id: true, fullName: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/**
 * The only place a User row becomes a response. passwordHash is dropped here
 * and there is no other path out of this service, so no admin response can
 * carry it.
 */
function toView(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    status: u.status,
    roleKey: u.roleKey,
    mustReset: u.mustReset,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    outletIds: u.outlets.map((o) => o.outletId),
    employeeId: u.employee?.id ?? null,
    fullName: u.employee?.fullName ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export type UserView = ReturnType<typeof toView>;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async list(query: ListUsersQuery, actor: Actor, scope: RequestScope) {
    const where: Prisma.UserWhereInput = {
      ...scopeWhere(actor, scope, query.outletId),
      ...(query.roleKey ? { roleKey: query.roleKey } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { username: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { employee: { fullName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ status: 'asc' }, { username: 'asc' }],
        include: USER_INCLUDE,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(rows.map(toView), total, query);
  }

  async get(id: string, actor: Actor, scope: RequestScope): Promise<UserView> {
    return toView(await this.load(id, actor, scope));
  }

  /**
   * Returns the temporary password. It exists in this response body and
   * nowhere else: never logged, never stored in plain form, and no read
   * endpoint can produce it again.
   */
  async create(dto: CreateUserDto, actor: Actor, scope: RequestScope) {
    assertOutletsInScope(dto.outletIds, scope);

    const temporaryPassword = this.passwords.generateTemporary();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const created = await this.tx(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          email: dto.email ?? null,
          passwordHash,
          roleKey: dto.roleKey,
          mustReset: true,
          outlets: { create: dto.outletIds.map((outletId) => ({ outletId })) },
        },
      });

      if (dto.employeeId) {
        const linked = await tx.employee.updateMany({
          where: { id: dto.employeeId, userId: null },
          data: { userId: user.id },
        });
        if (linked.count === 0) throw DomainError.notFound();
      }

      await writeAudit(tx, actor, {
        action: 'admin.user.create',
        entityType: 'User',
        entityId: user.id,
        outletId: dto.outletIds[0] ?? null,
        after: { username: user.username, roleKey: user.roleKey, outletIds: dto.outletIds },
      });

      return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: USER_INCLUDE });
    });

    return { ...toView(created), temporaryPassword };
  }

  async update(id: string, dto: UpdateUserDto, actor: Actor, scope: RequestScope) {
    const before = await this.load(id, actor, scope);
    if (dto.status === 'SUSPENDED' && id === actor.user.sub) throw selfBlocked('suspend');

    await this.tx(async (tx) => {
      const after = await tx.user.update({
        where: { id },
        data: {
          ...(dto.username === undefined ? {} : { username: dto.username }),
          ...(dto.email === undefined ? {} : { email: dto.email ?? null }),
          ...(dto.status === undefined ? {} : { status: dto.status }),
        },
        include: USER_INCLUDE,
      });
      // Leaving ACTIVE takes the live sessions with it, same reasoning as a
      // disable. Re-activating does not need to touch tokens.
      if (dto.status === 'SUSPENDED') await revokeSessions(tx, id);
      await writeAudit(tx, actor, {
        action: 'admin.user.update',
        entityType: 'User',
        entityId: id,
        outletId: before.outlets[0]?.outletId ?? null,
        before: { username: before.username, email: before.email, status: before.status },
        after: { username: after.username, email: after.email, status: after.status },
      });
    });

    return this.get(id, actor, scope);
  }

  async disable(id: string, dto: DisableUserDto, actor: Actor, scope: RequestScope) {
    const user = await this.load(id, actor, scope);
    if (id === actor.user.sub) throw selfBlocked('disable');
    if (user.status === 'DISABLED') {
      throw DomainError.conflict(
        ADMIN_ERRORS.ADMIN_USER_ALREADY_DISABLED,
        'That login is already disabled',
      );
    }

    await this.tx(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'DISABLED' } });
      // In the same transaction as the status change. A live refresh token
      // otherwise mints a fresh access token for a disabled account for as
      // long as the token lasts.
      await revokeSessions(tx, id);
      await writeAudit(tx, actor, {
        action: 'admin.user.status_change',
        entityType: 'User',
        entityId: id,
        outletId: user.outlets[0]?.outletId ?? null,
        before: { status: user.status },
        after: { status: 'DISABLED', reason: dto.reason },
      });
    });

    return this.get(id, actor, scope);
  }

  async assignRole(id: string, dto: AssignRoleDto, actor: Actor, scope: RequestScope) {
    const user = await this.load(id, actor, scope);
    if (id === actor.user.sub) throw selfBlocked('change the role on');
    if (user.roleKey === dto.roleKey) {
      throw DomainError.conflict(ADMIN_ERRORS.ADMIN_ROLE_UNCHANGED, 'That is already the role');
    }

    await this.tx(async (tx) => {
      await tx.user.update({ where: { id }, data: { roleKey: dto.roleKey } });
      // The access token carries a permission hash, so PermissionsGuard rejects
      // the old one on the next call. The refresh token carries nothing, so
      // without this it would keep minting tokens for the old role.
      await revokeSessions(tx, id);
      await writeAudit(tx, actor, {
        action: 'admin.user.role_change',
        entityType: 'User',
        entityId: id,
        outletId: user.outlets[0]?.outletId ?? null,
        before: { roleKey: user.roleKey },
        after: { roleKey: dto.roleKey, reason: dto.reason ?? null },
      });
    });

    return this.get(id, actor, scope);
  }

  async assignOutlets(id: string, dto: AssignOutletsDto, actor: Actor, scope: RequestScope) {
    const user = await this.load(id, actor, scope);
    assertOutletsInScope(dto.outletIds, scope);
    const before = user.outlets.map((o) => o.outletId);

    await this.tx(async (tx) => {
      await tx.userOutlet.deleteMany({ where: { userId: id } });
      await tx.userOutlet.createMany({
        data: dto.outletIds.map((outletId) => ({ userId: id, outletId })),
      });
      // The outlet list is baked into the access token and is not covered by
      // the permission hash, so only a new login picks up the change.
      await revokeSessions(tx, id);
      await writeAudit(tx, actor, {
        action: 'admin.user.outlet_change',
        entityType: 'UserOutlet',
        entityId: id,
        outletId: dto.outletIds[0] ?? null,
        before: { outletIds: before },
        after: { outletIds: dto.outletIds },
      });
    });

    return this.get(id, actor, scope);
  }

  private async load(id: string, actor: Actor, scope: RequestScope): Promise<UserRow> {
    const user = await this.prisma.user.findFirst({
      where: { id, ...scopeWhere(actor, scope) },
      include: USER_INCLUDE,
    });
    // 404 rather than 403 for a login at another outlet: a 403 confirms the id
    // is real and lets a manager map the other outlet's staff.
    if (!user) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ADMIN_ERRORS.ADMIN_USER_NOT_FOUND,
        'That user does not exist',
      );
    }
    return user;
  }

  private async tx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (err) {
      throw translate(err);
    }
  }
}

function scopeWhere(actor: Actor, scope: RequestScope, outletId?: string): Prisma.UserWhereInput {
  if (outletId) return { outlets: { some: { outletId } } };
  // OWNER and OPERATIONS_MANAGER hold no UserOutlet rows at all, so an outlet
  // filter would hide them from every list including their own.
  if (actor.user.scope === 'ALL_OUTLETS') return {};
  return { outlets: { some: { outletId: { in: scope.outletIds } } } };
}

function assertOutletsInScope(outletIds: string[], scope: RequestScope): void {
  if (outletIds.some((id) => !scope.outletIds.includes(id))) throw DomainError.notFound();
}

async function revokeSessions(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function selfBlocked(what: string): DomainError {
  return DomainError.conflict(
    ADMIN_ERRORS.ADMIN_SELF_ACTION_BLOCKED,
    `You cannot ${what} your own login. Ask another administrator`,
  );
}

function translate(err: unknown): unknown {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return err;
  const target = Array.isArray(err.meta?.['target']) ? (err.meta['target'] as string[]) : [];
  if (err.code === 'P2002' && target.includes('email')) {
    return DomainError.conflict(ADMIN_ERRORS.ADMIN_EMAIL_TAKEN, 'That email is already in use');
  }
  if (err.code === 'P2002') {
    return DomainError.conflict(
      ADMIN_ERRORS.ADMIN_USERNAME_TAKEN,
      'That username is already taken',
    );
  }
  // A foreign key failure here means an outlet id that passed the scope check
  // and then did not exist. Same answer as any other unreachable outlet.
  if (err.code === 'P2003') return DomainError.notFound();
  return err;
}
