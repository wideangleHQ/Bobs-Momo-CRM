import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTENDANCE_WINDOW_DAYS,
  ERROR_CODES,
  businessDateOffset,
  paginate,
  toBusinessDate,
  type AttendanceSummaryQuery,
  type EditPunchDto,
  type ListAttendanceQuery,
  type PunchDto,
  type StartBreakDto,
  type VerificationQueueQuery,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { narrowOutlets as narrow } from '../../common/types/request';
import { summariseAttendance } from './attendance-summary';
import { haversineMetres, withinGeofence } from './geofence';

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
    // A self-scoped grant can never backdate. Before this, `at` alone flipped the
    // punch to a MANAGER_EDIT entry, so any employee could file their own time.
    if (scope.selfEmployeeId && dto.at) {
      throw DomainError.forbidden('Only a manager can set the punch time');
    }
    const employee = await this.resolveEmployee(dto.employeeId, user, scope);
    const isManagerEntry =
      !scope.selfEmployeeId &&
      Boolean(dto.at || (dto.employeeId && dto.employeeId !== user.employeeId));
    const at = isManagerEntry && dto.at ? new Date(dto.at) : new Date();
    assertNotFuture(at);
    const businessDate = toBusinessDate(at);
    const evidence = isManagerEntry ? null : await this.checkGeofence(employee, dto.location);

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

      // Lock the day row, not just the punches: on a first punch there are no
      // punch rows yet, so two simultaneous INs would both pass the check below.
      await tx.$queryRaw`SELECT "id" FROM "AttendanceDay" WHERE "id" = ${day.id}::uuid FOR UPDATE`;
      const { verificationStatus } = await tx.attendanceDay.findUniqueOrThrow({
        where: { id: day.id },
        select: { verificationStatus: true },
      });
      // A rejected day is closed to the employee. Reinstating it is a manager's
      // decision (SRS A2), so a self punch cannot quietly reopen it.
      if (!isManagerEntry && verificationStatus === 'REJECTED') {
        throw DomainError.conflict(
          ERROR_CODES.ATTENDANCE_DAY_REJECTED,
          'This day was rejected. Ask your manager to review it.',
        );
      }
      const punches = await tx.$queryRaw<PunchRow[]>`
        SELECT "id", "direction", "punchedAt"
        FROM "AttendancePunch"
        WHERE "attendanceDayId" = ${day.id}::uuid
        ORDER BY "punchedAt" ASC
        FOR UPDATE`;

      const last = punches.at(-1);
      // Checking out mid-break would leave a break with no end. Never invent
      // one: make the employee end it.
      if (!isManagerEntry && dto.direction === 'OUT') {
        const openBreak = await tx.breakLog.findFirst({
          where: { attendanceDayId: day.id, endedAt: null },
          select: { id: true },
        });
        if (openBreak) {
          throw DomainError.conflict(
            ERROR_CODES.ATTENDANCE_BREAK_STILL_OPEN,
            'End your break before punching out',
          );
        }
      }
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
          ...(evidence
            ? {
                latitude: evidence.latitude,
                longitude: evidence.longitude,
                accuracyM: evidence.accuracyM,
                distanceM: evidence.distanceM,
              }
            : {}),
        },
      });

      // The first punch of a day becomes a submission awaiting a manager. The
      // outbox row commits or rolls back with it, so a manager is never told
      // about a punch that does not exist.
      if (verificationStatus === null) {
        await tx.attendanceDay.update({
          where: { id: day.id },
          data: { verificationStatus: 'PENDING' },
        });
        if (!isManagerEntry) {
          await tx.outboxEvent.create({
            data: {
              eventKey: 'ATTENDANCE_SUBMITTED',
              aggregateType: 'AttendanceDay',
              aggregateId: day.id,
              payload: {
                employeeId: employee.id,
                employeeName: employee.fullName,
                outletId: employee.outletId,
                businessDate,
              },
            },
          });
        }
      }
      if (isManagerEntry) {
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            actorLabel: user.sub,
            action: 'workforce.attendance.manual_punch',
            entityType: 'AttendanceDay',
            entityId: day.id,
            outletId: employee.outletId,
            after: {
              direction: dto.direction,
              punchedAt: at.toISOString(),
              reason: dto.reason ?? null,
            } as Prisma.InputJsonValue,
          },
        });
      }

      const updated = await this.recompute(tx, day.id, employee.id, businessDate);
      return {
        attendanceDay: updated,
        punch: {
          id: punch.id,
          direction: punch.direction,
          punchedAt: punch.punchedAt.toISOString(),
          source: punch.source,
        },
        location: evidence
          ? { distanceM: Math.round(evidence.distanceM), radiusM: evidence.radiusM }
          : null,
      };
    });
  }

  /**
   * Authoritative location check for a self punch. The device coordinates are
   * input, never proof: the outlet comes from the employee row, not the request.
   */
  private async checkGeofence(
    employee: { outletId: string },
    location: PunchDto['location'],
  ) {
    const outlet = await this.prisma.outlet.findUniqueOrThrow({
      where: { id: employee.outletId },
      select: { isActive: true, latitude: true, longitude: true, geofenceRadiusM: true, name: true },
    });
    if (!outlet.isActive) {
      throw DomainError.conflict(
        ERROR_CODES.ATTENDANCE_OUTLET_INACTIVE,
        `${outlet.name} is not active, so attendance cannot be recorded there`,
      );
    }
    if (outlet.latitude === null || outlet.longitude === null || outlet.geofenceRadiusM === null) {
      throw DomainError.conflict(
        ERROR_CODES.ATTENDANCE_OUTLET_NOT_CONFIGURED,
        `${outlet.name} has no attendance location set. Ask an administrator.`,
      );
    }
    if (!location) {
      throw DomainError.badRequest(
        ERROR_CODES.ATTENDANCE_LOCATION_REQUIRED,
        'Your location is required to punch. Allow location access and try again.',
      );
    }

    const distanceM = haversineMetres(location, {
      latitude: outlet.latitude,
      longitude: outlet.longitude,
    });
    if (!withinGeofence(distanceM, outlet.geofenceRadiusM)) {
      throw DomainError.conflict(
        ERROR_CODES.ATTENDANCE_OUTSIDE_GEOFENCE,
        `You are ${Math.round(distanceM)} m from ${outlet.name}. Punching is allowed within ${outlet.geofenceRadiusM} m.`,
        { distanceM: Math.round(distanceM), radiusM: outlet.geofenceRadiusM },
      );
    }
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyM: location.accuracyM ?? null,
      distanceM,
      radiusM: outlet.geofenceRadiusM,
    };
  }

  async startBreak(dto: StartBreakDto, user: AuthedUser, scope: RequestScope) {
    const employee = await this.resolveEmployee(undefined, user, scope);
    const businessDate = toBusinessDate();

    return this.prisma.$transaction(async (tx) => {
      await this.lockDay(tx, employee.id, businessDate);
      const day = await tx.attendanceDay.findUnique({
        where: {
          employeeId_businessDate: {
            employeeId: employee.id,
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          },
        },
        include: { punches: { orderBy: { punchedAt: 'asc' } }, breaks: true },
      });
      this.assertNotRejected(day?.verificationStatus);
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
      await this.lockDay(tx, employee.id, businessDate);
      const day = await tx.attendanceDay.findUnique({
        where: {
          employeeId_businessDate: {
            employeeId: employee.id,
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          },
        },
        include: { breaks: true },
      });
      this.assertNotRejected(day?.verificationStatus);
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
      assertNotFuture(punchedAt);
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
    const windowStart = rollingWindowStart();
    if (query.from && query.from < windowStart) {
      throw DomainError.badRequest(
        ERROR_CODES.ATTENDANCE_WINDOW_EXCEEDED,
        `Attendance history covers the last ${ATTENDANCE_WINDOW_DAYS} days, from ${windowStart}`,
      );
    }
    const where: Prisma.AttendanceDayWhereInput = {
      outletId: { in: narrow(query.outletId, scope) },
      ...(scope.selfEmployeeId
        ? { employeeId: scope.selfEmployeeId }
        : query.employeeId
          ? { employeeId: query.employeeId }
          : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.verification ? { verificationStatus: query.verification } : {}),
      businessDate: {
        gte: new Date(`${query.from ?? windowStart}T00:00:00.000Z`),
        ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
      },
    };

    const [rows, total] = await Promise.all([
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
        verificationStatus: d.verificationStatus,
        verifiedAt: d.verifiedAt?.toISOString() ?? null,
        verificationNote: d.verificationNote,
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
          verificationStatus: day?.verificationStatus ?? null,
          verificationNote: day?.verificationNote ?? null,
        };
      }),
    };
  }

  /** Pending submissions in the caller's outlets, oldest first, never their own. */
  async verificationQueue(query: VerificationQueueQuery, user: AuthedUser, scope: RequestScope) {
    const where: Prisma.AttendanceDayWhereInput = {
      outletId: { in: narrow(query.outletId, scope) },
      verificationStatus: 'PENDING',
      ...(user.employeeId ? { employeeId: { not: user.employeeId } } : {}),
    };
    const [rows, total, outlets] = await Promise.all([
      this.prisma.attendanceDay.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ businessDate: 'asc' }, { firstInAt: 'asc' }],
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          punches: {
            orderBy: { punchedAt: 'asc' },
            select: {
              id: true,
              direction: true,
              punchedAt: true,
              source: true,
              distanceM: true,
              accuracyM: true,
            },
          },
        },
      }),
      this.prisma.attendanceDay.count({ where }),
      this.prisma.outlet.findMany({
        where: { id: { in: scope.outletIds } },
        select: { id: true, code: true, geofenceRadiusM: true },
      }),
    ]);
    const outletById = new Map(outlets.map((o) => [o.id, o]));

    return paginate(
      rows.map((d) => {
        // Only the measured distance is shown, never the coordinates.
        const located = d.punches.find((p) => p.distanceM !== null);
        return {
          id: d.id,
          employeeId: d.employeeId,
          employeeName: d.employee.fullName,
          employeeCode: d.employee.employeeCode,
          outletCode: outletById.get(d.outletId)?.code ?? null,
          businessDate: d.businessDate.toISOString().slice(0, 10),
          firstInAt: d.firstInAt?.toISOString() ?? null,
          lastOutAt: d.lastOutAt?.toISOString() ?? null,
          workedMins: d.workedMins,
          breakMins: d.breakMins,
          lateMins: d.lateMins,
          punches: d.punches.map((p) => ({
            id: p.id,
            direction: p.direction,
            punchedAt: p.punchedAt.toISOString(),
            source: p.source,
          })),
          location: located
            ? {
                distanceM: Math.round(located.distanceM ?? 0),
                accuracyM: located.accuracyM === null ? null : Math.round(located.accuracyM),
                radiusM: outletById.get(d.outletId)?.geofenceRadiusM ?? null,
              }
            : null,
        };
      }),
      total,
      query,
    );
  }

  /**
   * One decision per submission. The conditional update is the lock: of two
   * managers deciding at once exactly one matches PENDING and the other gets a
   * 409. The audit row and the employee notification are written in the same
   * transaction, so they exist if and only if the decision does.
   */
  async decide(
    id: string,
    to: 'VERIFIED' | 'REJECTED',
    note: string | undefined,
    user: AuthedUser,
    scope: RequestScope,
  ) {
    const day = await this.prisma.attendanceDay.findUnique({
      where: { id },
      include: { employee: { select: { id: true, userId: true, fullName: true } } },
    });
    if (!day || !scope.outletIds.includes(day.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.ATTENDANCE_DAY_NOT_FOUND,
        'That attendance record does not exist',
      );
    }
    // Identity comes from the verified token, never the body.
    if (day.employee.userId === user.sub || day.employeeId === user.employeeId) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.ATTENDANCE_SELF_VERIFY,
        'You cannot verify or reject your own attendance',
      );
    }
    if (day.verificationStatus !== 'PENDING') {
      throw DomainError.conflict(
        ERROR_CODES.ATTENDANCE_NOT_PENDING,
        day.verificationStatus
          ? `That record is already ${day.verificationStatus.toLowerCase()}`
          : 'That record was not submitted for verification',
      );
    }

    const businessDate = day.businessDate.toISOString().slice(0, 10);
    return this.prisma.$transaction(async (tx) => {
      const decidedAt = new Date();
      const claimed = await tx.attendanceDay.updateMany({
        where: { id, verificationStatus: 'PENDING' },
        data: {
          verificationStatus: to,
          verifiedById: user.sub,
          verifiedAt: decidedAt,
          verificationNote: note ?? null,
        },
      });
      if (claimed.count === 0) {
        throw DomainError.conflict(
          ERROR_CODES.ATTENDANCE_NOT_PENDING,
          'That record has already been decided',
        );
      }
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: to === 'VERIFIED' ? 'workforce.attendance.verify' : 'workforce.attendance.reject',
          entityType: 'AttendanceDay',
          entityId: id,
          outletId: day.outletId,
          before: { verificationStatus: 'PENDING' } as Prisma.InputJsonValue,
          after: {
            verificationStatus: to,
            employeeId: day.employeeId,
            businessDate,
            note: note ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventKey: 'ATTENDANCE_DECIDED',
          aggregateType: 'AttendanceDay',
          aggregateId: id,
          payload: {
            employeeId: day.employeeId,
            outletId: day.outletId,
            businessDate,
            status: to,
            note: note ?? null,
          },
        },
      });
      return {
        id,
        employeeId: day.employeeId,
        businessDate,
        verificationStatus: to,
        verifiedAt: decidedAt.toISOString(),
        verificationNote: note ?? null,
      };
    });
  }

  /** The only place the attendance percentage is computed; employee and manager views both read it. */
  async summary(query: AttendanceSummaryQuery, scope: RequestScope) {
    if (scope.selfEmployeeId && query.employeeId && query.employeeId !== scope.selfEmployeeId) {
      throw DomainError.notFound();
    }
    const employeeId = scope.selfEmployeeId ?? query.employeeId;
    if (!employeeId) {
      throw DomainError.badRequest(ERROR_CODES.COMMON_VALIDATION_FAILED, 'Say which employee to summarise');
    }
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, outletId: true, joinedOn: true, exitedOn: true },
    });
    if (!employee || !scope.outletIds.includes(employee.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.EMPLOYEE_NOT_FOUND,
        'That employee does not exist',
      );
    }

    const today = toBusinessDate();
    const windowStart = rollingWindowStart();
    const from = query.from ?? windowStart;
    const to = query.to ?? today;
    if (from < windowStart) {
      throw DomainError.badRequest(
        ERROR_CODES.ATTENDANCE_WINDOW_EXCEEDED,
        `Attendance history covers the last ${ATTENDANCE_WINDOW_DAYS} days, from ${windowStart}`,
      );
    }
    if (from > to) {
      throw DomainError.badRequest(ERROR_CODES.COMMON_VALIDATION_FAILED, 'From must not be after to');
    }

    const lo = new Date(`${from}T00:00:00.000Z`);
    const hi = new Date(`${to}T00:00:00.000Z`);
    const [days, shifts, leave] = await Promise.all([
      this.prisma.attendanceDay.findMany({
        where: { employeeId, businessDate: { gte: lo, lte: hi } },
        select: { businessDate: true, status: true, verificationStatus: true },
      }),
      this.prisma.shift.findMany({
        where: { employeeId, status: 'SCHEDULED', shiftDate: { gte: lo, lte: hi } },
        select: { shiftDate: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId, status: 'APPROVED', fromDate: { lte: hi }, toDate: { gte: lo } },
        select: { fromDate: true, toDate: true, dayCount: true },
      }),
    ]);

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return {
      employeeId,
      ...summariseAttendance({
        from,
        to,
        today,
        joinedOn: iso(employee.joinedOn),
        exitedOn: employee.exitedOn ? iso(employee.exitedOn) : null,
        scheduledDates: shifts.map((x) => iso(x.shiftDate)),
        days: days.map((d) => ({
          businessDate: iso(d.businessDate),
          status: d.status,
          verificationStatus: d.verificationStatus,
        })),
        approvedLeave: leave.map((l) => ({
          fromDate: iso(l.fromDate),
          toDate: iso(l.toDate),
          halfDay: l.dayCount.lt(1),
        })),
      }),
    };
  }

  /** Serialises everything that touches one employee-day, including breaks. */
  private async lockDay(
    tx: Prisma.TransactionClient,
    employeeId: string,
    businessDate: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "AttendanceDay"
      WHERE "employeeId" = ${employeeId}::uuid AND "businessDate" = ${businessDate}::date
      FOR UPDATE`;
  }

  private assertNotRejected(status: string | null | undefined): void {
    if (status === 'REJECTED') {
      throw DomainError.conflict(
        ERROR_CODES.ATTENDANCE_DAY_REJECTED,
        'This day was rejected. Ask your manager to review it.',
      );
    }
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
    // Only a manager acting for somebody else may touch an exited employee's
    // record. Naming your own id must not skip the check.
    const forSomeoneElse = employeeId !== undefined && employeeId !== user.employeeId;
    if (employee.status === 'EXITED' && !forSomeoneElse) {
      throw DomainError.conflict(
        ERROR_CODES.ATTENDANCE_EMPLOYEE_EXITED,
        'This employee record is no longer active',
      );
    }
    return employee;
  }
}

// A manager sets the time of a correction, but attendance cannot be in the
// future. A minute of allowance covers a manager's clock running ahead.
const FUTURE_ALLOWANCE_MS = 60_000;

function assertNotFuture(at: Date): void {
  if (at.getTime() > Date.now() + FUTURE_ALLOWANCE_MS) {
    throw DomainError.badRequest(
      ERROR_CODES.ATTENDANCE_FUTURE_PUNCH,
      'A punch cannot be set in the future',
    );
  }
}

/** Today plus the previous 364 business dates (SRS Amendment v1.1 A7). */
function rollingWindowStart(): string {
  return businessDateOffset(-(ATTENDANCE_WINDOW_DAYS - 1)).toISOString().slice(0, 10);
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
