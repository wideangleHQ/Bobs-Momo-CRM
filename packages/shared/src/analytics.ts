// Contracts for daily sales entry (chapter 30) and the reporting layer
// (chapter 31). Both live in one file because the reports read the sales table
// and share its date rules.
import { z } from 'zod';
import { businessDateSchema, uuidSchema } from './inventory';
import { pageQuerySchema } from './pagination';
import { moneySchema } from './purchase';

export const SALES_ERRORS = {
  SALES_ENTRY_NOT_FOUND: 'SALES_ENTRY_NOT_FOUND',
  SALES_ENTRY_EXISTS: 'SALES_ENTRY_EXISTS',
  SALES_ENTRY_LOCKED: 'SALES_ENTRY_LOCKED',
  SALES_ENTRY_FUTURE_DATE: 'SALES_ENTRY_FUTURE_DATE',
  SALES_ENTRY_WINDOW_CLOSED: 'SALES_ENTRY_WINDOW_CLOSED',
  DISCOUNT_EXCEEDS_GROSS: 'DISCOUNT_EXCEEDS_GROSS',
  PAYMENT_SPLIT_MISMATCH: 'PAYMENT_SPLIT_MISMATCH',
} as const;

export const ANALYTICS_ERRORS = {
  DATE_RANGE_TOO_LARGE: 'DATE_RANGE_TOO_LARGE',
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
} as const;

/** Money in transit is a number with at most two places. Decimal in the database. */
const money = moneySchema.multipleOf(0.01, 'Use at most two decimal places');

// netSales is absent on purpose. The server computes it from grossSales and
// discounts, and .strict() turns a client that sends it into a 400 naming the
// field rather than a stored net that contradicts its own inputs.
export const createSalesEntrySchema = z
  .object({
    outletId: uuidSchema,
    businessDate: businessDateSchema,
    grossSales: money,
    discounts: money.default(0),
    orderCount: z.coerce.number().int().nonnegative().nullish(),
    cashAmount: money.default(0),
    upiAmount: money.default(0),
    cardAmount: money.default(0),
    otherAmount: money.default(0),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateSalesEntryDto = z.infer<typeof createSalesEntrySchema>;

// outletId and businessDate are not patchable. Moving an entry to another day
// is a delete and a create, and the unique key makes the naive version fail in
// confusing ways.
export const updateSalesEntrySchema = createSalesEntrySchema
  .omit({ outletId: true, businessDate: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field' });
export type UpdateSalesEntryDto = z.infer<typeof updateSalesEntrySchema>;

export const listSalesEntriesQuery = pageQuerySchema
  .extend({
    outletId: uuidSchema.optional(),
    from: businessDateSchema.optional(),
    to: businessDateSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'to must not be before from',
  });
export type ListSalesEntriesQuery = z.infer<typeof listSalesEntriesQuery>;

// ---- analytics -----------------------------------------------------------

const reportShape = {
  from: businessDateSchema,
  to: businessDateSchema,
  outletId: uuidSchema.optional(),
};
const orderedRange = (q: { from: string; to: string }): boolean => q.from <= q.to;
const orderedRangeMessage = { path: ['to'], message: 'to must not be before from' };

export const reportQuerySchema = z
  .object(reportShape)
  .strict()
  .refine(orderedRange, orderedRangeMessage);
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const salesReportQuery = z
  .object({ ...reportShape, groupBy: z.enum(['outlet', 'combined']).default('outlet') })
  .strict()
  .refine(orderedRange, orderedRangeMessage);
export type SalesReportQuery = z.infer<typeof salesReportQuery>;

export const consumptionQuery = z
  .object({
    ...reportShape,
    categoryId: uuidSchema.optional(),
    itemId: uuidSchema.optional(),
    type: z.enum(['ALL', 'ISSUED', 'WASTAGE']).default('ALL'),
  })
  .strict()
  .refine(orderedRange, orderedRangeMessage);
export type ConsumptionQuery = z.infer<typeof consumptionQuery>;

export const wasteQuery = z
  .object({
    ...reportShape,
    categoryId: uuidSchema.optional(),
    itemId: uuidSchema.optional(),
    groupBy: z.enum(['item', 'category', 'reason']).default('item'),
  })
  .strict()
  .refine(orderedRange, orderedRangeMessage);
export type WasteQuery = z.infer<typeof wasteQuery>;

export const ANALYTICS_REPORTS = [
  'sales',
  'consumption',
  'performance',
  'waste',
  'gross-margin',
] as const;
export type AnalyticsReport = (typeof ANALYTICS_REPORTS)[number];

export const exportQuery = z
  .object({
    ...reportShape,
    report: z.enum(ANALYTICS_REPORTS),
    categoryId: uuidSchema.optional(),
    itemId: uuidSchema.optional(),
    groupBy: z.enum(['outlet', 'combined', 'item', 'category', 'reason']).optional(),
  })
  .strict()
  .refine(orderedRange, orderedRangeMessage);
export type ExportQuery = z.infer<typeof exportQuery>;

/** Inclusive day counts. Chapter 31, query performance. */
export const MAX_SPAN_DAYS: Record<AnalyticsReport | 'dashboard', number> = {
  sales: 366,
  'gross-margin': 366,
  performance: 186,
  consumption: 92,
  waste: 92,
  dashboard: 366,
};

export const EXPORT_ROW_CAP = 50_000;

// Said in full on every gross margin response. Without a recipe, a bill of
// materials or POS line items there is no cost of goods sold to compute, so
// this figure is sales less what was bought in the same window and nothing else.
export const GROSS_MARGIN_CAVEAT =
  'Approximation. Net sales entered by the outlet, less purchases recorded in the same period. ' +
  'Excludes labour, rent, utilities, taxes, aggregator commission, packaging actually consumed ' +
  'and inventory valuation. This is not profit and not an accounting P&L.';

export const GROSS_MARGIN_EXCLUDES = [
  'Labour and salaries: SalaryRecord stores structure only, no payroll computation exists',
  'Rent and utilities: no expense ledger exists in the schema',
  'Packaging and consumables actually used: purchases are counted when bought, not when consumed',
  'Delivery aggregator commission: otherAmount holds the settled amount, not the gross',
  'Taxes: purchase tax is captured, no sales tax breakdown exists',
  'Opening and closing inventory value: no stock valuation, so purchase cost is cash out, not cost of goods sold',
] as const;

/**
 * "400000.00" to "4,00,000.00". Last three digits, then pairs, which is how
 * every printed total in Bhubaneswar reads. Works on the digit string so a
 * Decimal never has to pass through a float to be displayed.
 */
export function formatIndianNumber(value: string): string {
  const negative = value.startsWith('-');
  const parts = (negative ? value.slice(1) : value).split('.');
  const whole = parts[0] ?? '0';
  const fraction = parts[1];
  const head = whole.length > 3 ? whole.slice(0, -3) : '';
  const tail = whole.length > 3 ? whole.slice(-3) : whole;
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}
