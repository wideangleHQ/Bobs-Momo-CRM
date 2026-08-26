import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SALES_ERRORS,
  paginate,
  toBusinessDate,
  type CreateSalesEntryDto,
  type ListSalesEntriesQuery,
  type UpdateSalesEntryDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { grantsFor } from '../../common/permissions';
import type { AuthedUser, RequestScope } from '../../common/types/request';

const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

/**
 * The printout the operator reads rounds each payment line to the rupee, so
 * four lines can drift from the printed net by a rupee before anyone has made
 * a mistake. Wider than this and the first error it swallows is a
 * transposition, 4850 typed as 4580, which is the one worth catching.
 *
 * ponytail: a constant, not an env var. Move it to config/env.ts if UAT shows
 * the real printouts drifting further.
 */
const SPLIT_TOLERANCE = new Decimal('1.00');

/**
 * A business date ends at 04:00 IST the next calendar day, so an entry is
 * editable for 48 hours once its own trading day is three business dates old.
 * A Monday entry stops being editable at 04:00 IST on Thursday.
 */
const LOCK_AFTER_BUSINESS_DAYS = 3;

const DEFAULT_WINDOW_DAYS = 30;

const ENTRY_INCLUDE = { outlet: { select: { code: true } } } satisfies Prisma.DailySalesEntryInclude;

type EntryRow = Prisma.DailySalesEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

interface MoneyFields {
  grossSales: Decimal;
  discounts: Decimal;
  netSales: Decimal;
  cashAmount: Decimal;
  upiAmount: Decimal;
  cardAmount: Decimal;
  otherAmount: Decimal;
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSalesEntriesQuery, scope: RequestScope) {
    const to = query.to ?? toBusinessDate();
    const from = query.from ?? isoDate(dayUtc(to).getTime() - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS);

    const where: Prisma.DailySalesEntryWhereInput = {
      outletId: { in: scope.outletIds },
      businessDate: { gte: dayUtc(from), lte: dayUtc(to) },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dailySalesEntry.findMany({
        where,
        include: ENTRY_INCLUDE,
        // A two outlet day reads as a pair.
        orderBy: [{ businessDate: 'desc' }, { outlet: { code: 'asc' } }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.dailySalesEntry.count({ where }),
    ]);

    return paginate(rows.map(toEntryView), total, query);
  }

  async get(id: string, scope: RequestScope) {
    const entry = await this.prisma.dailySalesEntry.findUnique({
      where: { id },
      include: ENTRY_INCLUDE,
    });
    if (!entry || !scope.outletIds.includes(entry.outletId)) throw this.notFound();
    return toEntryView(entry);
  }

  async create(dto: CreateSalesEntryDto, user: AuthedUser, scope: RequestScope) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();

    const today = toBusinessDate();
    if (dto.businessDate > today) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        SALES_ERRORS.SALES_ENTRY_FUTURE_DATE,
        'That trading day has not happened yet',
      );
    }
    // Backfilling further back than the amend window is the Owner's job, and it
    // is the same power as unlocking a finalised day.
    if (daysBetween(dto.businessDate, today) >= LOCK_AFTER_BUSINESS_DAYS && !canUnlock(user)) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        SALES_ERRORS.SALES_ENTRY_WINDOW_CLOSED,
        'That day is closed. Ask the owner to enter it.',
        { businessDate: dto.businessDate, currentBusinessDate: today },
      );
    }

    const money = this.resolveMoney({
      grossSales: new Decimal(dto.grossSales.toFixed(2)),
      discounts: new Decimal(dto.discounts.toFixed(2)),
      cashAmount: new Decimal(dto.cashAmount.toFixed(2)),
      upiAmount: new Decimal(dto.upiAmount.toFixed(2)),
      cardAmount: new Decimal(dto.cardAmount.toFixed(2)),
      otherAmount: new Decimal(dto.otherAmount.toFixed(2)),
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const entry = await tx.dailySalesEntry.create({
          data: {
            outletId: dto.outletId,
            businessDate: dayUtc(dto.businessDate),
            ...money,
            orderCount: dto.orderCount ?? null,
            note: dto.note ?? null,
            enteredById: user.sub,
          },
          include: ENTRY_INCLUDE,
        });
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            actorLabel: user.sub,
            action: 'sales.entry.create',
            entityType: 'DailySalesEntry',
            entityId: entry.id,
            outletId: entry.outletId,
            after: toMoneyJson(entry),
          },
        });
        return entry;
      });
      return toEntryView(created);
    } catch (e) {
      // Caught rather than pre-checked. Two closing shifts submitting the same
      // printout at once would both pass a select-then-insert.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.dailySalesEntry.findUnique({
          where: {
            outletId_businessDate: {
              outletId: dto.outletId,
              businessDate: dayUtc(dto.businessDate),
            },
          },
          select: { id: true },
        });
        throw DomainError.conflict(
          SALES_ERRORS.SALES_ENTRY_EXISTS,
          'That day is already entered for this outlet',
          { entryId: existing?.id ?? null, businessDate: dto.businessDate },
        );
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateSalesEntryDto, user: AuthedUser, scope: RequestScope) {
    const entry = await this.prisma.dailySalesEntry.findUnique({
      where: { id },
      include: ENTRY_INCLUDE,
    });
    if (!entry || !scope.outletIds.includes(entry.outletId)) throw this.notFound();

    const businessDate = isoDate(entry.businessDate);
    const locked =
      entry.lockedAt !== null ||
      daysBetween(businessDate, toBusinessDate()) >= LOCK_AFTER_BUSINESS_DAYS;
    if (locked && !canUnlock(user)) {
      throw DomainError.conflict(
        SALES_ERRORS.SALES_ENTRY_LOCKED,
        'That day is final. Only the owner can change it now.',
        { lockedAt: entry.lockedAt?.toISOString() ?? null, businessDate },
      );
    }

    // Merged first, then validated. Patching discounts alone has to be checked
    // against the stored grossSales, and the split against the new net.
    const money = this.resolveMoney({
      grossSales: pick(dto.grossSales, entry.grossSales),
      discounts: pick(dto.discounts, entry.discounts),
      cashAmount: pick(dto.cashAmount, entry.cashAmount),
      upiAmount: pick(dto.upiAmount, entry.upiAmount),
      cardAmount: pick(dto.cardAmount, entry.cardAmount),
      otherAmount: pick(dto.otherAmount, entry.otherAmount),
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.dailySalesEntry.update({
        where: { id },
        data: {
          ...money,
          ...(dto.orderCount === undefined ? {} : { orderCount: dto.orderCount }),
          ...(dto.note === undefined ? {} : { note: dto.note }),
        },
        include: ENTRY_INCLUDE,
      });
      // The record that answers "who changed Tuesday".
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: 'sales.entry.amend',
          entityType: 'DailySalesEntry',
          entityId: id,
          outletId: row.outletId,
          before: toMoneyJson(entry),
          after: toMoneyJson(row),
        },
      });
      return row;
    });

    return toEntryView(updated);
  }

  /**
   * Every active outlet with no row for that trading day. The 23:30 IST job in
   * chapter 24 turns this into one SALES_ENTRY_MISSING outbox row per outlet.
   * Deliberately unscoped and side effect free: it runs as the system, and the
   * caller owns both the notification and the deduplication.
   */
  async findMissingEntries(
    businessDate: string = toBusinessDate(),
  ): Promise<Array<{ outletId: string; outletCode: string; businessDate: string }>> {
    const [outlets, entries] = await Promise.all([
      this.prisma.outlet.findMany({
        where: { isActive: true },
        select: { id: true, code: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.dailySalesEntry.findMany({
        where: { businessDate: dayUtc(businessDate) },
        select: { outletId: true },
      }),
    ]);

    const entered = new Set(entries.map((e) => e.outletId));
    return outlets
      .filter((o) => !entered.has(o.id))
      .map((o) => ({ outletId: o.id, outletCode: o.code, businessDate }));
  }

  /** netSales is computed here and nowhere else, then the split is checked against it. */
  private resolveMoney(input: Omit<MoneyFields, 'netSales'>): MoneyFields {
    if (input.discounts.greaterThan(input.grossSales)) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        SALES_ERRORS.DISCOUNT_EXCEEDS_GROSS,
        'Discounts cannot be more than gross sales',
        { grossSales: input.grossSales.toFixed(2), discounts: input.discounts.toFixed(2) },
      );
    }

    const netSales = input.grossSales.minus(input.discounts);
    const split = input.cashAmount
      .plus(input.upiAmount)
      .plus(input.cardAmount)
      .plus(input.otherAmount);
    const drift = split.minus(netSales);

    if (drift.abs().greaterThan(SPLIT_TOLERANCE)) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        SALES_ERRORS.PAYMENT_SPLIT_MISMATCH,
        drift.isNegative()
          ? `Your payment lines are ${drift.abs().toFixed(2)} short of net sales`
          : `Your payment lines are ${drift.toFixed(2)} over net sales`,
        {
          netSales: netSales.toFixed(2),
          paymentTotal: split.toFixed(2),
          drift: drift.abs().toFixed(2),
          tolerance: SPLIT_TOLERANCE.toFixed(2),
        },
      );
    }

    return { ...input, netSales };
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      SALES_ERRORS.SALES_ENTRY_NOT_FOUND,
      'That sales entry does not exist',
    );
  }
}

