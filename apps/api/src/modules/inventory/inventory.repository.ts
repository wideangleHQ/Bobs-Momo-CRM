import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface LockedStockRow {
  id: string;
  itemId: string;
  outletId: string;
  qtyOnHand: Prisma.Decimal;
  reorderLevel: Prisma.Decimal | null;
  lastAlertAt: Date | null;
}

// Queries only. Nothing here decides what a missing row means or whether a
// balance is allowed to go negative.
@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Locks the balance row for this item and outlet, creating it on first use.
   * The insert has to happen before the lock: FOR UPDATE on a row that does not
   * exist locks nothing, and two concurrent first transactions would otherwise
   * create two balance rows for the same pair.
   */
  async lockStock(tx: Tx, itemId: string, outletId: string): Promise<LockedStockRow> {
    await tx.$executeRaw`
      INSERT INTO "ItemStock" ("id", "itemId", "outletId", "qtyOnHand", "updatedAt")
      VALUES (gen_random_uuid(), ${itemId}::uuid, ${outletId}::uuid, 0, now())
      ON CONFLICT ("itemId", "outletId") DO NOTHING`;

    const rows = await tx.$queryRaw<LockedStockRow[]>`
      SELECT "id", "itemId", "outletId", "qtyOnHand", "reorderLevel", "lastAlertAt"
      FROM "ItemStock"
      WHERE "itemId" = ${itemId}::uuid AND "outletId" = ${outletId}::uuid
      FOR UPDATE`;

    const row = rows[0];
    if (!row) throw new Error(`ItemStock row vanished for ${itemId}/${outletId}`);
    return row;
  }

  findItem(id: string) {
    return this.prisma.inventoryItem.findUnique({
      where: { id },
      include: { unit: { select: { code: true } }, category: { select: { name: true } } },
    });
  }

  findItemBySku(sku: string) {
    return this.prisma.inventoryItem.findUnique({ where: { sku } });
  }

  countLedgerRowsForItem(itemId: string) {
    return this.prisma.stockTransaction.count({ where: { itemId } });
  }

  listItems(where: Prisma.InventoryItemWhereInput, skip: number, take: number) {
    return this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take,
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
        include: { unit: { select: { code: true } }, category: { select: { name: true } } },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
  }

  createItem(data: Prisma.InventoryItemUncheckedCreateInput) {
    return this.prisma.inventoryItem.create({ data });
  }

  updateItem(id: string, data: Prisma.InventoryItemUncheckedUpdateInput) {
    return this.prisma.inventoryItem.update({ where: { id }, data });
  }

  listStock(where: Prisma.ItemStockWhereInput, skip: number, take: number) {
    return this.prisma.$transaction([
      this.prisma.itemStock.findMany({
        where,
        skip,
        take,
        orderBy: [{ item: { name: 'asc' } }],
        include: {
          item: {
            select: {
              id: true,
              sku: true,
              name: true,
              isActive: true,
              unit: { select: { code: true } },
              category: { select: { id: true, name: true } },
            },
          },
          outlet: { select: { id: true, code: true } },
        },
      }),
      this.prisma.itemStock.count({ where }),
    ]);
  }

  upsertReorderLevel(itemId: string, outletId: string, reorderLevel: Prisma.Decimal | null) {
    return this.prisma.itemStock.upsert({
      where: { itemId_outletId: { itemId, outletId } },
      update: { reorderLevel },
      create: { itemId, outletId, qtyOnHand: 0, reorderLevel },
    });
  }

  createTransaction(tx: Tx, data: Prisma.StockTransactionUncheckedCreateInput) {
    return tx.stockTransaction.create({ data });
  }

  setBalance(tx: Tx, id: string, qtyOnHand: Prisma.Decimal) {
    return tx.itemStock.update({ where: { id }, data: { qtyOnHand } });
  }

  markAlerted(tx: Tx, id: string) {
    return tx.itemStock.update({ where: { id }, data: { lastAlertAt: new Date() } });
  }

  createOutboxEvent(tx: Tx, data: Prisma.OutboxEventUncheckedCreateInput) {
    return tx.outboxEvent.create({ data });
  }

  countOpeningOnDate(tx: Tx, itemId: string, outletId: string, businessDate: Date) {
    return tx.stockTransaction.count({
      where: { itemId, outletId, type: 'OPENING', businessDate },
    });
  }

  listTransactions(where: Prisma.StockTransactionWhereInput, skip: number, take: number) {
    return this.prisma.$transaction([
      this.prisma.stockTransaction.findMany({
        where,
        skip,
        take,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          item: { select: { id: true, name: true, unit: { select: { code: true } } } },
          outlet: { select: { code: true } },
        },
      }),
      this.prisma.stockTransaction.count({ where }),
    ]);
  }
}
