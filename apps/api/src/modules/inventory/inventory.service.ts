import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type StockTxnType } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  toBusinessDate,
  type CreateItemDto,
  type ListItemsQuery,
  type ListStockQuery,
  type ListTransactionsQuery,
  type RecordTransactionDto,
  type SetReorderLevelDto,
  type UpdateItemDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { InventoryRepository, type LockedStockRow } from './inventory.repository';

const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

// ADJUSTMENT and CLOSING carry their own sign from the caller.
const SIGN: Record<StockTxnType, -1 | 0 | 1> = {
  OPENING: 1,
  RECEIVED: 1,
  TRANSFER_IN: 1,
  ISSUED: -1,
  WASTAGE: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT: 0,
  CLOSING: 0,
};

const REASON_REQUIRED: StockTxnType[] = ['WASTAGE', 'ADJUSTMENT'];

// Issuing more than the ledger holds is almost always a typo, not a fridge with
// negative chicken. Blocking costs five seconds. Allowing it corrupts every
// consumption figure downstream. ADJUSTMENT and WASTAGE are deliberately not
// blocked: you cannot argue with a bin full of spoiled paneer.
const NEGATIVE_BLOCKED: StockTxnType[] = ['ISSUED', 'TRANSFER_OUT'];

const BACKDATE_LIMIT_DAYS = 7;
const LOW_STOCK_COOLDOWN_HOURS = 12;
const MAX_RANGE_DAYS = 92;

/**
 * What a caller inside an outer transaction hands to applyTransaction. Purchase
 * uses this for RECEIVED lines and for the compensating rows on a void.
 */
export interface ApplyTransactionInput {
  itemId: string;
  outletId: string;
  type: StockTxnType;
  quantity?: number | Prisma.Decimal;
  signedQty?: number | Prisma.Decimal;
  businessDate: string;
  reason?: string | null;
  note?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  transferPairId?: string | null;
}