const DAY_MS = 86_400_000;

function dayUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function isoDate(value: Date | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((dayUtc(to).getTime() - dayUtc(from).getTime()) / DAY_MS);
}

function pick(patched: number | undefined, stored: Decimal): Decimal {
  return patched === undefined ? new Decimal(stored) : new Decimal(patched.toFixed(2));
}

function canUnlock(user: AuthedUser): boolean {
  return 'sales.entry.unlock' in grantsFor(user.roleKey);
}

function toMoneyJson(row: EntryRow): Prisma.InputJsonValue {
  return {
    grossSales: row.grossSales.toFixed(2),
    discounts: row.discounts.toFixed(2),
    netSales: row.netSales.toFixed(2),
    orderCount: row.orderCount,
    cashAmount: row.cashAmount.toFixed(2),
    upiAmount: row.upiAmount.toFixed(2),
    cardAmount: row.cardAmount.toFixed(2),
    otherAmount: row.otherAmount.toFixed(2),
  };
}

export function toEntryView(row: EntryRow) {
  return {
    id: row.id,
    outletId: row.outletId,
    outletCode: row.outlet.code,
    businessDate: isoDate(row.businessDate),
    grossSales: row.grossSales.toFixed(2),
    discounts: row.discounts.toFixed(2),
    netSales: row.netSales.toFixed(2),
    orderCount: row.orderCount,
    cashAmount: row.cashAmount.toFixed(2),
    upiAmount: row.upiAmount.toFixed(2),
    cardAmount: row.cardAmount.toFixed(2),
    otherAmount: row.otherAmount.toFixed(2),
    note: row.note,
    enteredById: row.enteredById,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
