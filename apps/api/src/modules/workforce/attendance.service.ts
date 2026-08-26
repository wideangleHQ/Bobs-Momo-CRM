import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  toBusinessDate,
  type EditPunchDto,
  type ListAttendanceQuery,
  type PunchDto,
  type StartBreakDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { narrowOutlets as narrow } from '../../common/types/request';

// Lateness is only meaningful against a commitment, and ten minutes of it is
// forgiven because a bus is a bus.
const LATE_GRACE_MINS = 10;
const HALF_DAY_MINS = 240;
const FULL_DAY_MINS = 360;

interface PunchRow {
  id: string;
  direction: string;
  punchedAt: Date;
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async punch(dto: PunchDto, user: AuthedUser, scope: RequestScope) {
    const employee = await this.resolveEmployee(dto.employeeId, user, scope);
    const isManagerEntry = Boolean(dto.employeeId ?? dto.at);
    const at = dto.at ? new Date(dto.at) : new Date();
    const businessDate = toBusinessDate(at);

    return this.prisma.$transaction(async (tx) => {
      const day = await tx.attendanceDay.upsert({
        where: {
          employeeId_businessDate: {
            employeeId: employee.id,
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          },
        },
        create: {
          employeeId: employee.id,
          outletId: employee.outletId,
          businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          status: 'ABSENT',
        },
        update: {},
      });

      // FOR UPDATE serialises two taps that arrive eighty milliseconds apart.
      const punches = await tx.$queryRaw<PunchRow[]>`
        SELECT "id", "direction", "punchedAt"
        FROM "AttendancePunch"
        WHERE "attendanceDayId" = ${day.id}::uuid
        ORDER BY "punchedAt" ASC
        FOR UPDATE`;

      const last = punches.at(-1);
      if (dto.direction === 'IN' && last?.direction === 'IN') {
        throw DomainError.conflict(
          ERROR_CODES.ATTENDANCE_ALREADY_PUNCHED_IN,
          `Already punched in at ${istTime(last.punchedAt)}`,
        );
      }
      if (dto.direction === 'OUT' && last?.direction !== 'IN') {
        throw DomainError.conflict(
          ERROR_CODES.ATTENDANCE_NOT_PUNCHED_IN,
          'Punch in before punching out',
        );
      }

      const punch = await tx.attendancePunch.create({
        data: {
          attendanceDayId: day.id,
          direction: dto.direction,
          punchedAt: at,
          source: isManagerEntry ? 'MANAGER_EDIT' : 'WEB',
          editedById: isManagerEntry ? user.sub : null,
          editReason: dto.reason ?? null,
        },
      });

      const updated = await this.recompute(tx, day.id, employee.id, businessDate);
      return { attendanceDay: updated, punch: { id: punch.id, direction: punch.direction, punchedAt: punch.punchedAt.toISOString() } };
    });
  }

  async startBreak(dto: StartBreakDto, user: AuthedUser, scope: RequestScope) {
    const employee = await this.resolveEmployee(undefined, user, scope);
    const businessDate = toBusinessDate();

    return this.prisma.$transaction(async (tx) => {
      const day = await tx.attendanceDay.findUnique({
        where: {
          employeeId_businessDate: {
            employeeId: employee.id,
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          },
        },
        include: { punches: { orderBy: { punchedAt: 'asc' } }, breaks: true },
      });
      if (!day || day.punches.at(-1)?.direction !== 'IN') {
        throw DomainError.conflict(
          ERROR_CODES.ATTENDANCE_NOT_PUNCHED_IN,
          'Punch in before starting a break',
        );
      }
      if (day.breaks.some((b) => b.endedAt === null)) {
        throw DomainError.conflict(
          ERROR_CODES.ATTENDANCE_BREAK_ALREADY_OPEN,
          'A break is already running',
        );
      }

      await tx.breakLog.create({
        data: { attendanceDayId: day.id, startedAt: new Date(), reason: dto.reason ?? null },
      });
      return this.recompute(tx, day.id, employee.id, businessDate);
    });
  }

  async endBreak(user: AuthedUser, scope: RequestScope) {
    const employee = await this.resolveEmployee(undefined, user, scope);
    const businessDate = toBusinessDate();

    return this.prisma.$transaction(async (tx) => {
      const day = await tx.attendanceDay.findUnique({
        where: {
          employeeId_businessDate: {
            employeeId: employee.id,
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          },
        },
        include: { breaks: true },
      });
      const open = day?.breaks.find((b) => b.endedAt === null);
      if (!day || !open) {
        throw DomainError.conflict(ERROR_CODES.ATTENDANCE_BREAK_NOT_OPEN, 'No break is running');
      }

      const endedAt = new Date();
      await tx.breakLog.update({
        where: { id: open.id },
        data: { endedAt, durationMins: diffMins(open.startedAt, endedAt) },
      });
      return this.recompute(tx, day.id, employee.id, businessDate);
    });
  }

