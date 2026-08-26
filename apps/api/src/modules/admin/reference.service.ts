import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_ERRORS,
  ERROR_CODES,
  type CreateCategoryDto,
  type CreateUnitDto,
  type UpdateCategoryDto,
  type UpdateUnitDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { writeAudit, type Actor } from './audit-writer';

// Categories and units are global reference data with no outlet column. The
// inventory module reads them; nothing there creates them, so they live here.
@Injectable()
export class AdminReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories() {
    const rows = await this.prisma.itemCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    return { data: rows.map((c) => ({ id: c.id, name: c.name, itemCount: c._count.items })) };
  }

  async createCategory(dto: CreateCategoryDto, actor: Actor) {
    return this.tx(async (tx) => {
      const created = await tx.itemCategory.create({ data: { name: dto.name } });
      await writeAudit(tx, actor, {
        action: 'inventory.category.create',
        entityType: 'ItemCategory',
        entityId: created.id,
        after: { name: created.name },
      });
      return { id: created.id, name: created.name };
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actor: Actor) {
    const before = await this.prisma.itemCategory.findUnique({ where: { id } });
    if (!before) throw this.notFound(ADMIN_ERRORS.ADMIN_CATEGORY_NOT_FOUND, 'category');
    if (dto.name === undefined) return { id: before.id, name: before.name };

    return this.tx(async (tx) => {
      const after = await tx.itemCategory.update({ where: { id }, data: { name: dto.name } });
      await writeAudit(tx, actor, {
        action: 'inventory.category.update',
        entityType: 'ItemCategory',
        entityId: id,
        before: { name: before.name },
        after: { name: after.name },
      });
      return { id: after.id, name: after.name };
    });
  }

  async listUnits() {
    const rows = await this.prisma.unit.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    return { data: rows.map((u) => ({ id: u.id, code: u.code, name: u.name, itemCount: u._count.items })) };
  }

  async createUnit(dto: CreateUnitDto, actor: Actor) {
    return this.tx(async (tx) => {
      const created = await tx.unit.create({ data: { code: dto.code, name: dto.name } });
      await writeAudit(tx, actor, {
        action: 'inventory.unit.create',
        entityType: 'Unit',
        entityId: created.id,
        after: { code: created.code, name: created.name },
      });
      return { id: created.id, code: created.code, name: created.name };
    });
  }

  async updateUnit(id: string, dto: UpdateUnitDto, actor: Actor) {
    const before = await this.prisma.unit.findUnique({ where: { id } });
    if (!before) throw this.notFound(ADMIN_ERRORS.ADMIN_UNIT_NOT_FOUND, 'unit');

    if (dto.code !== undefined && dto.code !== before.code) {
      // Every ledger row was written as a quantity in this unit. Renaming KG to
      // G silently rewrites the meaning of every historical balance, and the
      // ledger is append only precisely so that cannot happen.
      const ledgerRows = await this.prisma.stockTransaction.count({
        where: { item: { unitId: id } },
      });
      if (ledgerRows > 0) {
        throw DomainError.conflict(
          ERROR_CODES.INVENTORY_UNIT_LOCKED_BY_LEDGER,
          `${before.code} has ${ledgerRows} stock rows behind it. Create a new unit instead`,
          { ledgerRows },
        );
      }
    }

    return this.tx(async (tx) => {
      const after = await tx.unit.update({
        where: { id },
        data: {
          ...(dto.code === undefined ? {} : { code: dto.code }),
          ...(dto.name === undefined ? {} : { name: dto.name }),
        },
      });
      await writeAudit(tx, actor, {
        action: 'inventory.unit.update',
        entityType: 'Unit',
        entityId: id,
        before: { code: before.code, name: before.name },
        after: { code: after.code, name: after.name },
      });
      return { id: after.id, code: after.code, name: after.name };
    });
  }

  private async tx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = Array.isArray(err.meta?.['target']) ? (err.meta['target'] as string[]) : [];
        throw target.includes('code')
          ? DomainError.conflict(ADMIN_ERRORS.ADMIN_UNIT_CODE_TAKEN, 'That unit code exists')
          : DomainError.conflict(
              ADMIN_ERRORS.ADMIN_CATEGORY_NAME_TAKEN,
              'That category name exists',
            );
      }
      throw err;
    }
  }

  private notFound(code: string, what: string): DomainError {
    return new DomainError(HttpStatus.NOT_FOUND, code, `That ${what} does not exist`);
  }
}
