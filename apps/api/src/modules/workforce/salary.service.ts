import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type CreateSalaryDto } from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';

/**
 * Storage only. No payroll computation, no payslips, no statutory deductions:
 * that is decision 4 in chapter 04 and it is out of Phase 1 scope. This is a
 * filing cabinet with a lock on it.
 *
 * History is effective-dated rather than overwritten, so "what was Raju paid in
 * March" stays answerable after a raise.
 */
@Injectable()
export class SalaryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(employeeId: string, scope: RequestScope) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.EMPLOYEE_NOT_FOUND,
        'That employee does not exist',
      );
    }

    const rows = await this.prisma.salaryRecord.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });

    return {
      employeeId,
      employeeName: employee.fullName,
      records: rows.map((r) => ({
        id: r.id,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null,
        monthlyCtc: r.monthlyCtc.toFixed(2),
        basic: r.basic?.toFixed(2) ?? null,
        allowances: r.allowances?.toFixed(2) ?? null,
        note: r.note,
        isCurrent: r.effectiveTo === null,
      })),
    };
  }

  /**
   * A new record closes the open one the day before it starts, rather than
   * editing it. Two open-ended rows would make "what are they paid now"
   * ambiguous, and an edit would erase the answer to "what were they paid then".
   */
  async create(dto: CreateSalaryDto, user: AuthedUser, scope: RequestScope) {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.EMPLOYEE_NOT_FOUND,
        'That employee does not exist',
      );
    }

    const effectiveFrom = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
    const clash = await this.prisma.salaryRecord.findFirst({
      where: { employeeId: dto.employeeId, effectiveFrom: { gte: effectiveFrom } },
    });
    if (clash) {
      throw DomainError.conflict(
        ERROR_CODES.SALARY_PERIOD_OVERLAP,
        'A salary record already starts on or after that date',
        { existingId: clash.id },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.salaryRecord.updateMany({
        where: { employeeId: dto.employeeId, effectiveTo: null },
        data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) },
      });
      await tx.salaryRecord.create({
        data: {
          employeeId: dto.employeeId,
          effectiveFrom,
          monthlyCtc: new Prisma.Decimal(dto.monthlyCtc.toFixed(2)),
          basic: dto.basic === undefined ? null : new Prisma.Decimal(dto.basic.toFixed(2)),
          allowances:
            dto.allowances === undefined ? null : new Prisma.Decimal(dto.allowances.toFixed(2)),
          note: dto.note ?? null,
          createdById: user.sub,
        },
      });
      // Every read and write of a salary figure is auditable, because this is
      // the one table where a quiet change is a firing offence.
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: 'workforce.salary.write',
          entityType: 'Employee',
          entityId: dto.employeeId,
          outletId: employee.outletId,
          after: { effectiveFrom: dto.effectiveFrom } as Prisma.InputJsonValue,
        },
      });
    });

    return this.list(dto.employeeId, scope);
  }
}
