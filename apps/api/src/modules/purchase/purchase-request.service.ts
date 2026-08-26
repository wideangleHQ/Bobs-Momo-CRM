import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type PurchaseRequestStatus } from '@prisma/client';
import {
  ERROR_CODES,
  paginate,
  toBusinessDate,
  type CreateRequestDto,
  type DecideRequestDto,
  type ListRequestsQuery,
} from '@bobs-momo/shared';
import { DocumentNumberService } from '../../common/documents/document-number.service';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { narrowOutlets } from '../../common/types/request';
import type { AuthedUser, RequestScope } from '../../common/types/request';

// The SRS is explicit: one manager decision, no approval chain. Every allowed
// transition is here and nothing else is allowed. An approved request cannot be
// un-approved and a rejected one cannot be revived; the requester raises a new
// one, which takes eight seconds and leaves a truthful history.
const ALLOWED_FROM: Record<string, PurchaseRequestStatus[]> = {
  APPROVED: ['PENDING'],
  REJECTED: ['PENDING'],
  CANCELLED: ['PENDING'],
  FULFILLED: ['APPROVED'],
};

const REQUEST_INCLUDE = {
  outlet: { select: { code: true } },
  lines: {
    include: { item: { select: { id: true, name: true, unit: { select: { code: true } } } } },
  },
} satisfies Prisma.PurchaseRequestInclude;

@Injectable()
export class PurchaseRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentNumberService,
  ) {}

  async list(query: ListRequestsQuery, scope: RequestScope) {
    const outletIds = narrowOutlets(query.outletId, scope);
    const where: Prisma.PurchaseRequestWhereInput = {
      outletId: { in: outletIds },
      ...(query.status ? { status: query.status } : {}),
      ...(query.requestedById ? { requestedById: query.requestedById } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { outlet: { select: { code: true } }, _count: { select: { lines: true } } },
      }),
      this.prisma.purchaseRequest.count({ where }),
    ]);

    return paginate(
      rows.map((r) => ({
        id: r.id,
        requestNo: r.requestNo,
        outletId: r.outletId,
        outletCode: r.outlet.code,
        status: r.status,
        neededBy: r.neededBy?.toISOString().slice(0, 10) ?? null,
        lineCount: r._count.lines,
        requestedById: r.requestedById,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async get(id: string, scope: RequestScope) {
    const request = await this.prisma.purchaseRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    // 404 rather than 403 for another outlet's request, same reasoning as the
    // outlet guard: a 403 confirms the id is real.
    if (!request || !scope.outletIds.includes(request.outletId)) throw this.notFound();
    return toRequestView(request);
  }

  async create(dto: CreateRequestDto, user: AuthedUser, scope: RequestScope) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();

    if (dto.neededBy && dto.neededBy < toBusinessDate()) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.PR_NEEDED_BY_IN_PAST,
        'That date has already passed',
      );
    }

    const itemIds = dto.lines.map((l) => l.itemId);
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: itemIds } } });
    if (items.length !== itemIds.length) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.INVENTORY_ITEM_NOT_FOUND,
        'One of those items does not exist',
      );
    }
    const retired = items.find((i) => !i.isActive);
    if (retired) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.INVENTORY_ITEM_INACTIVE,
        `${retired.name} is no longer in use`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const requestNo = await this.documents.format(tx, 'PR', new Date().getUTCFullYear());
      const request = await tx.purchaseRequest.create({
        data: {
          requestNo,
          outletId: dto.outletId,
          neededBy: dto.neededBy ? new Date(`${dto.neededBy}T00:00:00.000Z`) : null,
          note: dto.note ?? null,
          requestedById: user.sub,
          lines: {
            create: dto.lines.map((l) => ({
              itemId: l.itemId,
              quantity: new Prisma.Decimal(l.quantity.toFixed(3)),
              note: l.note ?? null,
            })),
          },
        },
        include: REQUEST_INCLUDE,
      });

      await tx.outboxEvent.create({
        data: {
          eventKey: 'PURCHASE_REQUESTED',
          aggregateType: 'PurchaseRequest',
          aggregateId: request.id,
          payload: {
            requestNo: request.requestNo,
            outletId: request.outletId,
            lineCount: dto.lines.length,
            requestedById: user.sub,
          },
        },
      });

      return request;
    });

    return toRequestView(created);
  }

  async decide(
    id: string,
    to: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    dto: DecideRequestDto,
    user: AuthedUser,
    scope: RequestScope,
  ) {
    const request = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!request || !scope.outletIds.includes(request.outletId)) throw this.notFound();
    assertTransition(request.status, to);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: to,
          decidedById: user.sub,
          decidedAt: new Date(),
          decisionNote: dto.decisionNote ?? null,
        },
        include: REQUEST_INCLUDE,
      });

      // Cancel emits nothing. A request nobody has acted on yet is not news.
      if (to !== 'CANCELLED') {
        await tx.outboxEvent.create({
          data: {
            eventKey: 'PURCHASE_DECIDED',
            aggregateType: 'PurchaseRequest',
            aggregateId: id,
            payload: {
              requestNo: row.requestNo,
              outletId: row.outletId,
              status: to,
              decidedById: user.sub,
              requestedById: row.requestedById,
            },
          },
        });
      }
      return row;
    });

    return toRequestView(updated);
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.PR_NOT_FOUND,
      'That request does not exist',
    );
  }
}

export function assertTransition(from: PurchaseRequestStatus, to: string): void {
  if (!ALLOWED_FROM[to]?.includes(from)) {
    throw DomainError.conflict(
      ERROR_CODES.PR_INVALID_TRANSITION,
      `A ${from.toLowerCase()} request cannot be ${to.toLowerCase()}`,
      { currentStatus: from, attempted: to },
    );
  }
}

type RequestRow = Prisma.PurchaseRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

function toRequestView(r: RequestRow) {
  return {
    id: r.id,
    requestNo: r.requestNo,
    outletId: r.outletId,
    outletCode: r.outlet.code,
    status: r.status,
    neededBy: r.neededBy?.toISOString().slice(0, 10) ?? null,
    note: r.note,
    lines: r.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      name: l.item.name,
      unitCode: l.item.unit.code,
      quantity: l.quantity.toFixed(3),
      note: l.note,
    })),
    requestedById: r.requestedById,
    decidedById: r.decidedById,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  };
}