  /**
   * Staff forget to punch out. They punch in on a colleague's phone. If there is
   * no correction path the manager fixes it over WhatsApp and there are two
   * systems of record again. An edit that is attributed, reasoned and audited is
   * a feature; an unattributed one is fraud, so there is no path without an
   * audit row.
   */
  async editPunch(id: string, dto: EditPunchDto, user: AuthedUser, scope: RequestScope) {
    const punch = await this.prisma.attendancePunch.findUnique({
      where: { id },
      include: { day: true },
    });
    if (!punch || !scope.outletIds.includes(punch.day.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.ATTENDANCE_PUNCH_NOT_FOUND,
        'That punch does not exist',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const before = { punchedAt: punch.punchedAt.toISOString(), source: punch.source };
      const punchedAt = new Date(dto.punchedAt);
      await tx.attendancePunch.update({
        where: { id },
        data: {
          punchedAt,
          source: 'MANAGER_EDIT',
          editedById: user.sub,
          editReason: dto.reason,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: 'workforce.attendance.edit',
          entityType: 'AttendancePunch',
          entityId: id,
          outletId: punch.day.outletId,
          before: before as Prisma.InputJsonValue,
          after: { punchedAt: punchedAt.toISOString(), reason: dto.reason } as Prisma.InputJsonValue,
        },
      });
      return this.recompute(
        tx,
        punch.attendanceDayId,
        punch.day.employeeId,
        punch.day.businessDate.toISOString().slice(0, 10),
      );
    });
  }

