import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  type CreateEmployeeDto,
  type ExitEmployeeDto,
  type ListEmployeesQuery,
  type UpdateEmployeeDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestScope } from '../../common/types/request';

const EMPLOYEE_INCLUDE = {
  outlet: { select: { id: true, code: true } },
  department: { select: { id: true, name: true } },
  user: { select: { id: true, username: true, roleKey: true, status: true } },
} satisfies Prisma.EmployeeInclude;

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

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
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
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

  async create(dto: CreateEmployeeDto, scope: RequestScope) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();
    await this.assertUserFree(dto.userId ?? null, null);
    await this.assertDepartmentBelongs(dto.departmentId ?? null, dto.outletId);

    const employee = await this.prisma.$transaction(async (tx) => {
      // Allocated inside the transaction so two HR users adding staff at the
      // same moment cannot both take BM-EMP-0013.
      const rows = await tx.$queryRaw<{ code: string }[]>`
        SELECT "employeeCode" AS code FROM "Employee"
        ORDER BY "employeeCode" DESC LIMIT 1`;
      const last = Number(rows[0]?.code.split('-')[2] ?? 0);
      return tx.employee.create({
        data: {
          employeeCode: `BM-EMP-${String(last + 1).padStart(4, '0')}`,
          fullName: dto.fullName,
          phone: dto.phone,
          outletId: dto.outletId,
          departmentId: dto.departmentId ?? null,
          designation: dto.designation ?? null,
          joinedOn: new Date(`${dto.joinedOn}T00:00:00.000Z`),
          userId: dto.userId ?? null,
        },
        include: EMPLOYEE_INCLUDE,
      });
    });

    return toView(employee);
  }

  async update(id: string, dto: UpdateEmployeeDto, scope: RequestScope) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) throw this.notFound();
    if (dto.userId !== undefined) await this.assertUserFree(dto.userId ?? null, id);

    const outletId = dto.outletId ?? employee.outletId;
    if (dto.outletId && !scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();
    if (dto.departmentId !== undefined) {
      await this.assertDepartmentBelongs(dto.departmentId ?? null, outletId);
    }

    await this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.departmentId === null ? { departmentId: null } : {}),
        ...(dto.userId === null ? { userId: null } : {}),
      },
    });
    return this.get(id, scope);
  }

  /**
   * An exit is a status change, never a delete. Attendance, tasks and leave all
   * point at this row, and the history has to stay readable after the person
   * leaves.
   */
  async exit(id: string, dto: ExitEmployeeDto, scope: RequestScope) {
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
          actorId: null,
          actorLabel: 'system',
          action: 'workforce.employee.exit',
          entityType: 'Employee',
          entityId: id,
          after: { exitedOn: dto.exitedOn, reason: dto.reason } as Prisma.InputJsonValue,
        },
      });
    });

    return this.get(id, scope);
  }

  private async assertUserFree(userId: string | null, exceptEmployeeId: string | null) {
    if (!userId) return;
    const clash = await this.prisma.employee.findFirst({
      where: { userId, ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}) },
      select: { id: true, fullName: true },
    });
    if (clash) {
      throw DomainError.conflict(
        ERROR_CODES.EMPLOYEE_USER_ALREADY_LINKED,
        `That login already belongs to ${clash.fullName}`,
      );
    }
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

export function narrow(asked: string | undefined, scope: RequestScope): string[] {
  if (!asked) return scope.outletIds;
  const allowed = scope.outletIds.filter((id) => id === asked);
  if (allowed.length === 0) throw DomainError.notFound();
  return allowed;
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
    user: e.user ? { id: e.user.id, username: e.user.username, roleKey: e.user.roleKey } : null,
  };
}
