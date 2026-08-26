import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_ERRORS,
  type CreateDepartmentDto,
  type CreateOutletDto,
  type ListDepartmentsQuery,
  type UpdateDepartmentDto,
  type UpdateOutletDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { OutletCacheService } from '../../common/outlets/outlet-cache.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestScope } from '../../common/types/request';
import { writeAudit, type Actor } from './audit-writer';

function outletView(o: {
  id: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
  isActive: boolean;
}) {
  return {
    id: o.id,
    code: o.code,
    name: o.name,
    address: o.address,
    timezone: o.timezone,
    isActive: o.isActive,
  };
}

@Injectable()
export class AdminOutletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: OutletCacheService,
  ) {}

  /**
   * Deliberately unscoped. `admin.outlet.manage` is granted at ALL_OUTLETS to
   * OWNER alone, and RequestScope holds the *active* outlet ids, so scoping
   * this list would hide a deactivated outlet from the only screen that can
   * bring it back.
   */
  async listOutlets() {
    const rows = await this.prisma.outlet.findMany({ orderBy: { code: 'asc' } });
    return { data: rows.map(outletView) };
  }

  async createOutlet(dto: CreateOutletDto, actor: Actor) {
    const outlet = await this.tx(async (tx) => {
      const created = await tx.outlet.create({
        data: {
          code: dto.code,
          name: dto.name,
          address: dto.address ?? null,
          timezone: dto.timezone,
        },
      });
      await writeAudit(tx, actor, {
        action: 'admin.outlet.create',
        entityType: 'Outlet',
        entityId: created.id,
        outletId: created.id,
        after: { code: created.code, name: created.name, timezone: created.timezone },
      });
      return created;
    });

    await this.cache.invalidate();
    return outletView(outlet);
  }

  async updateOutlet(id: string, dto: UpdateOutletDto, actor: Actor) {
    const before = await this.prisma.outlet.findUnique({ where: { id } });
    if (!before) throw this.outletNotFound();

    const outlet = await this.tx(async (tx) => {
      const after = await tx.outlet.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.address === undefined ? {} : { address: dto.address ?? null }),
          ...(dto.timezone === undefined ? {} : { timezone: dto.timezone }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        },
      });
      await writeAudit(tx, actor, {
        action: 'admin.outlet.update',
        entityType: 'Outlet',
        entityId: id,
        outletId: id,
        before: { name: before.name, address: before.address, isActive: before.isActive },
        after: { name: after.name, address: after.address, isActive: after.isActive },
      });
      return after;
    });

    // Every outlet write, not just an isActive flip: OutletGuard reads this
    // cache on every ALL_OUTLETS request and a stale entry is a scoping bug.
    await this.cache.invalidate();
    return outletView(outlet);
  }

  async listDepartments(query: ListDepartmentsQuery, scope: RequestScope) {
    const rows = await this.prisma.department.findMany({
      where: {
        outletId: { in: scope.outletIds },
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      },
      orderBy: [{ outletId: 'asc' }, { name: 'asc' }],
    });
    return { data: rows };
  }

  async createDepartment(dto: CreateDepartmentDto, actor: Actor, scope: RequestScope) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();

    return this.tx(async (tx) => {
      const created = await tx.department.create({
        data: { outletId: dto.outletId, name: dto.name },
      });
      await writeAudit(tx, actor, {
        action: 'admin.department.create',
        entityType: 'Department',
        entityId: created.id,
        outletId: created.outletId,
        after: { name: created.name },
      });
      return created;
    });
  }

  async updateDepartment(
    id: string,
    dto: UpdateDepartmentDto,
    actor: Actor,
    scope: RequestScope,
  ) {
    const before = await this.prisma.department.findUnique({ where: { id } });
    if (!before || !scope.outletIds.includes(before.outletId)) throw this.departmentNotFound();

    return this.tx(async (tx) => {
      const after = await tx.department.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        },
      });
      await writeAudit(tx, actor, {
        action: 'admin.department.update',
        entityType: 'Department',
        entityId: id,
        outletId: after.outletId,
        before: { name: before.name, isActive: before.isActive },
        after: { name: after.name, isActive: after.isActive },
      });
      return after;
    });
  }

  private async tx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = Array.isArray(err.meta?.['target']) ? (err.meta['target'] as string[]) : [];
        throw target.includes('code')
          ? DomainError.conflict(ADMIN_ERRORS.ADMIN_OUTLET_CODE_TAKEN, 'That outlet code exists')
          : DomainError.conflict(
              ADMIN_ERRORS.ADMIN_DEPARTMENT_NAME_TAKEN,
              'That outlet already has a department with this name',
            );
      }
      throw err;
    }
  }

  private outletNotFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ADMIN_ERRORS.ADMIN_OUTLET_NOT_FOUND,
      'That outlet does not exist',
    );
  }

  private departmentNotFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ADMIN_ERRORS.ADMIN_DEPARTMENT_NOT_FOUND,
      'That department does not exist',
    );
  }
}
