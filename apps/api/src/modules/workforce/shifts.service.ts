import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  type BulkShiftDto,
  type CreateShiftDto,
  type ListShiftsQuery,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { narrowOutlets as narrow } from '../../common/types/request';

// Times come in as HH:MM in IST and are stored as absolute instants. A shift
// ending at or before it starts is treated as crossing midnight, so 22:00 to
// 06:00 is an eight hour night shift rather than a validation error.
const IST_OFFSET_MINS = 330;

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListShiftsQuery, scope: RequestScope) {
    const where: Prisma.ShiftWhereInput = {
      outletId: { in: narrow(query.outletId, scope) },
      ...(scope.selfEmployeeId
        ? { employeeId: scope.selfEmployeeId }
        : query.employeeId
          ? { employeeId: query.employeeId }
          : {}),
      ...(query.from || query.to
        ? {
            shiftDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.shift.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ shiftDate: 'asc' }, { startsAt: 'asc' }],
        include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
      }),
      this.prisma.shift.count({ where }),
    ]);

    return paginate(rows.map(toView), total, query);
  }

  async create(dto: CreateShiftDto, user: AuthedUser, scope: RequestScope) {
    const shift = await this.createOne(this.prisma, dto, user, scope);
    return toView(shift);
  }

  /** Bulk is all-or-nothing: a roster half applied is worse than none applied. */
  async bulk(dto: BulkShiftDto, user: AuthedUser, scope: RequestScope) {
    const created = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const shift of dto.shifts) {
        rows.push(await this.createOne(tx, shift, user, scope));
      }
      return rows;
    });
    return { created: created.length, shifts: created.map(toView) };
  }

  async remove(id: string, scope: RequestScope) {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift || !scope.outletIds.includes(shift.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.SHIFT_NOT_FOUND,
        'That shift does not exist',
      );
    }
    // Cancelled, not deleted: attendance for the day was judged against it.
    await this.prisma.shift.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { id, status: 'CANCELLED' as const };
  }

  private async createOne(
    client: Prisma.TransactionClient | PrismaService,
    dto: CreateShiftDto,
    user: AuthedUser,
    scope: RequestScope,
  ) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();

    const employee = await client.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.EMPLOYEE_NOT_FOUND,
        'That employee does not exist',
      );
    }

    const startsAt = istInstant(dto.shiftDate, dto.startsAt);
    let endsAt = istInstant(dto.shiftDate, dto.endsAt);
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);

    // Half-open interval: a 14:00 to 22:00 shift does not clash with 22:00 to
    // 06:00, which is exactly how a real handover works.
    const clash = await client.shift.findFirst({
      where: {
        employeeId: dto.employeeId,
        status: 'SCHEDULED',
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (clash) {
      throw DomainError.conflict(
        ERROR_CODES.SHIFT_OVERLAP,
        `${employee.fullName} already has a shift that overlaps this one`,
        { existingShiftId: clash.id },
      );
    }

    return client.shift.create({
      data: {
        employeeId: dto.employeeId,
        outletId: dto.outletId,
        shiftDate: new Date(`${dto.shiftDate}T00:00:00.000Z`),
        startsAt,
        endsAt,
        note: dto.note ?? null,
        createdById: user.sub,
      },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    });
  }
}

function istInstant(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const utcMs = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(utcMs + ((h ?? 0) * 60 + (m ?? 0) - IST_OFFSET_MINS) * 60_000);
}

type ShiftRow = Prisma.ShiftGetPayload<{
  include: { employee: { select: { id: true; fullName: true; employeeCode: true } } };
}>;

function toView(s: ShiftRow) {
  return {
    id: s.id,
    employeeId: s.employeeId,
    employeeName: s.employee.fullName,
    employeeCode: s.employee.employeeCode,
    outletId: s.outletId,
    shiftDate: s.shiftDate.toISOString().slice(0, 10),
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status,
    note: s.note,
  };
}
