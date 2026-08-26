import { z } from 'zod';
import { pageQuerySchema } from './pagination';
import { businessDateSchema, qtySchema, uuidSchema } from './inventory';

/** Money is Decimal(14,2). Two places, never a float in the database. */
export const moneySchema = z.coerce.number().nonnegative().max(99_999_999.99).finite();

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export const createVendorSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(INDIAN_MOBILE, 'Ten digits, starting 6 to 9').optional(),
    email: z.string().trim().email().max(120).optional(),
    address: z.string().trim().max(300).optional(),
    gstin: z.string().trim().toUpperCase().regex(GSTIN, 'That is not a valid GSTIN').optional(),
  })
  .strict();
export type CreateVendorDto = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateVendorDto = z.infer<typeof updateVendorSchema>;

export const listVendorsQuery = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(64).optional(),
  isActive: z.coerce.boolean().default(true),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuery>;

export const setVendorItemsSchema = z
  .object({ itemIds: z.array(uuidSchema).max(400) })
  .strict();
export type SetVendorItemsDto = z.infer<typeof setVendorItemsSchema>;

// ---- purchase requests ---------------------------------------------------

export const PURCHASE_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'FULFILLED',
] as const;

export const createRequestSchema = z
  .object({
    outletId: uuidSchema,
    neededBy: businessDateSchema.optional(),
    note: z.string().trim().max(500).optional(),
    lines: z
      .array(
        z.object({
          itemId: uuidSchema,
          quantity: qtySchema,
          note: z.string().trim().max(200).optional(),
        }),
      )
      .min(1)
      .max(60),
  })
  .strict()
  // The requester is a kitchen or store manager who knows what is running out,
  // not what it costs, so there is no price on a request line.
  .refine((o) => new Set(o.lines.map((l) => l.itemId)).size === o.lines.length, {
    path: ['lines'],
    message: 'The same item appears twice',
  });
export type CreateRequestDto = z.infer<typeof createRequestSchema>;

export const listRequestsQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  status: z.enum(PURCHASE_REQUEST_STATUSES).optional(),
  requestedById: uuidSchema.optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuery>;

export const decideRequestSchema = z
  .object({ decisionNote: z.string().trim().max(500).optional() })
  .strict();
export type DecideRequestDto = z.infer<typeof decideRequestSchema>;

// ---- purchases -----------------------------------------------------------

export const createPurchaseSchema = z
  .object({
    outletId: uuidSchema,
    vendorId: uuidSchema,
    requestId: uuidSchema.optional(),
    invoiceNo: z.string().trim().max(40).optional(),
    purchaseDate: businessDateSchema,
    taxAmount: moneySchema.default(0),
    note: z.string().trim().max(500).optional(),
    lines: z
      .array(z.object({ itemId: uuidSchema, quantity: qtySchema, unitPrice: moneySchema }))
      .min(1)
      .max(60),
  })
  // strict, so a client sending totalAmount gets a 400 rather than having it
  // silently ignored. The server computes every money field from the lines.
  .strict()
  .refine((o) => new Set(o.lines.map((l) => l.itemId)).size === o.lines.length, {
    path: ['lines'],
    message: 'The same item appears twice',
  });
export type CreatePurchaseDto = z.infer<typeof createPurchaseSchema>;

export const listPurchasesQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  vendorId: uuidSchema.optional(),
  status: z.enum(['DRAFT', 'RECORDED', 'VOIDED']).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuery>;

export const voidPurchaseSchema = z
  .object({ reason: z.string().trim().min(3).max(280) })
  .strict();
export type VoidPurchaseDto = z.infer<typeof voidPurchaseSchema>;

export const priceHistoryQuery = pageQuerySchema.extend({
  itemId: uuidSchema.optional(),
  vendorId: uuidSchema.optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type PriceHistoryQuery = z.infer<typeof priceHistoryQuery>;