export interface RecordedTransaction {
  id: string;
  itemId: string;
  outletId: string;
  type: StockTxnType;
  quantity: string;
  signedQty: string;
  balanceAfter: string;
  businessDate: string;
  reason: string | null;
  note: string | null;
  sourceType: string | null;
  createdById: string;
  createdAt: string;
  lowStockRaised: boolean;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InventoryRepository,
  ) {}

  // ---- items -------------------------------------------------------------

  async listItems(query: ListItemsQuery) {
    const where: Prisma.InventoryItemWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.repo.listItems(
      where,
      (query.page - 1) * query.pageSize,
      query.pageSize,
    );
    return paginate(rows.map(toItemView), total, query);
  }

  async getItem(id: string) {
    const item = await this.repo.findItem(id);
    if (!item) throw this.itemNotFound();
    return toItemView(item);
  }

  async createItem(dto: CreateItemDto) {
    const existing = await this.repo.findItemBySku(dto.sku);
    if (existing) {
      throw DomainError.conflict(ERROR_CODES.COMMON_CONFLICT, 'That SKU already exists', {
        sku: dto.sku,
      });
    }
    const created = await this.repo.createItem(dto);
    return this.getItem(created.id);
  }

  async updateItem(id: string, dto: UpdateItemDto) {
    const item = await this.repo.findItem(id);
    if (!item) throw this.itemNotFound();
    // unitId is absent from the update schema on purpose. Changing an item's
    // unit once the ledger has rows mixes KG and G in one balance column.
    await this.repo.updateItem(id, dto);
    return this.getItem(id);
  }

  async deactivateItem(id: string) {
    const item = await this.repo.findItem(id);
    if (!item) throw this.itemNotFound();
    await this.repo.updateItem(id, { isActive: false });
    return this.getItem(id);
  }

  // ---- stock -------------------------------------------------------------

  async listStock(query: ListStockQuery, scope: RequestScope) {
    const where: Prisma.ItemStockWhereInput = {
      outletId: { in: scope.outletIds },
      item: {
        isActive: true,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      // The comparison runs in the database. It used to filter the page after
      // Prisma had already paginated, and reported the survivors as the total:
      // page one kept whichever of the first 25 items alphabetically happened
      // to be low and told the manager that was the whole reorder list. He
      // ordered three things and ran out of the rest.
      ...(query.belowReorder ? lowStockWhere(this.prisma) : {}),
    };
    const [rows, total] = await this.repo.listStock(
      where,
      (query.page - 1) * query.pageSize,
      query.pageSize,
    );

    return paginate(rows.map(toStockView), total, query);
  }

  async setReorderLevel(itemId: string, dto: SetReorderLevelDto, scope: RequestScope) {
    const item = await this.repo.findItem(itemId);
    if (!item) throw this.itemNotFound();
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();

    const row = await this.repo.upsertReorderLevel(
      itemId,
      dto.outletId,
      dto.reorderLevel === null ? null : new Decimal(dto.reorderLevel.toFixed(3)),
    );
    return {
      itemId,
      outletId: dto.outletId,
      qtyOnHand: row.qtyOnHand.toFixed(3),
      reorderLevel: row.reorderLevel?.toFixed(3) ?? null,
    };
  }

  // ---- ledger ------------------------------------------------------------

  async listTransactions(query: ListTransactionsQuery, scope: RequestScope) {
    if (query.from && query.to && daysBetween(query.from, query.to) > MAX_RANGE_DAYS) {
      throw DomainError.badRequest(
        ERROR_CODES.COMMON_VALIDATION_FAILED,
        `Pick a range of ${MAX_RANGE_DAYS} days or fewer`,
      );
    }

    const outletIds = query.outletId
      ? scope.outletIds.filter((id) => id === query.outletId)
      : scope.outletIds;
    if (query.outletId && outletIds.length === 0) throw DomainError.notFound();

    const where: Prisma.StockTransactionWhereInput = {
      outletId: { in: outletIds },
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.categoryId ? { item: { categoryId: query.categoryId } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.from || query.to
        ? {
            businessDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.repo.listTransactions(
      where,
      (query.page - 1) * query.pageSize,
      query.pageSize,
    );
    return paginate(rows.map(toTransactionView), total, query);
  }

  async record(
    dto: RecordTransactionDto,
    user: AuthedUser,
    scope: RequestScope,
  ): Promise<RecordedTransaction> {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();
    return this.prisma.$transaction((tx) => this.applyTransaction(tx, dto, user.sub));
  }

  /**
   * The single place a stock balance moves. Purchase calls this with its own
   * transaction client so the receipt, the ledger rows and the balance either
   * all commit or none do. Duplicating any of it would mean two code paths
   * computing balanceAfter differently, and the ledger would stop replaying to
   * the balance.
   */
  async applyTransaction(
    tx: Prisma.TransactionClient,
    input: ApplyTransactionInput,
    actorId: string,
  ): Promise<RecordedTransaction> {
    const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw this.itemNotFound();
    if (!item.isActive) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.INVENTORY_ITEM_INACTIVE,
        `${item.name} is no longer in use`,
      );
    }

    this.assertBusinessDate(input.businessDate, input.type);

    const stock = await this.repo.lockStock(tx, input.itemId, input.outletId);
    const businessDate = new Date(`${input.businessDate}T00:00:00.000Z`);

    if (input.type === 'OPENING') {
      const already = await this.repo.countOpeningOnDate(
        tx,
        input.itemId,
        input.outletId,
        businessDate,
      );
      if (already > 0) {
        throw DomainError.conflict(
          ERROR_CODES.INVENTORY_OPENING_ALREADY_RECORDED,
          'Opening stock for this item is already recorded for that day',
        );
      }
    }

    const before = new Decimal(stock.qtyOnHand);
    const signed = signedMovement(input);
    const after = before.plus(signed);

    if (REASON_REQUIRED.includes(input.type) && !input.reason?.trim()) {
      throw DomainError.badRequest(
        ERROR_CODES.INVENTORY_REASON_REQUIRED,
        'A reason is required for this type',
      );
    }
    if (after.lt(0) && NEGATIVE_BLOCKED.includes(input.type)) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.INVENTORY_NEGATIVE_STOCK_BLOCKED,
        `Only ${before.toFixed(3)} of ${item.name} on hand`,
        { onHand: before.toFixed(3), requested: signed.abs().toFixed(3) },
      );
    }

    const row = await this.repo.createTransaction(tx, {
      itemId: input.itemId,
      outletId: input.outletId,
      type: input.type,
      quantity: signed.abs(),
      signedQty: signed,
      balanceAfter: after,
      businessDate,
      reason: input.reason ?? null,
      note: input.note ?? null,
      sourceType: input.sourceType ?? 'MANUAL',
      sourceId: input.sourceId ?? null,
      transferPairId: input.transferPairId ?? null,
      createdById: actorId,
    });

    await this.repo.setBalance(tx, stock.id, after);
    const lowStockRaised = await this.maybeRaiseLowStock(tx, stock, before, after);

    return {
      id: row.id,
      itemId: row.itemId,
      outletId: row.outletId,
      type: row.type,
      quantity: row.quantity.toFixed(3),
      signedQty: row.signedQty.toFixed(3),
      balanceAfter: row.balanceAfter.toFixed(3),
      businessDate: input.businessDate,
      reason: row.reason,
      note: row.note,
      sourceType: row.sourceType,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      lowStockRaised,
    };
  }

  /**
   * Fires on the downward crossing only, and at most once per cooldown window.
   * Without the transition check a kitchen issuing cabbage six times in an
   * afternoon sends six identical messages and the manager mutes the number.
   * The event goes in the outbox inside this transaction, so a rolled back
   * stock write cannot leave a WhatsApp message behind.
   */
  private async maybeRaiseLowStock(
    tx: Prisma.TransactionClient,
    stock: LockedStockRow,
    before: Decimal,
    after: Decimal,
  ): Promise<boolean> {
    if (stock.reorderLevel === null) return false;

    const level = new Decimal(stock.reorderLevel);
    if (!(before.gte(level) && after.lt(level))) return false;

    const cooldownMs = LOW_STOCK_COOLDOWN_HOURS * 60 * 60 * 1000;
    const cooled =
      stock.lastAlertAt === null || Date.now() - stock.lastAlertAt.getTime() >= cooldownMs;
    if (!cooled) return false;

    await this.repo.createOutboxEvent(tx, {
      eventKey: 'LOW_STOCK',
      aggregateType: 'ItemStock',
      aggregateId: stock.id,
      payload: {
        itemId: stock.itemId,
        outletId: stock.outletId,
        qtyOnHand: after.toFixed(3),
        reorderLevel: level.toFixed(3),
      },
    });
    await this.repo.markAlerted(tx, stock.id);
    return true;
  }

  /**
   * Staff write on paper for two days and then catch up, so a today-only rule
   * pushes them straight back to the paper register. Seven days is short enough
   * that a reconciled month does not move under the owner.
   */
  private assertBusinessDate(date: string, type: StockTxnType): void {
    const today = toBusinessDate();
    if (date > today) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.INVENTORY_FUTURE_BUSINESS_DATE,
        'That date is in the future',
      );
    }
    const back = daysBetween(date, today);
    const limit = type === 'OPENING' ? 0 : BACKDATE_LIMIT_DAYS;
    if (back > limit) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.INVENTORY_BACKDATE_LIMIT_EXCEEDED,
        limit === 0
          ? 'Opening stock can only be recorded for today'
          : `You can backdate by up to ${BACKDATE_LIMIT_DAYS} days`,
      );
    }
  }

  private itemNotFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.INVENTORY_ITEM_NOT_FOUND,
      'That item does not exist',
    );
  }
}

