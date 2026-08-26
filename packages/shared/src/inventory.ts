import { z } from 'zod';
import { pageQuerySchema } from './pagination';

export const uuidSchema = z.string().uuid();

/** Quantities are Decimal(14,3) in the database. Never a float in transit. */
export const qtySchema = z.coerce.number().positive().max(99_999_999).finite();
export const signedQtySchema = z.coerce
  .number()
  .finite()
  .refine((v) => v !== 0, 'An adjustment of zero changes nothing');

/** "2026-08-26". Compared as a string, which sorts correctly for ISO dates. */
export const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const MANUAL_TXN_TYPES = ['OPENING', 'RECEIVED', 'ISSUED', 'WASTAGE', 'ADJUSTMENT'] as const;
export const ALL_TXN_TYPES = [
  ...MANUAL_TXN_TYPES,
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CLOSING',
] as const;

export const recordTransactionSchema = z
  .object({
    itemId: uuidSchema,
    outletId: uuidSchema,
    type: z.enum(MANUAL_TXN_TYPES),
    quantity: qtySchema.optional(),
    signedQty: signedQtySchema.optional(),
    businessDate: businessDateSchema,
    reason: z.string().trim().min(3).max(280).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((o) => (o.type === 'ADJUSTMENT' ? o.signedQty !== undefined : o.quantity !== undefined), {
    message: 'ADJUSTMENT needs signedQty, every other type needs quantity',
  })
  .refine((o) => !['WASTAGE', 'ADJUSTMENT'].includes(o.type) || !!o.reason, {
    path: ['reason'],
    message: 'A reason is required for this type',
  });
export type RecordTransactionDto = z.infer<typeof recordTransactionSchema>;

export const listTransactionsQuery = pageQuerySchema
  .extend({
    outletId: uuidSchema.optional(),
    itemId: uuidSchema.optional(),
    categoryId: uuidSchema.optional(),
    type: z.enum(ALL_TXN_TYPES).optional(),
    from: businessDateSchema.optional(),
    to: businessDateSchema.optional(),
    createdById: uuidSchema.optional(),
  })
  .refine((o) => !o.from || !o.to || o.from <= o.to, {
    path: ['to'],
    message: 'to must not be before from',
  });
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuery>;

export const listStockQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
  belowReorder: z.coerce.boolean().optional(),
});
export type ListStockQuery = z.infer<typeof listStockQuery>;

export const listItemsQuery = pageQuerySchema.extend({
  categoryId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
  includeInactive: z.coerce.boolean().optional(),
});
export type ListItemsQuery = z.infer<typeof listItemsQuery>;

export const createItemSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .regex(/^ITM-[A-Z0-9-]{2,40}$/, 'SKU looks like ITM-CHICKEN-MINCE'),
    name: z.string().trim().min(2).max(120),
    categoryId: uuidSchema,
    unitId: uuidSchema,
    isPerishable: z.boolean().default(false),
  })
  .strict();
export type CreateItemDto = z.infer<typeof createItemSchema>;

export const updateItemSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    categoryId: uuidSchema.optional(),
    isPerishable: z.boolean().optional(),
  })
  .strict();
export type UpdateItemDto = z.infer<typeof updateItemSchema>;

export const setReorderLevelSchema = z
  .object({
    outletId: uuidSchema,
    // null clears the threshold, which turns the alert off for that pair.
    reorderLevel: z.coerce.number().nonnegative().max(99_999_999).nullable(),
  })
  .strict();
export type SetReorderLevelDto = z.infer<typeof setReorderLevelSchema>;
