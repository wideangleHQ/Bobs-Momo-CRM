import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  type CreateVendorDto,
  type ListVendorsQuery,
  type SetVendorItemsDto,
  type UpdateVendorDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListVendorsQuery) {
    const where: Prisma.VendorWhereInput = {
      isActive: query.isActive,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { items: true } },
          purchases: { select: { purchaseDate: true }, orderBy: { purchaseDate: 'desc' }, take: 1 },
        },
      }),
      this.prisma.vendor.count({ where }),
    ]);

    return paginate(
      rows.map((v) => ({
        id: v.id,
        name: v.name,
        phone: v.phone,
        email: v.email,
        gstin: v.gstin,
        isActive: v.isActive,
        itemCount: v._count.items,
        lastPurchaseAt: v.purchases[0]?.purchaseDate.toISOString().slice(0, 10) ?? null,
      })),
      total,
      query,
    );
  }

  async get(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: { items: { select: { itemId: true } } },
    });
    if (!vendor) throw this.notFound();
    return {
      id: vendor.id,
      name: vendor.name,
      phone: vendor.phone,
      email: vendor.email,
      address: vendor.address,
      gstin: vendor.gstin,
      isActive: vendor.isActive,
      itemIds: vendor.items.map((i) => i.itemId),
    };
  }

  async create(dto: CreateVendorDto) {
    await this.assertNameFree(dto.name, null);
    const vendor = await this.prisma.vendor.create({ data: dto });
    return this.get(vendor.id);
  }

  async update(id: string, dto: UpdateVendorDto) {
    const existing = await this.prisma.vendor.findUnique({ where: { id } });
    if (!existing) throw this.notFound();
    if (dto.name) await this.assertNameFree(dto.name, id);
    await this.prisma.vendor.update({ where: { id }, data: dto });
    return this.get(id);
  }

  async deactivate(id: string) {
    const existing = await this.prisma.vendor.findUnique({ where: { id } });
    if (!existing) throw this.notFound();
    await this.prisma.vendor.update({ where: { id }, data: { isActive: false } });
    return this.get(id);
  }

  /** Replaces the whole link set, because the UI edits it as one checkbox list. */
  async setItems(id: string, dto: SetVendorItemsDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw this.notFound();

    const known = await this.prisma.inventoryItem.findMany({
      where: { id: { in: dto.itemIds } },
      select: { id: true },
    });
    if (known.length !== new Set(dto.itemIds).size) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.INVENTORY_ITEM_NOT_FOUND,
        'One of those items does not exist',
      );
    }

    await this.prisma.$transaction([
      this.prisma.vendorItem.deleteMany({ where: { vendorId: id } }),
      this.prisma.vendorItem.createMany({
        data: known.map((i) => ({ vendorId: id, itemId: i.id })),
      }),
    ]);
    return this.get(id);
  }

  /**
   * Vendor.name is unique in the database, but that constraint is
   * case-sensitive and the purchase manager types names from memory. Two rows
   * called "Saheed Nagar Poultry" and "saheed nagar poultry" would split the
   * price history for chicken in half and make the trend chart useless.
   */
  private async assertNameFree(name: string, exceptId: string | null): Promise<void> {
    const clash = await this.prisma.vendor.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw DomainError.conflict(ERROR_CODES.VENDOR_NAME_TAKEN, 'That vendor already exists', [
        { field: 'name', issue: 'duplicate', existingId: clash.id, existingName: clash.name },
      ]);
    }
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.VENDOR_NOT_FOUND,
      'That vendor does not exist',
    );
  }
}