/** ADJUSTMENT and CLOSING carry their own sign. Everything else gets it from type. */
function signedMovement(input: ApplyTransactionInput): Decimal {
  const raw = SIGN[input.type] === 0 ? input.signedQty : input.quantity;
  if (raw === undefined) {
    throw DomainError.badRequest(
      ERROR_CODES.COMMON_VALIDATION_FAILED,
      SIGN[input.type] === 0
        ? 'This type needs a signed quantity'
        : 'This type needs a quantity',
    );
  }
  const value = raw instanceof Decimal ? raw : new Decimal(raw.toFixed(3));
  return SIGN[input.type] === 0 ? value : value.abs().mul(SIGN[input.type]);
}

/**
 * Below the reorder threshold, expressed once. The dashboard tile, the reorder
 * list and the daily digest all ask the same question, and two of them used to
 * answer it differently.
 */
export function lowStockWhere(prisma: PrismaService): Prisma.ItemStockWhereInput {
  return {
    reorderLevel: { not: null },
    // Prisma's field-reference form, so the comparison happens in the database
    // rather than over a page of rows that was already truncated.
    qtyOnHand: { lt: prisma.itemStock.fields.reorderLevel },
  };
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

type ItemRow = Awaited<ReturnType<InventoryRepository['findItem']>>;

function toItemView(item: NonNullable<ItemRow>) {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    categoryId: item.categoryId,
    categoryName: item.category.name,
    unitId: item.unitId,
    unitCode: item.unit.code,
    isPerishable: item.isPerishable,
    isActive: item.isActive,
  };
}

interface StockRow {
  itemId: string;
  outletId: string;
  qtyOnHand: Decimal;
  reorderLevel: Decimal | null;
  lastAlertAt: Date | null;
  item: {
    id: string;
    sku: string;
    name: string;
    isActive: boolean;
    unit: { code: string };
    category: { id: string; name: string };
  };
  outlet: { id: string; code: string };
}

function toStockView(row: StockRow) {
  const qty = new Decimal(row.qtyOnHand);
  const level = row.reorderLevel === null ? null : new Decimal(row.reorderLevel);
  return {
    itemId: row.itemId,
    sku: row.item.sku,
    name: row.item.name,
    unitCode: row.item.unit.code,
    categoryId: row.item.category.id,
    categoryName: row.item.category.name,
    outletId: row.outletId,
    outletCode: row.outlet.code,
    qtyOnHand: qty.toFixed(3),
    reorderLevel: level?.toFixed(3) ?? null,
    // A negative balance is an operations problem with a name attached to it,
    // not a database error. The UI renders it red rather than hiding it.
    isNegative: qty.lt(0),
    isBelowReorder: level !== null && qty.lt(level),
    lastAlertAt: row.lastAlertAt?.toISOString() ?? null,
  };
}

interface TransactionRow {
  id: string;
  type: StockTxnType;
  quantity: Decimal;
  signedQty: Decimal;
  balanceAfter: Decimal;
  businessDate: Date;
  reason: string | null;
  note: string | null;
  createdById: string;
  createdAt: Date;
  item: { id: string; name: string; unit: { code: string } };
  outlet: { code: string };
}

function toTransactionView(row: TransactionRow) {
  return {
    id: row.id,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    type: row.type,
    item: { id: row.item.id, name: row.item.name, unitCode: row.item.unit.code },
    outletCode: row.outlet.code,
    quantity: row.quantity.toFixed(3),
    signedQty: row.signedQty.toFixed(3),
    balanceAfter: row.balanceAfter.toFixed(3),
    reason: row.reason,
    note: row.note,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
  };
}
