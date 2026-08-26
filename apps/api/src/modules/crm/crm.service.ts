import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type RewardStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  CRM_ERRORS,
  paginate,
  type CreateRewardDto,
  type IssueRewardDto,
  type ListCustomersQuery,
  type RedeemCouponDto,
  type UpdateRewardDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { GameService } from './game.service';

// Crockford base32 drops I, L, O and U, so a code read aloud across a counter
// does not turn into a support call.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const COUPON_CHARS = 10;

function couponCode(): string {
  let bits = 0n;
  for (const byte of randomBytes(7)) bits = (bits << 8n) | BigInt(byte);
  let out = '';
  for (let i = 0; i < COUPON_CHARS; i += 1) {
    out = CROCKFORD.charAt(Number(bits & 31n)) + out;
    bits >>= 5n;
  }
  return `BM-${out}`;
}

/** +91 98xxxx3210. The cashier needs to recognise the customer, not read them. */
function maskPhone(phone: string): string {
  if (phone.length < 8) return 'xxxx';
  return `${phone.slice(0, 5)} ${phone.slice(5, 7)}xxxx${phone.slice(-4)}`;
}

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly games: GameService,
  ) {}

  // ---- customers ---------------------------------------------------------

  /**
   * Customer carries no outlet column, so an OWN_OUTLET grant has nothing to
   * filter on directly. The only outlet linkage in the data is where a coupon
   * was redeemed, so an outlet-scoped caller sees the customers who have
   * actually redeemed at one of their shops. A customer who has never been to
   * that outlet is not their business. An ALL_OUTLETS caller sees everyone.
   */
  private outletNarrowing(scope: RequestScope): Prisma.CustomerWhereInput {
    if (scope.allOutlets) return {};
    return { rewards: { some: { redeemedOutletId: { in: scope.outletIds } } } };
  }

  async listCustomers(query: ListCustomersQuery, scope: RequestScope) {
    const where: Prisma.CustomerWhereInput = {
      ...this.outletNarrowing(scope),
      ...(query.search
        ? {
            OR: [
              { phone: { contains: query.search } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { gamePlays: true, rewards: true } } },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(
      rows.map((c) => ({
        id: c.id,
        phone: maskPhone(c.phone),
        name: c.name,
        isGuest: c.isGuest,
        coinBalance: c.coinBalance,
        consentAt: c.consentAt?.toISOString() ?? null,
        playCount: c._count.gamePlays,
        rewardCount: c._count.rewards,
      })),
      total,
      query,
    );
  }

  async getCustomer(id: string, scope: RequestScope) {
    const customer = await this.prisma.customer.findFirst({
      // findFirst, not findUnique, so the outlet narrowing can join. An
      // out-of-scope customer reads as not existing, same as everywhere else.
      where: { id, ...this.outletNarrowing(scope) },
      include: {
        gamePlays: {
          orderBy: { playedAt: 'desc' },
          take: 50,
          include: { game: { select: { slug: true, name: true } } },
        },
        rewards: {
          orderBy: { createdAt: 'desc' },
          include: { definition: { select: { code: true, name: true, coinCost: true } } },
        },
      },
    });
    if (!customer) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        CRM_ERRORS.CUSTOMER_NOT_FOUND,
        'That customer does not exist',
      );
    }

    return {
      id: customer.id,
      phone: maskPhone(customer.phone),
      name: customer.name,
      isGuest: customer.isGuest,
      coinBalance: customer.coinBalance,
      consentAt: customer.consentAt?.toISOString() ?? null,
      plays: customer.gamePlays.map((p) => ({
        id: p.id,
        gameSlug: p.game.slug,
        gameName: p.game.name,
        score: p.score,
        coinsEarned: p.coinsEarned,
        playedAt: p.playedAt.toISOString(),
      })),
      rewards: customer.rewards.map(rewardView),
    };
  }

  // ---- reward catalogue --------------------------------------------------

  listRewards() {
    return this.prisma.rewardDefinition
      .findMany({ orderBy: { code: 'asc' } })
      .then((rows) => rows.map(definitionView));
  }

  async createReward(dto: CreateRewardDto) {
    await this.assertCodeFree(dto.code, null);
    const row = await this.prisma.rewardDefinition.create({
      data: {
        code: dto.code,
        name: dto.name,
        coinCost: dto.coinCost,
        description: dto.description ?? null,
        gameId: dto.gameId ?? null,
      },
    });
    return definitionView(row);
  }

  async updateReward(id: string, dto: UpdateRewardDto) {
    const existing = await this.prisma.rewardDefinition.findUnique({ where: { id } });
    if (!existing) throw this.rewardNotFound();
    if (dto.code) await this.assertCodeFree(dto.code, id);

    const row = await this.prisma.rewardDefinition.update({
      where: { id },
      data: {
        ...(dto.code === undefined ? {} : { code: dto.code }),
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.coinCost === undefined ? {} : { coinCost: dto.coinCost }),
        ...(dto.description === undefined ? {} : { description: dto.description }),
        ...(dto.gameId === undefined ? {} : { gameId: dto.gameId }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
    return definitionView(row);
  }

  // ---- issue and redeem --------------------------------------------------

  async issueReward(dto: IssueRewardDto, user: AuthedUser) {
    const definition = await this.prisma.rewardDefinition.findUnique({
      where: { id: dto.definitionId },
    });
    if (!definition) throw this.rewardNotFound();
    if (!definition.isActive) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        CRM_ERRORS.REWARD_INACTIVE,
        `${definition.name} is not being issued`,
      );
    }

    const validityDays = await this.games.couponValidityDays(definition.gameId);
    const expiresAt = new Date(Date.now() + validityDays * 86_400_000);

    const issue = await this.prisma.$transaction(async (tx) => {
      // The row lock is the whole correctness argument. Two tabs spending the
      // same coins must not both pass the balance check.
      const locked = await tx.$queryRaw<{ id: string; coinBalance: number }[]>`
        SELECT "id", "coinBalance" FROM "Customer" WHERE "id" = ${dto.customerId}::uuid FOR UPDATE`;
      const customer = locked[0];
      if (!customer) {
        throw new DomainError(
          HttpStatus.NOT_FOUND,
          CRM_ERRORS.CUSTOMER_NOT_FOUND,
          'That customer does not exist',
        );
      }
      if (customer.coinBalance < definition.coinCost) {
        throw new DomainError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          CRM_ERRORS.INSUFFICIENT_COINS,
          'Not enough coins for that reward',
          { coinBalance: customer.coinBalance, coinCost: definition.coinCost },
        );
      }

      await tx.customer.update({
        where: { id: customer.id },
        data: { coinBalance: { decrement: definition.coinCost } },
      });
      const created = await tx.rewardIssue.create({
        data: {
          customerId: customer.id,
          definitionId: definition.id,
          couponCode: couponCode(),
          expiresAt,
        },
        include: { definition: { select: { code: true, name: true, coinCost: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: 'crm.reward.issue',
          entityType: 'RewardIssue',
          entityId: created.id,
          after: {
            customerId: customer.id,
            definitionCode: definition.code,
            coinCost: definition.coinCost,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventKey: 'REWARD_ISSUED',
          aggregateType: 'RewardIssue',
          aggregateId: created.id,
          payload: {
            customerId: customer.id,
            couponCode: created.couponCode,
            rewardName: definition.name,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return { created, coinBalance: customer.coinBalance - definition.coinCost };
    });

    return { ...rewardView(issue.created), coinBalance: issue.coinBalance };
  }

  async redeemCoupon(id: string, dto: RedeemCouponDto, user: AuthedUser, scope: RequestScope) {
    // A cashier has one outlet and never sends the field. The owner has every
    // outlet, so there is nothing to guess from and the call has to say.
    const outletId = dto.outletId ?? (scope.outletIds.length === 1 ? scope.outletIds[0] : undefined);
    if (!outletId) {
      throw new DomainError(
        HttpStatus.BAD_REQUEST,
        CRM_ERRORS.REDEMPTION_OUTLET_REQUIRED,
        'Say which outlet is redeeming this coupon',
      );
    }

    const issue = await this.prisma.rewardIssue.findUnique({
      where: { id },
      include: { definition: { select: { code: true, name: true, coinCost: true } } },
    });
    if (!issue) throw this.couponNotFound();
    this.assertRedeemable(issue.status, issue.expiresAt, issue.redeemedOutletId, issue.redeemedAt);

    const redeemed = await this.prisma.$transaction(async (tx) => {
      // Conditional in SQL, so two cashiers scanning the same code at the same
      // moment produce one redemption and one 409. There is no un-redeem.
      const { count } = await tx.rewardIssue.updateMany({
        where: { id, status: 'ISSUED' },
        data: {
          status: 'REDEEMED',
          redeemedAt: new Date(),
          redeemedOutletId: outletId,
          redeemedById: user.sub,
        },
      });
      if (count === 0) return null;

      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: 'crm.reward.redeem',
          entityType: 'RewardIssue',
          entityId: id,
          outletId,
          before: { status: issue.status } as Prisma.InputJsonValue,
          after: { status: 'REDEEMED', redeemedOutletId: outletId } as Prisma.InputJsonValue,
        },
      });
      return tx.rewardIssue.findUniqueOrThrow({
        where: { id },
        include: { definition: { select: { code: true, name: true, coinCost: true } } },
      });
    });

    if (!redeemed) {
      const now = await this.prisma.rewardIssue.findUniqueOrThrow({ where: { id } });
      this.assertRedeemable(now.status, now.expiresAt, now.redeemedOutletId, now.redeemedAt);
      throw this.couponNotFound();
    }
    return rewardView(redeemed);
  }

  // ---- analytics ---------------------------------------------------------

  async analytics(scope: RequestScope) {
    // crm.analytics.read is granted at OWN_OUTLET to a store manager, so this
    // has to narrow the same way listCustomers does. Without it the Patia
    // manager reads group-wide customer counts, coins and coupon state.
    const customerWhere = this.outletNarrowing(scope);
    const playWhere = scope.allOutlets
      ? {}
      : { customer: { is: customerWhere } };
    const rewardWhere = scope.allOutlets
      ? {}
      : { redeemedOutletId: { in: scope.outletIds } };

    // Counts, not money. A drifting snapshot across seven reads is invisible
    // on a dashboard and not worth holding a transaction open for.
    const [customers, verified, plays, coins, byStatus, byGame, games] = await Promise.all([
      this.prisma.customer.count({ where: customerWhere }),
      this.prisma.customer.count({ where: { ...customerWhere, isGuest: false } }),
      this.prisma.gamePlay.count({ where: playWhere }),
      this.prisma.gamePlay.aggregate({ where: playWhere, _sum: { coinsEarned: true } }),
      this.prisma.rewardIssue.groupBy({
        by: ['status'],
        where: rewardWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.gamePlay.groupBy({
        by: ['gameId'],
        where: playWhere,
        orderBy: { gameId: 'asc' },
        _count: { _all: true },
        _sum: { coinsEarned: true },
      }),
      this.prisma.gameConfig.findMany({ select: { id: true, slug: true, name: true } }),
    ]);

    const coupons: Record<RewardStatus, number> = {
      ISSUED: 0,
      REDEEMED: 0,
      EXPIRED: 0,
      VOIDED: 0,
    };
    for (const row of byStatus) coupons[row.status] = row._count._all;

    return {
      customers: { total: customers, verified },
      plays: { total: plays, coinsCredited: coins._sum.coinsEarned ?? 0 },
      coupons,
      games: games.map((g) => {
        const row = byGame.find((b) => b.gameId === g.id);
        return {
          slug: g.slug,
          name: g.name,
          plays: row?._count._all ?? 0,
          coinsCredited: row?._sum.coinsEarned ?? 0,
        };
      }),
    };
  }

  // ---- internals ---------------------------------------------------------

  private assertRedeemable(
    status: RewardStatus,
    expiresAt: Date | null,
    redeemedOutletId: string | null,
    redeemedAt: Date | null,
  ): void {
    if (status === 'REDEEMED') {
      // The usual dispute is a customer at one outlet insisting the coupon is
      // unused when it was redeemed at the other an hour earlier.
      throw new DomainError(
        HttpStatus.CONFLICT,
        CRM_ERRORS.COUPON_ALREADY_REDEEMED,
        'That coupon has already been redeemed',
        { redeemedOutletId, redeemedAt: redeemedAt?.toISOString() ?? null },
      );
    }
    if (status === 'VOIDED') {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        CRM_ERRORS.COUPON_VOIDED,
        'That coupon was cancelled',
      );
    }
    if (status === 'EXPIRED' || (expiresAt !== null && expiresAt.getTime() < Date.now())) {
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        CRM_ERRORS.COUPON_EXPIRED,
        'That coupon has expired',
      );
    }
  }

  private async assertCodeFree(code: string, exceptId: string | null): Promise<void> {
    const clash = await this.prisma.rewardDefinition.findUnique({ where: { code } });
    if (clash && clash.id !== exceptId) {
      throw new DomainError(
        HttpStatus.CONFLICT,
        CRM_ERRORS.REWARD_CODE_TAKEN,
        `${code} is already used by another reward`,
      );
    }
  }

  private rewardNotFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      CRM_ERRORS.REWARD_NOT_FOUND,
      'That reward does not exist',
    );
  }

  private couponNotFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      CRM_ERRORS.COUPON_NOT_FOUND,
      'No coupon with that code',
    );
  }
}

interface DefinitionRow {
  id: string;
  code: string;
  name: string;
  coinCost: number;
  description: string | null;
  gameId: string | null;
  isActive: boolean;
}

function definitionView(row: DefinitionRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    coinCost: row.coinCost,
    description: row.description,
    gameId: row.gameId,
    isActive: row.isActive,
  };
}

interface IssueRow {
  id: string;
  couponCode: string;
  status: RewardStatus;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  redeemedOutletId: string | null;
  createdAt: Date;
  definition: { code: string; name: string; coinCost: number };
}

function rewardView(row: IssueRow) {
  return {
    id: row.id,
    couponCode: row.couponCode,
    status: row.status,
    rewardCode: row.definition.code,
    rewardName: row.definition.name,
    coinCost: row.definition.coinCost,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    redeemedOutletId: row.redeemedOutletId,
    issuedAt: row.createdAt.toISOString(),
  };
}
