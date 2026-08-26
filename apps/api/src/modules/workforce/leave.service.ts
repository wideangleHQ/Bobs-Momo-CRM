import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type LeaveStatus } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  toBusinessDate,
  type CreateLeaveDto,
  type DecideLeaveDto,
  type ListLeaveQuery,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { narrow } from './employees.service';

// A typo like 2036-09-01 should not leave a request sitting in the pending list
// for ten years.
const FORWARD_WINDOW_DAYS = 180;

const LEAVE_INCLUDE = {
  employee: {
    select: { id: true, fullName: true, employeeCode: true, outletId: true },
  },
} satisfies Prisma.LeaveRequestInclude;

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListLeaveQuery, scope: RequestScope) {
    const where: Prisma.LeaveRequestWhereInput = {
      employee: { outletId: { in: narrow(query.outletId, scope) } },
      ...(scope.selfEmployeeId
        ? { employeeId: scope.selfEmployeeId }
        : query.employeeId
          ? { employeeId: query.employeeId }
          : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from ? { toDate: { gte: new Date(`${query.from}T00:00:00.000Z`) } } : {}),
      ...(query.to ? { fromDate: { lte: new Date(`${query.to}T00:00:00.000Z`) } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ status: 'asc' }, { fromDate: 'desc' }],
        include: LEAVE_INCLUDE,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return paginate(rows.map(toView), total, query);
  }

  async get(id: string, scope: RequestScope) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: LEAVE_INCLUDE,
    });
    if (!leave || !scope.outletIds.includes(leave.employee.outletId)) throw this.notFound();
    if (scope.selfEmployeeId && leave.employeeId !== scope.selfEmployeeId) throw this.notFound();
    return toView(leave);
  }

  async create(dto: CreateLeaveDto, user: AuthedUser, scope: RequestScope, canDecide: boolean) {
    const employeeId = dto.employeeId ?? scope.selfEmployeeId ?? user.employeeId;
    if (!employeeId) {
      throw DomainError.forbidden('This account is not linked to an employee record');
    }
    if (dto.employeeId && scope.selfEmployeeId && dto.employeeId !== scope.selfEmployeeId) {
      throw DomainError.notFound();
    }

    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || !scope.outletIds.includes(employee.outletId)) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.EMPLOYEE_NOT_FOUND,
        'That employee does not exist',
      );
    }

    const today = toBusinessDate();
    // An employee cannot backdate their own leave, because that turns an
    // absence into approved leave after the fact. A manager can, because sick
    // leave is genuinely filed the next day.
    if (dto.fromDate < today && !canDecide) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.LEAVE_PAST_DATE,
        'That date has already passed. Ask your manager to file it',
      );
    }
    if (daysBetween(today, dto.fromDate) > FORWARD_WINDOW_DAYS) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.LEAVE_WINDOW_EXCEEDED,
        `Leave can be requested up to ${FORWARD_WINDOW_DAYS} days ahead`,
      );
    }

    // Rejected and cancelled rows do not block a resubmission, which is what
    // you want after a rejected request gets reworked.
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: new Date(`${dto.toDate}T00:00:00.000Z`) },
        toDate: { gte: new Date(`${dto.fromDate}T00:00:00.000Z`) },
      },
    });
    if (overlap) {
      throw DomainError.conflict(
        ERROR_CODES.LEAVE_OVERLAP,
        'That overlaps leave already on file',
        { existingId: overlap.id, status: overlap.status },
      );
    }

    const dayCount = dto.halfDay ? 0.5 : daysBetween(dto.fromDate, dto.toDate) + 1;

    const created = await this.prisma.$transaction(async (tx) => {
      const leave = await tx.leaveRequest.create({
        data: {
          employeeId,
          type: dto.type,
          fromDate: new Date(`${dto.fromDate}T00:00:00.000Z`),
          toDate: new Date(`${dto.toDate}T00:00:00.000Z`),
          dayCount: new Prisma.Decimal(dayCount.toFixed(1)),
          reason: dto.reason,
        },
        include: LEAVE_INCLUDE,
      });
      await tx.outboxEvent.create({
        data: {
          eventKey: 'LEAVE_REQUESTED',
          aggregateType: 'LeaveRequest',
          aggregateId: leave.id,
          payload: {
            employeeId,
            employeeName: employee.fullName,
            outletId: employee.outletId,
            type: dto.type,
            fromDate: dto.fromDate,
            toDate: dto.toDate,
            dayCount,
          },
        },
      });
      return leave;
    });

    return toView(created);
  }

  async decide(
    id: string,
    to: Extract<LeaveStatus, 'APPROVED' | 'REJECTED'>,
    dto: DecideLeaveDto,
    user: AuthedUser,
    scope: RequestScope,
  ) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: LEAVE_INCLUDE,
    });
    if (!leave || !scope.outletIds.includes(leave.employee.outletId)) throw this.notFound();
    if (leave.status !== 'PENDING') {
      throw DomainError.conflict(
        ERROR_CODES.LEAVE_NOT_PENDING,
        `That request is already ${leave.status.toLowerCase()}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional on PENDING inside the transaction. The check above runs
      // outside it, so a manager approving while another rejects had both reads
      // see PENDING: the row landed on one status while writeLeaveDays had
      // already painted ON_LEAVE across the board for the other.
      const claimed = await tx.leaveRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: to,
          decidedById: user.sub,
          decidedAt: new Date(),
          decisionNote: dto.decisionNote ?? null,
        },
      });
      if (claimed.count === 0) {
        throw DomainError.conflict(
          ERROR_CODES.LEAVE_NOT_PENDING,
          'That request has already been decided',
        );
      }
      const row = await tx.leaveRequest.findUniqueOrThrow({
        where: { id },
        include: LEAVE_INCLUDE,
      });

      // Approval is where leave stops being a form and starts changing what the
      // rest of the system believes: the attendance board must show ON_LEAVE
      // rather than ABSENT for those dates.
      if (to === 'APPROVED') {
        await this.writeLeaveDays(tx, row.employeeId, row.employee.outletId, row.fromDate, row.toDate);
      }

      await tx.outboxEvent.create({
        data: {
          eventKey: 'LEAVE_DECIDED',
          aggregateType: 'LeaveRequest',
          aggregateId: id,
          payload: {
            employeeId: row.employeeId,
            outletId: row.employee.outletId,
            status: to,
            fromDate: row.fromDate.toISOString().slice(0, 10),
            toDate: row.toDate.toISOString().slice(0, 10),
            decidedById: user.sub,
          },
        },
      });
      return row;
    });

    return toView(updated);
  }

  async cancel(id: string, user: AuthedUser, scope: RequestScope, canDecide: boolean) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: LEAVE_INCLUDE,
    });
    if (!leave || !scope.outletIds.includes(leave.employee.outletId)) throw this.notFound();
    if (scope.selfEmployeeId && leave.employeeId !== scope.selfEmployeeId) throw this.notFound();

    if (leave.status === 'PENDING') {
      // The requester withdraws their own. No notification: nobody acted on it.
    } else if (leave.status === 'APPROVED') {
      if (!canDecide) throw DomainError.forbidden('Only a manager can cancel approved leave');
      const today = new Date(`${toBusinessDate()}T00:00:00.000Z`);
      if (leave.fromDate <= today) {
        throw DomainError.conflict(
          ERROR_CODES.LEAVE_ALREADY_STARTED,
          'That leave has already started',
        );
      }
    } else {
      throw DomainError.conflict(
        ERROR_CODES.LEAVE_NOT_PENDING,
        `That request is already ${leave.status.toLowerCase()}`,
      );
    }

    const wasApproved = leave.status === 'APPROVED';
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', decidedById: user.sub, decidedAt: new Date() },
        include: LEAVE_INCLUDE,
      });
      if (wasApproved) {
        await tx.attendanceDay.updateMany({
          where: {
            employeeId: row.employeeId,
            businessDate: { gte: row.fromDate, lte: row.toDate },
            status: 'ON_LEAVE',
          },
          data: { status: 'ABSENT' },
        });
        await tx.outboxEvent.create({
          data: {
            eventKey: 'LEAVE_DECIDED',
            aggregateType: 'LeaveRequest',
            aggregateId: id,
            payload: {
              employeeId: row.employeeId,
              outletId: row.employee.outletId,
              status: 'CANCELLED',
              decidedById: user.sub,
            },
          },
        });
      }
      return row;
    });

    return toView(updated);
  }

  private async writeLeaveDays(
    tx: Prisma.TransactionClient,
    employeeId: string,
    outletId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<void> {
    for (let d = new Date(fromDate); d <= toDate; d = new Date(d.getTime() + 86_400_000)) {
      // A day the employee actually worked is left alone. Somebody who came in
      // anyway is present, whatever the form says. The upsert used to overwrite
      // unconditionally, so a manager filing backdated sick leave across a day
      // the cook had worked turned PRESENT into ON_LEAVE, and the attendance
      // consistency report drops ON_LEAVE from its denominator, so the worked
      // day vanished from the record with nothing to recompute it.
      const marked = await tx.attendanceDay.updateMany({
        where: { employeeId, businessDate: d, status: 'ABSENT' },
        data: { status: 'ON_LEAVE' },
      });
      if (marked.count === 0) {
        await tx.attendanceDay.upsert({
          where: { employeeId_businessDate: { employeeId, businessDate: d } },
          create: { employeeId, outletId, businessDate: d, status: 'ON_LEAVE' },
          update: {},
        });
      }
    }
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.LEAVE_NOT_FOUND,
      'That request does not exist',
    );
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

type LeaveRow = Prisma.LeaveRequestGetPayload<{ include: typeof LEAVE_INCLUDE }>;

function toView(l: LeaveRow) {
  return {
    id: l.id,
    employeeId: l.employeeId,
    employeeName: l.employee.fullName,
    employeeCode: l.employee.employeeCode,
    outletId: l.employee.outletId,
    type: l.type,
    fromDate: l.fromDate.toISOString().slice(0, 10),
    toDate: l.toDate.toISOString().slice(0, 10),
    dayCount: l.dayCount.toFixed(1),
    reason: l.reason,
    status: l.status,
    decidedById: l.decidedById,
    decidedAt: l.decidedAt?.toISOString() ?? null,
    decisionNote: l.decisionNote,
    createdAt: l.createdAt.toISOString(),
  };
}
