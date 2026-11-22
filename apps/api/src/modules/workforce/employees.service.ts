import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALL_OUTLET_ROLE_KEYS,
  ERROR_CODES,
  formatEmployeeUsername,
  paginate,
  type CreateEmployeeDto,
  type ExitEmployeeDto,
  type ListEmployeesQuery,
  type SetEligibilityDto,
  type UpdateEmployeeDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { narrowOutlets as narrow } from '../../common/types/request';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { PasswordService } from '../auth/password.service';

const EMPLOYEE_INCLUDE = {
  outlet: { select: { id: true, code: true } },
  department: { select: { id: true, name: true } },
  user: {
    select: {
      id: true,
      username: true,
      roleKey: true,
      status: true,
      mustReset: true,
      lastLoginAt: true,
    },
  },
} satisfies Prisma.EmployeeInclude;

// How many sequence numbers one request will skip past if somebody has already
// taken one by hand (a legacy row, a typed username). A skip is a gap, never a
// reuse, and more than this many in a row means something is badly wrong.
const MAX_ALLOCATION_SKIPS = 25;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async list(query: ListEmployeesQuery, scope: RequestScope) {
    const where: Prisma.EmployeeWhereInput = {
      outletId: { in: narrow(query.outletId, scope) },
      ...(scope.selfEmployeeId ? { id: scope.selfEmployeeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { employeeCode: { contains: query.search.toUpperCase() } },
              { phone: { contains: query.search } },
              { user: { is: { username: { contains: query.search.toLowerCase() } } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
        include: EMPLOYEE_INCLUDE,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return paginate(rows.map(toView), total, query);
  }

  async get(id: string, scope: RequestScope) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: EMPLOYEE_INCLUDE,
    });
    if (!employee || !scope.outletIds.includes(employee.outletId)) throw this.notFound();
    if (scope.selfEmployeeId && employee.id !== scope.selfEmployeeId) throw this.notFound();
    return toView(employee);
  }

  /**
   * The employee and their own login are one operation. Both rows, the generated
   * username, the generated employee code and the audit rows commit together or
   * not at all: a failure at any step leaves no employee without a login and no
   * login without an employee. The username comes from a database sequence, never
   * from the request and never from "highest existing plus one".
   */
  async create(dto: CreateEmployeeDto, actor: AuthedUser, scope: RequestScope) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();
    await this.assertDepartmentBelongs(dto.departmentId ?? null, dto.outletId);

    // Hashed before the transaction opens: argon2 is CPU work that must not hold
    // a database connection (the same rule as login).
    const initialPassword = this.passwords.initialEmployeePassword();
    const passwordHash = await this.passwords.hash(initialPassword);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const username = await this.allocateUsername(tx);
        const employeeCode = await this.allocateEmployeeCode(tx);

        const user = await tx.user.create({
          data: {
            username,
            passwordHash,
            roleKey: dto.roleKey,
            mustReset: true,
            outlets: {
              create: ALL_OUTLET_ROLE_KEYS.includes(dto.roleKey) ? [] : [{ outletId: dto.outletId }],
            },
          },
        });
        const employee = await tx.employee.create({
          data: {
            employeeCode,
            fullName: dto.fullName,
            phone: dto.phone,
            outletId: dto.outletId,
            departmentId: dto.departmentId ?? null,
            designation: dto.designation ?? null,
            joinedOn: new Date(`${dto.joinedOn}T00:00:00.000Z`),
            userId: user.id,
          },
          include: EMPLOYEE_INCLUDE,
        });

        // No password, hash or token in either row.
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorLabel: actor.sub,
            action: 'workforce.employee.create',
            entityType: 'Employee',
            entityId: employee.id,
            outletId: dto.outletId,
            after: {
              employeeCode,
              username,
              roleKey: dto.roleKey,
              outletId: dto.outletId,
              mustReset: true,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorLabel: actor.sub,
            action: 'admin.user.create',
            entityType: 'User',
            entityId: user.id,
            outletId: dto.outletId,
            after: { username, roleKey: dto.roleKey, employeeId: employee.id } as Prisma.InputJsonValue,
          },
        });
        return employee;
      },
      { maxWait: 10000, timeout: 15000 },
    );

    return {
      employee: toView(created),
      // Shown to the creator once. Only the hash is stored.
      account: {
        username: created.user?.username ?? '',
        roleKey: dto.roleKey,
        mustReset: true,
        initialPassword,
      },
    };
  }

  async update(id: string, dto: UpdateEmployeeDto, actor: AuthedUser, scope: RequestScope) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) throw this.notFound();
    if (employee.status === 'EXITED' && dto.status !== undefined) {
      throw DomainError.conflict(
        ERROR_CODES.EMPLOYEE_ALREADY_EXITED,
        'That employee has left, so their status cannot change',
      );
    }

    const outletId = dto.outletId ?? employee.outletId;
    if (dto.outletId && !scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();
    if (dto.departmentId !== undefined) {
      await this.assertDepartmentBelongs(dto.departmentId ?? null, outletId);
    }

    const changed = Object.keys(dto) as (keyof UpdateEmployeeDto)[];
    const before: Record<string, unknown> = {};
    for (const key of changed) before[key] = employee[key as keyof typeof employee] ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.departmentId === null ? { departmentId: null } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorLabel: actor.sub,
          action: 'workforce.employee.update',
          entityType: 'Employee',
          entityId: id,
          outletId: employee.outletId,
          before: before as Prisma.InputJsonValue,
          after: dto as Prisma.InputJsonValue,
        },
      });
    });
    return this.get(id, scope);
  }

  /**
   * Includes or excludes a record from attendance, task assignment and employee
   * reporting without deleting anything. This is how an Owner takes a shared
   * account's employee row out of those views while keeping its history.
   */
  async setEligibility(id: string, dto: SetEligibilityDto, actor: AuthedUser, scope: RequestScope) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) throw this.notFound();

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { eligibleForWorkflows: dto.eligible } });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorLabel: actor.sub,
          action: 'workforce.employee.eligibility',
          entityType: 'Employee',
          entityId: id,
          outletId: employee.outletId,
          before: { eligibleForWorkflows: employee.eligibleForWorkflows } as Prisma.InputJsonValue,
          after: { eligibleForWorkflows: dto.eligible, reason: dto.reason } as Prisma.InputJsonValue,
        },
      });
    });
    return this.get(id, scope);
  }

  /**
   * An exit is a status change, never a delete. Attendance, tasks and leave all
   * point at this row, and the history has to stay readable after the person
   * leaves.
   */
  async exit(id: string, dto: ExitEmployeeDto, actor: AuthedUser, scope: RequestScope) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) throw this.notFound();
    if (employee.status === 'EXITED') {
      throw DomainError.conflict(
        ERROR_CODES.EMPLOYEE_ALREADY_EXITED,
        'That employee has already left',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        data: {
          status: 'EXITED',
          exitedOn: new Date(`${dto.exitedOn}T00:00:00.000Z`),
        },
      });
      // The login goes with them, along with every live session.
      if (employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { status: 'DISABLED' } });
        await tx.refreshToken.updateMany({
          where: { userId: employee.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorLabel: actor.sub,
          action: 'workforce.employee.exit',
          entityType: 'Employee',
          entityId: id,
          outletId: employee.outletId,
          after: { exitedOn: dto.exitedOn, reason: dto.reason } as Prisma.InputJsonValue,
        },
      });
    });

    return this.get(id, scope);
  }

  /**
   * nextval() is not rolled back with the transaction, so a failed attempt burns
   * a number and nothing is ever issued twice. A number already taken by a row
   * created some other way is skipped, not reused.
   */
  private async allocateUsername(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < MAX_ALLOCATION_SKIPS; i += 1) {
      const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('employee_username_seq') AS n`;
      const username = formatEmployeeUsername(Number(rows[0]?.n));
      if (!(await tx.user.findUnique({ where: { username }, select: { id: true } }))) {
        return username;
      }
    }
    throw new Error('Could not allocate an employee username');
  }

  private async allocateEmployeeCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < MAX_ALLOCATION_SKIPS; i += 1) {
      const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('employee_code_seq') AS n`;
      const employeeCode = `BM-EMP-${String(rows[0]?.n).padStart(4, '0')}`;
      if (!(await tx.employee.findUnique({ where: { employeeCode }, select: { id: true } }))) {
        return employeeCode;
      }
    }
    throw new Error('Could not allocate an employee code');
  }

  /** A Patia department on a Saheed Nagar employee makes the roster nonsense. */
  private async assertDepartmentBelongs(departmentId: string | null, outletId: string) {
    if (!departmentId) return;
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department || department.outletId !== outletId) {
      throw DomainError.badRequest(
        ERROR_CODES.COMMON_VALIDATION_FAILED,
        'That department belongs to a different outlet',
      );
    }
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.EMPLOYEE_NOT_FOUND,
      'That employee does not exist',
    );
  }
}

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;

export function toView(e: EmployeeRow) {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    phone: e.phone,
    outletId: e.outletId,
    outletCode: e.outlet.code,
    departmentId: e.departmentId,
    departmentName: e.department?.name ?? null,
    designation: e.designation,
    joinedOn: e.joinedOn.toISOString().slice(0, 10),
    exitedOn: e.exitedOn?.toISOString().slice(0, 10) ?? null,
    status: e.status,
    eligibleForWorkflows: e.eligibleForWorkflows,
    user: e.user
      ? {
          id: e.user.id,
          username: e.user.username,
          roleKey: e.user.roleKey,
          status: e.user.status,
          // Never the password or its hash: only whether a change is still owed.
          mustReset: e.user.mustReset,
          lastLoginAt: e.user.lastLoginAt?.toISOString() ?? null,
        }
      : null,
  };
}