  async list(query: ListAttendanceQuery, scope: RequestScope) {
    const where: Prisma.AttendanceDayWhereInput = {
      outletId: { in: narrow(query.outletId, scope) },
      ...(scope.selfEmployeeId
        ? { employeeId: scope.selfEmployeeId }
        : query.employeeId
          ? { employeeId: query.employeeId }
          : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            businessDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendanceDay.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ businessDate: 'desc' }],
        include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
      }),
      this.prisma.attendanceDay.count({ where }),
    ]);

    return paginate(
      rows.map((d) => ({
        id: d.id,
        employeeId: d.employeeId,
        employeeName: d.employee.fullName,
        employeeCode: d.employee.employeeCode,
        outletId: d.outletId,
        businessDate: d.businessDate.toISOString().slice(0, 10),
        status: d.status,
        firstInAt: d.firstInAt?.toISOString() ?? null,
        lastOutAt: d.lastOutAt?.toISOString() ?? null,
        workedMins: d.workedMins,
        breakMins: d.breakMins,
        lateMins: d.lateMins,
      })),
      total,
      query,
    );
  }

  /** The live board: every active employee at the outlet with today's state. */
  async today(scope: RequestScope) {
    const businessDate = new Date(`${toBusinessDate()}T00:00:00.000Z`);
    const employees = await this.prisma.employee.findMany({
      where: {
        outletId: { in: scope.outletIds },
        status: 'ACTIVE',
        ...(scope.selfEmployeeId ? { id: scope.selfEmployeeId } : {}),
      },
      orderBy: { fullName: 'asc' },
      include: {
        outlet: { select: { code: true } },
        attendance: {
          where: { businessDate },
          include: { punches: { orderBy: { punchedAt: 'asc' } }, breaks: true },
        },
      },
    });

    return {
      businessDate: businessDate.toISOString().slice(0, 10),
      employees: employees.map((e) => {
        const day = e.attendance[0];
        const lastPunch = day?.punches.at(-1);
        const onBreak = day?.breaks.some((b) => b.endedAt === null) ?? false;
        return {
          employeeId: e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          outletCode: e.outlet.code,
          state: !day || !lastPunch
            ? 'NOT_IN'
            : onBreak
              ? 'ON_BREAK'
              : lastPunch.direction === 'IN'
                ? 'IN'
                : 'OUT',
          status: day?.status ?? 'ABSENT',
          firstInAt: day?.firstInAt?.toISOString() ?? null,
          lastOutAt: day?.lastOutAt?.toISOString() ?? null,
          workedMins: day?.workedMins ?? 0,
          breakMins: day?.breakMins ?? 0,
          lateMins: day?.lateMins ?? 0,
        };
      }),
    };
  }

  /**
   * Recomputes the whole day from its punches every time, rather than adjusting
   * counters. A manager edit three hours later then produces the same answer as
   * if the punch had been right the first time.
   */
  async recompute(
    tx: Prisma.TransactionClient,
    dayId: string,
    employeeId: string,
    businessDate: string,
  ) {
    const [punches, breaks, shift, leave] = await Promise.all([
      tx.attendancePunch.findMany({
        where: { attendanceDayId: dayId },
        orderBy: { punchedAt: 'asc' },
      }),
      tx.breakLog.findMany({ where: { attendanceDayId: dayId } }),
      tx.shift.findFirst({
        where: {
          employeeId,
          shiftDate: new Date(`${businessDate}T00:00:00.000Z`),
          status: 'SCHEDULED',
        },
        orderBy: { startsAt: 'asc' },
      }),
      tx.leaveRequest.findFirst({
        where: {
          employeeId,
          status: 'APPROVED',
          fromDate: { lte: new Date(`${businessDate}T00:00:00.000Z`) },
          toDate: { gte: new Date(`${businessDate}T00:00:00.000Z`) },
        },
      }),
    ]);

    const grossMins = pairedMinutes(punches);
    const breakMins = breaks.reduce(
      (acc, b) => acc + (b.durationMins ?? (b.endedAt ? diffMins(b.startedAt, b.endedAt) : 0)),
      0,
    );
    const workedMins = Math.max(0, grossMins - breakMins);
    const firstInAt = punches.find((p) => p.direction === 'IN')?.punchedAt ?? null;
    const lastOutAt = [...punches].reverse().find((p) => p.direction === 'OUT')?.punchedAt ?? null;

    // No shift rostered means no commitment, so nobody is late. An unrostered
    // employee who turns up and works is not late and is not absent.
    const lateMins =
      shift && firstInAt
        ? Math.max(0, diffMins(shift.startsAt, firstInAt) - LATE_GRACE_MINS)
        : 0;

    const status =
      leave && punches.length === 0
        ? 'ON_LEAVE'
        : workedMins >= FULL_DAY_MINS
          ? 'PRESENT'
          : workedMins >= HALF_DAY_MINS
            ? 'HALF_DAY'
            : punches.length > 0
              ? 'PRESENT'
              : 'ABSENT';

    const updated = await tx.attendanceDay.update({
      where: { id: dayId },
      data: { firstInAt, lastOutAt, workedMins, breakMins, lateMins, status },
      include: { punches: { orderBy: { punchedAt: 'asc' } }, breaks: true },
    });

    return {
      id: updated.id,
      employeeId: updated.employeeId,
      outletId: updated.outletId,
      businessDate,
      status: updated.status,
      firstInAt: updated.firstInAt?.toISOString() ?? null,
      lastOutAt: updated.lastOutAt?.toISOString() ?? null,
      workedMins: updated.workedMins,
      breakMins: updated.breakMins,
      lateMins: updated.lateMins,
      openBreak: updated.breaks.some((b) => b.endedAt === null),
      punches: updated.punches.map((p) => ({
        id: p.id,
        direction: p.direction,
        punchedAt: p.punchedAt.toISOString(),
        source: p.source,
      })),
    };
  }

  private async resolveEmployee(
    employeeId: string | undefined,
    user: AuthedUser,
    scope: RequestScope,
  ) {
    // No employeeId means "me". Supplying one is a manager filing on behalf of
    // somebody, which the SELF-scoped punch grant cannot reach.
    const id = employeeId ?? scope.selfEmployeeId ?? user.employeeId;
    if (!id) {
      throw DomainError.forbidden('This account is not linked to an employee record');
    }
    if (employeeId && scope.selfEmployeeId && employeeId !== scope.selfEmployeeId) {
      throw DomainError.notFound();
    }

    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.EMPLOYEE_NOT_FOUND,
        'That employee does not exist',
      );
    }
    return employee;
  }
}

/** Sums IN/OUT pairs. A trailing unmatched IN contributes nothing until closed. */
function pairedMinutes(punches: PunchRow[]): number {
  let total = 0;
  let openedAt: Date | null = null;
  for (const p of punches) {
    if (p.direction === 'IN') openedAt = p.punchedAt;
    else if (openedAt) {
      total += diffMins(openedAt, p.punchedAt);
      openedAt = null;
    }
  }
  return total;
}

function diffMins(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

function istTime(at: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}
