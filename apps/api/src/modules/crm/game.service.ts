import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  CRM_ERRORS,
  ERROR_CODES,
  gameRulesSchema,
  type GameRules,
  type PlaySessionView,
  type PublicGameConfig,
  type SubmitPlayDto,
  type SubmitPlayView,
  type UpsertGameConfigDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { AuthedUser } from '../../common/types/request';
import { env } from '../../config/env';

const SESSION_TTL_SECONDS = 1800;
const CONFIG_CACHE_TTL_SECONDS = 600;

// From the abuse control table in chapter 32.
const IP_CONFIG_LIMIT = 60;
const IP_PLAY_LIMIT = 20;
const RATE_WINDOW_SECONDS = 60;

interface SessionPayload {
  /** slug, so a token minted for one game cannot be spent on another */
  s: string;
  /** the id that lands in GamePlay.sessionKey */
  j: string;
  /** expiry, epoch seconds */
  e: number;
}

interface CachedGame {
  id: string;
  slug: string;
  name: string;
  version: number;
  rules: GameRules;
}

function configKey(slug: string): string {
  return `crm:game:config:${slug}`;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---- public surface ----------------------------------------------------

  async publicConfig(slug: string, ip: string): Promise<PublicGameConfig> {
    await this.rateLimit(`crm:rl:config:${ip}`, IP_CONFIG_LIMIT, RATE_WINDOW_SECONDS);
    const game = await this.publishedGame(slug);
    // Named one by one rather than spread minus a key, so a rule added later
    // has to be opted in to before an anonymous browser can read it.
    // couponValidityDays stays back: the game has no use for it.
    return {
      slug: game.slug,
      name: game.name,
      version: game.version,
      rules: {
        maxScore: game.rules.maxScore,
        coinsPerPoint: game.rules.coinsPerPoint,
        coinRounding: game.rules.coinRounding,
        maxCoinsPerPlay: game.rules.maxCoinsPerPlay,
        cooldownSeconds: game.rules.cooldownSeconds,
        display: game.rules.display,
      },
    };
  }

  async startSession(slug: string, ip: string): Promise<PlaySessionView> {
    await this.rateLimit(`crm:rl:session:${ip}`, IP_CONFIG_LIMIT, RATE_WINDOW_SECONDS);
    await this.publishedGame(slug);
    const payload: SessionPayload = {
      s: slug,
      j: randomUUID(),
      e: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
    return { sessionKey: this.signSession(payload), expiresIn: SESSION_TTL_SECONDS };
  }

  async submitPlay(slug: string, dto: SubmitPlayDto, ip: string): Promise<SubmitPlayView> {
    await this.rateLimit(`crm:rl:play:${ip}`, IP_PLAY_LIMIT, RATE_WINDOW_SECONDS);

    const session = this.verifySession(dto.sessionKey, slug);
    const game = await this.publishedGame(slug);

    // Server authoritative and rejected rather than clamped: a score above the
    // ceiling is impossible under honest play, so it is evidence of tampering
    // and nothing about it should be stored as if it were a real play.
    if (dto.score > game.rules.maxScore) {
      this.logger.warn(`score ${dto.score} over ceiling on ${slug} from session ${session.j}`);
      throw new DomainError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        CRM_ERRORS.SCORE_OUT_OF_RANGE,
        'That score is not possible in this game',
      );
    }

    if (game.rules.cooldownSeconds > 0) {
      await this.rateLimit(
        `crm:rl:play:sess:${session.j}`,
        1,
        game.rules.cooldownSeconds,
        CRM_ERRORS.PLAY_COOLDOWN_ACTIVE,
        'Take a short break before your next play',
      );
    }

    const coinsEarned = coinsFor(dto.score, game.rules);
    const customer = dto.phone ? await this.verifiedCustomer(dto.phone) : null;

    const balance = await this.prisma.$transaction(async (tx) => {
      await tx.gamePlay.create({
        data: {
          gameId: game.id,
          customerId: customer?.id ?? null,
          sessionKey: session.j,
          score: dto.score,
          // A guest banks nothing, so nothing is recorded against the play.
          // Summing this column has to equal the coins actually in circulation.
          coinsEarned: customer ? coinsEarned : 0,
          ipHash: createHash('sha256').update(ip).digest('hex'),
        },
      });
      if (!customer) return null;
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { coinBalance: { increment: coinsEarned } },
      });
      return updated.coinBalance;
    });

    return {
      score: dto.score,
      coinsEarned,
      coinsCredited: customer !== null,
      coinBalance: balance,
      message: customer ? 'Coins added to your balance' : 'Verify your phone to keep these coins',
    };
  }

  // ---- staff surface -----------------------------------------------------

  async listConfigs() {
    const rows = await this.prisma.gameConfig.findMany({ orderBy: { slug: 'asc' } });
    return rows.map((g) => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      rulesJson: g.rulesJson,
      isPublished: g.isPublished,
      publishedAt: g.publishedAt?.toISOString() ?? null,
      version: g.version,
    }));
  }

  async upsertConfig(dto: UpsertGameConfigDto, user: AuthedUser) {
    const before = await this.prisma.gameConfig.findUnique({ where: { slug: dto.slug } });
    const rules = dto.rulesJson as unknown as Prisma.InputJsonValue;

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gameConfig.upsert({
        where: { slug: dto.slug },
        create: { slug: dto.slug, name: dto.name, rulesJson: rules },
        update: { name: dto.name, rulesJson: rules },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: 'crm.game.configure',
          entityType: 'GameConfig',
          entityId: row.id,
          before: (before?.rulesJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          after: rules,
        },
      });
      return row;
    });

    // An edit to a published game must not go live until publish says so, but
    // the cached copy is keyed on slug and would otherwise still be the old
    // name. Dropping it is cheaper than reasoning about which fields moved.
    await this.redis.del(configKey(dto.slug));
    return { id: saved.id, slug: saved.slug, version: saved.version, isPublished: saved.isPublished };
  }

  async publish(slug: string, user: AuthedUser) {
    const before = await this.prisma.gameConfig.findUnique({ where: { slug } });
    if (!before) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        CRM_ERRORS.GAME_NOT_FOUND,
        'That game does not exist',
      );
    }

    const published = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gameConfig.update({
        where: { slug },
        data: { isPublished: true, publishedAt: new Date(), version: { increment: 1 } },
      });
      // version is a counter, not a history table. The full rule set goes in
      // the audit row so the history exists even though no screen shows it.
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.sub,
          action: 'crm.game.publish',
          entityType: 'GameConfig',
          entityId: row.id,
          before: { version: before.version, rulesJson: before.rulesJson } as Prisma.InputJsonValue,
          after: { version: row.version, rulesJson: row.rulesJson } as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    // A manager who changes a rule and then watches the website for ten
    // minutes waiting for it to take will file a bug.
    await this.redis.del(configKey(slug));
    return {
      id: published.id,
      slug: published.slug,
      version: published.version,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    };
  }

  /** Reward issue needs the coupon window, which lives in the game rule set. */
  async couponValidityDays(gameId: string | null): Promise<number> {
    if (!gameId) return 30;
    const row = await this.prisma.gameConfig.findUnique({ where: { id: gameId } });
    const parsed = gameRulesSchema.safeParse(row?.rulesJson);
    return parsed.success ? parsed.data.couponValidityDays : 30;
  }

  // ---- internals ---------------------------------------------------------

  private async publishedGame(slug: string): Promise<CachedGame> {
    const cached = await this.redis.get<CachedGame>(configKey(slug));
    if (cached) return cached;

    const row = await this.prisma.gameConfig.findUnique({ where: { slug } });
    // One code for "no such game" and "not published yet". Two codes would let
    // anyone map the unreleased games by probing slugs.
    if (!row?.isPublished) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        CRM_ERRORS.GAME_NOT_PUBLISHED,
        'That game is not available',
      );
    }

    const rules = gameRulesSchema.safeParse(row.rulesJson);
    if (!rules.success) {
      this.logger.error(`game ${slug} has a rule set that no longer validates`);
      throw new DomainError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ERROR_CODES.COMMON_INTERNAL,
        'That game is not available',
      );
    }

    const game: CachedGame = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      version: row.version,
      rules: rules.data,
    };
    await this.redis.set(configKey(slug), game, CONFIG_CACHE_TTL_SECONDS);
    return game;
  }

  /** Coins need someone to belong to. An unknown number is treated as a guest. */
  private async verifiedCustomer(phone: string) {
    const customer = await this.prisma.customer.findUnique({ where: { phone } });
    // Creating the row here would hand anyone a balance for a number they do
    // not own. Customers are created by the verification flow, never by a play.
    return customer && !customer.isGuest ? customer : null;
  }

  private sessionSecret(): Buffer {
    // Derived from the staff signing secret under a fixed label, so a staff
    // access token can never be presented as a game session and back again,
    // without adding a second secret to the deployment.
    return createHmac('sha256', env().JWT_ACCESS_SECRET).update('crm:game-session').digest();
  }

  private signSession(payload: SessionPayload): string {
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = b64url(createHmac('sha256', this.sessionSecret()).update(body).digest());
    return `${body}.${sig}`;
  }

  private verifySession(token: string, slug: string): SessionPayload {
    const invalid = new DomainError(
      HttpStatus.UNAUTHORIZED,
      CRM_ERRORS.SESSION_INVALID,
      'Start the game again',
    );
    const [body, sig] = token.split('.');
    if (!body || !sig) throw invalid;

    const expected = createHmac('sha256', this.sessionSecret()).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid;

    let payload: SessionPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    } catch {
      throw invalid;
    }
    if (payload.s !== slug || payload.e * 1000 < Date.now()) throw invalid;
    return payload;
  }

  /**
   * Fixed window counter. Two things are deliberate. A Redis miss reads as
   * zero, so the endpoint keeps serving when Redis is down: these routes are
   * the customer facing website, and a limiter that fails closed turns a cache
   * outage into a site outage. And the read-modify-write is not atomic, so a
   * simultaneous burst can overshoot by the number of concurrent workers.
   * ponytail: good enough at two outlets. Upgrade path is INCR plus EXPIRE
   * added to RedisService, which is atomic in one round trip.
   */
  private async rateLimit(
    prefix: string,
    limit: number,
    windowSeconds: number,
    code: string = ERROR_CODES.COMMON_RATE_LIMITED,
    message = 'Too many requests, try again shortly',
  ): Promise<void> {
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `${prefix}:${bucket}`;
    const used = (await this.redis.get<number>(key)) ?? 0;
    if (used >= limit) {
      throw new DomainError(HttpStatus.TOO_MANY_REQUESTS, code, message);
    }
    await this.redis.set(key, used + 1, windowSeconds);
  }
}

export function coinsFor(score: number, rules: GameRules): number {
  const raw = score * rules.coinsPerPoint;
  // floor by default: a rule that rounds up pays a coin for a score of zero.
  const rounded = rules.coinRounding === 'round' ? Math.round(raw) : Math.floor(raw);
  return Math.max(0, Math.min(rounded, rules.maxCoinsPerPlay));
}
