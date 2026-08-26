import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  type CreatePurchaseDto,
  type ListPurchasesQuery,
  type PriceHistoryQuery,
  type VoidPurchaseDto,
} from '@bobs-momo/shared';
import { DocumentNumberService } from '../../common/documents/document-number.service';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { InventoryService } from '../inventory/inventory.service';
import { assertTransition, narrowOutlets } from './purchase-request.service';

const { Decimal } = Prisma;

// A line more than this far from the last observed price is flagged, never
// blocked. A 29 percent jump in paneer is sometimes a typo and sometimes just
// August, and the server is not the right place to decide which.
const PRICE_WARNING_PCT = 25;

const PURCHASE_INCLUDE = {
  outlet: { select: { code: true } },
  vendor: { select: { id: true, name: true } },
  items: {
    include: { item: { select: { id: true, name: true, unit: { select: { code: true } } } } },
  },
} satisfies Prisma.PurchaseInclude;

export interface PriceWarning {
  itemId: string;
  name: string;
  unitPrice: string;
  lastUnitPrice: string;
  changePct: string;
}

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentNumberService,
    private readonly inventory: InventoryService,
  ) {}

  async list(query: ListPurchasesQuery, scope: RequestScope) {
    const where: Prisma.PurchaseWhereInput = {
      outletId: { in: narrowOutlets(query.outletId, scope) },
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            purchaseDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          outlet: { select: { code: true } },
          vendor: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return paginate(
      rows.map((p) => ({
        id: p.id,
        purchaseNo: p.purchaseNo,
        outletId: p.outletId,
        outletCode: p.outlet.code,
        vendorId: p.vendorId,
        vendorName: p.vendor.name,
        status: p.status,
        purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
        invoiceNo: p.invoiceNo,
        lineCount: p._count.items,
        totalAmount: p.totalAmount.toFixed(2),
      })),
      total,
      query,
    );
  }

  async get(id: string, scope: RequestScope) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: PURCHASE_INCLUDE,
    });
    if (!purchase || !scope.outletIds.includes(purchase.outletId)) throw this.notFound();
    return toPurchaseView(purchase);
  }

  async create(dto: CreatePurchaseDto, user: AuthedUser, scope: RequestScope) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();

    const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.vendorId } });
    if (!vendor) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.VENDOR_NOT_FOUND,
        'That vendor does not exist',
      );
    }
    if (!vendor.isActive) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.VENDOR_INACTIVE,
        `${vendor.name} is deactivated`,
      );
    }

    if (dto.requestId) {
      const request = await this.prisma.purchaseRequest.findUnique({
        where: { id: dto.requestId },
      });
      if (!request || request.outletId !== dto.outletId) {
        throw new DomainError(
          HttpStatus.NOT_FOUND,
          ERROR_CODES.PR_NOT_FOUND,
          'That request does not exist',
        );
      }
      assertTransition(request.status, 'FULFILLED');
    }

    // Every money field is computed here. Nothing is read from the body, so a
    // purchase whose total does not match its lines cannot exist.
    const lines = dto.lines.map((l) => {
      const quantity = new Decimal(l.quantity.toFixed(3));
      const unitPrice = new Decimal(l.unitPrice.toFixed(2));
      return { ...l, quantity, unitPrice, lineTotal: quantity.mul(unitPrice).toDecimalPlaces(2) };
    });
    const subtotal = lines.reduce((acc, l) => acc.plus(l.lineTotal), new Decimal(0));
    const taxAmount = new Decimal(dto.taxAmount.toFixed(2));
    const totalAmount = subtotal.plus(taxAmount);

    const priceWarnings = await this.buildPriceWarnings(lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const purchaseNo = await this.documents.format(tx, 'PO', new Date().getUTCFullYear());

      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          outletId: dto.outletId,
          vendorId: dto.vendorId,
          requestId: dto.requestId ?? null,
          // RECORDED, not DRAFT. A purchase is entered from a paper bill in one
          // sitting, and a half-saved one that never received stock is a
          // reconciliation problem waiting to happen.
          status: 'RECORDED',
          invoiceNo: dto.invoiceNo ?? null,
          purchaseDate: new Date(`${dto.purchaseDate}T00:00:00.000Z`),
          subtotal,
          taxAmount,
          totalAmount,
          recordedById: user.sub,
          items: {
            create: lines.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: PURCHASE_INCLUDE,
      });

      await tx.itemPriceHistory.createMany({
        data: lines.map((l) => ({
          itemId: l.itemId,
          vendorId: dto.vendorId,
          unitPrice: l.unitPrice,
          // observedOn is the purchase date, not the entry timestamp. A bill
          // keyed in on Thursday for Tuesday's delivery is a Tuesday price.
          observedOn: new Date(`${dto.purchaseDate}T00:00:00.000Z`),
          purchaseId: purchase.id,
        })),
      });

      // Through the inventory service, never around it, so the lock, the
      // balanceAfter computation and the reorder check stay in one place.
      const balances: Record<string, string> = {};
      for (const line of lines) {
        const txn = await this.inventory.applyTransaction(
          tx,
          {
            itemId: line.itemId,
            outletId: dto.outletId,
            type: 'RECEIVED',
            quantity: line.quantity,
            businessDate: dto.purchaseDate,
            sourceType: 'PURCHASE',
            sourceId: purchase.id,
            note: `${purchaseNo} from ${vendor.name}`,
          },
          user.sub,
        );
        balances[line.itemId] = txn.balanceAfter;
      }

      if (dto.requestId) {
        await tx.purchaseRequest.update({
          where: { id: dto.requestId },
          data: { status: 'FULFILLED' },
        });
      }

      await tx.outboxEvent.create({
        data: {
          eventKey: 'PURCHASE_RECORDED',
          aggregateType: 'Purchase',
          aggregateId: purchase.id,
          payload: {
            purchaseNo,
            outletId: dto.outletId,
            vendorName: vendor.name,
            totalAmount: totalAmount.toFixed(2),
            recordedById: user.sub,
          },
        },
      });

      return { purchase, balances };
    });

    return {
      ...toPurchaseView(created.purchase, created.balances),
      priceWarnings,
      requestFulfilled: Boolean(dto.requestId),
    };
  }

  async void(id: string, dto: VoidPurchaseDto, user: AuthedUser, scope: RequestScope) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: PURCHASE_INCLUDE,
    });
    if (!purchase || !scope.outletIds.includes(purchase.outletId)) throw this.notFound();
    if (purchase.status !== 'RECORDED') {
      throw DomainError.conflict(
        ERROR_CODES.PURCHASE_ALREADY_VOIDED,
        `That purchase is already ${purchase.status.toLowerCase()}`,
      );
    }

    const voided = await this.prisma.$transaction(async (tx) => {
      for (const line of purchase.items) {
        // ADJUSTMENT rather than a negative RECEIVED, because ADJUSTMENT is the
        // one type allowed to drive the balance below zero. If the kitchen
        // already issued the stock, the balance going negative is the correct
        // outcome: it says the ledger believes the outlet used stock it never
        // received, which is exactly the discrepancy a manager needs to see.
        await this.inventory.applyTransaction(
          tx,
          {
            itemId: line.itemId,
            outletId: purchase.outletId,
            type: 'ADJUSTMENT',
            signedQty: line.quantity.negated(),
            businessDate: new Date().toISOString().slice(0, 10),
            reason: `Void of ${purchase.purchaseNo}: ${dto.reason}`,
            sourceType: 'PURCHASE_VOID',
            sourceId: purchase.id,
          },
          user.sub,
        );
      }

      // ItemPriceHistory is deliberately untouched. A void usually means the
      // paperwork was wrong, not that the price observation was false, and
      // deleting observations whenever a bill is re-keyed would put holes in
      // exactly the series the owner bought this system for.
      return tx.purchase.update({
        where: { id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: dto.reason },
        include: PURCHASE_INCLUDE,
      });
    });

    return toPurchaseView(voided);
  }

  async priceHistory(query: PriceHistoryQuery) {
    const where: Prisma.ItemPriceHistoryWhereInput = {
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.from || query.to
        ? {
            observedOn: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.itemPriceHistory.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ observedOn: 'desc' }, { createdAt: 'desc' }],
        include: {
          item: { select: { id: true, name: true, unit: { select: { code: true } } } },
          vendor: { select: { id: true, name: true } },
        },
      }),
      this.prisma.itemPriceHistory.count({ where }),
    ]);

    return paginate(
      rows.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        itemName: r.item.name,
        unitCode: r.item.unit.code,
        vendorId: r.vendorId,
        vendorName: r.vendor.name,
        unitPrice: r.unitPrice.toFixed(2),
        observedOn: r.observedOn.toISOString().slice(0, 10),
        purchaseId: r.purchaseId,
      })),
      total,
      query,
    );
  }

  private async buildPriceWarnings(
    lines: { itemId: string; unitPrice: Prisma.Decimal }[],
  ): Promise<PriceWarning[]> {
    const warnings: PriceWarning[] = [];
    for (const line of lines) {
      const last = await this.prisma.itemPriceHistory.findFirst({
        where: { itemId: line.itemId },
        orderBy: [{ observedOn: 'desc' }, { createdAt: 'desc' }],
        include: { item: { select: { name: true } } },
      });
      // No prior observation means no comparison. Reporting "0 percent change"
      // for an item first bought today is a lie a manager would act on.
      if (!last || last.unitPrice.isZero()) continue;

      const changePct = line.unitPrice.minus(last.unitPrice).div(last.unitPrice).mul(100);
      if (changePct.abs().gte(PRICE_WARNING_PCT)) {
        warnings.push({
          itemId: line.itemId,
          name: last.item.name,
          unitPrice: line.unitPrice.toFixed(2),
          lastUnitPrice: last.unitPrice.toFixed(2),
          changePct: changePct.toFixed(1),
        });
      }
    }
    return warnings;
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.PURCHASE_NOT_FOUND,
      'That purchase does not exist',
    );
  }
}

type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof PURCHASE_INCLUDE }>;

function toPurchaseView(p: PurchaseRow, balances: Record<string, string> = {}) {
  return {
    id: p.id,
    purchaseNo: p.purchaseNo,
    status: p.status,
    outletId: p.outletId,
    outletCode: p.outlet.code,
    vendorId: p.vendorId,
    vendorName: p.vendor.name,
    requestId: p.requestId,
    purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
    invoiceNo: p.invoiceNo,
    subtotal: p.subtotal.toFixed(2),
    taxAmount: p.taxAmount.toFixed(2),
    totalAmount: p.totalAmount.toFixed(2),
    lines: p.items.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      name: l.item.name,
      unitCode: l.item.unit.code,
      quantity: l.quantity.toFixed(3),
      unitPrice: l.unitPrice.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
      balanceAfter: balances[l.itemId] ?? null,
    })),
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidReason: p.voidReason,
    recordedById: p.recordedById,
    createdAt: p.createdAt.toISOString(),
  };
}
