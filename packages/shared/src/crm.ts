import { z } from 'zod';
import { pageQuerySchema } from './pagination';
import { uuidSchema } from './inventory';

// Chapter 32 reconstructs this module: the SRS names it in the timeline and the
// acceptance criteria but never specifies it. Everything here follows from a
// fragment the SRS does contain. Nothing is invented on top.
export const CRM_ERRORS = {
  GAME_NOT_PUBLISHED: 'GAME_NOT_PUBLISHED',
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  SESSION_INVALID: 'SESSION_INVALID',
  SCORE_OUT_OF_RANGE: 'SCORE_OUT_OF_RANGE',
  PLAY_COOLDOWN_ACTIVE: 'PLAY_COOLDOWN_ACTIVE',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  REWARD_NOT_FOUND: 'REWARD_NOT_FOUND',
  REWARD_INACTIVE: 'REWARD_INACTIVE',
  REWARD_CODE_TAKEN: 'REWARD_CODE_TAKEN',
  INSUFFICIENT_COINS: 'INSUFFICIENT_COINS',
  COUPON_NOT_FOUND: 'COUPON_NOT_FOUND',
  COUPON_ALREADY_REDEEMED: 'COUPON_ALREADY_REDEEMED',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_VOIDED: 'COUPON_VOIDED',
  REDEMPTION_OUTLET_REQUIRED: 'REDEMPTION_OUTLET_REQUIRED',
} as const;
export type CrmErrorCode = (typeof CRM_ERRORS)[keyof typeof CRM_ERRORS];

export const REWARD_STATUSES = ['ISSUED', 'REDEEMED', 'EXPIRED', 'VOIDED'] as const;
export type RewardStatusValue = (typeof REWARD_STATUSES)[number];

/** The slug the website already has in its game URLs. */
export const gameSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lower case letters, digits and hyphens');

/** E.164. The website collects a phone number and nothing else. */
export const customerPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use the international form, for example +919876543210');

// Validated on every write so a malformed rule set cannot reach the database
// and break the public config endpoint that anonymous browsers depend on.
export const gameRulesSchema = z
  .object({
    maxScore: z.number().int().positive().max(10_000_000),
    coinsPerPoint: z.number().positive().max(1_000),
    coinRounding: z.enum(['floor', 'round']).default('floor'),
    maxCoinsPerPlay: z.number().int().positive().max(10_000),
    cooldownSeconds: z.number().int().nonnegative().max(86_400).default(300),
    couponValidityDays: z.number().int().positive().max(365).default(30),
    display: z
      .object({
        title: z.string().trim().min(1).max(120),
        instructions: z.string().trim().max(500).default(''),
        themeColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, 'Six digit hex, for example #B71C1C')
          .optional(),
      })
      .strict(),
  })
  .strict();
export type GameRules = z.infer<typeof gameRulesSchema>;

// ---- public game API -----------------------------------------------------

export const submitPlaySchema = z
  .object({
    sessionKey: z.string().min(20).max(2048),
    score: z.number().int().nonnegative(),
    durationMs: z.number().int().positive().max(3_600_000),
    // Coins need an identity to hang off. Decision 7 in chapter 04: a guest
    // plays and sees a score, a known phone number earns.
    phone: customerPhoneSchema.optional(),
  })
  .strict();
export type SubmitPlayDto = z.infer<typeof submitPlaySchema>;

/** What the website renders. Server side abuse limits are not in here. */
export interface PublicGameConfig {
  slug: string;
  name: string;
  version: number;
  rules: Omit<GameRules, 'couponValidityDays'>;
}

export interface PlaySessionView {
  sessionKey: string;
  expiresIn: number;
}

export interface SubmitPlayView {
  score: number;
  coinsEarned: number;
  coinsCredited: boolean;
  coinBalance: number | null;
  message: string;
}

// ---- staff API -----------------------------------------------------------

export const listCustomersQuery = pageQuerySchema.extend({
  search: z.string().trim().min(1).max(40).optional(),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuery>;

export const upsertGameConfigSchema = z
  .object({
    slug: gameSlugSchema,
    name: z.string().trim().min(2).max(120),
    rulesJson: gameRulesSchema,
  })
  .strict();
export type UpsertGameConfigDto = z.infer<typeof upsertGameConfigSchema>;

export const publishGameSchema = z.object({ slug: gameSlugSchema }).strict();
export type PublishGameDto = z.infer<typeof publishGameSchema>;

export const createRewardSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Upper case letters, digits, hyphen and underscore'),
    name: z.string().trim().min(2).max(120),
    coinCost: z.number().int().positive().max(1_000_000),
    description: z.string().trim().max(500).optional(),
    gameId: uuidSchema.optional(),
  })
  .strict();
export type CreateRewardDto = z.infer<typeof createRewardSchema>;

export const updateRewardSchema = createRewardSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();
export type UpdateRewardDto = z.infer<typeof updateRewardSchema>;

export const issueRewardSchema = z
  .object({ customerId: uuidSchema, definitionId: uuidSchema })
  .strict();
export type IssueRewardDto = z.infer<typeof issueRewardSchema>;

export const redeemCouponSchema = z.object({ outletId: uuidSchema.optional() }).strict();
export type RedeemCouponDto = z.infer<typeof redeemCouponSchema>;
