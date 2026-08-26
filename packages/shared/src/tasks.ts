import { z } from 'zod';
import { pageQuerySchema } from './pagination';
import { businessDateSchema, uuidSchema } from './inventory';

// Mirrors of the Prisma enums. Chapter 20.
export const TASK_KINDS = [
  'ONE_OFF',
  'RECURRING_INSTANCE',
  'CHECKLIST_RUN',
  'AUDIT_RUN',
] as const;
export type TaskKindKey = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'CANCELLED',
  'OVERDUE',
] as const;
export type TaskStatusKey = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TaskPriorityKey = (typeof TASK_PRIORITIES)[number];

export const CHECKLIST_ITEM_RESULTS = ['PASS', 'FAIL', 'NA'] as const;
export type ChecklistItemResultKey = (typeof CHECKLIST_ITEM_RESULTS)[number];

export const TASK_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const TASK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Hours a follow-up task from a failed audit item gets before it is late. */
export const AUDIT_FOLLOW_UP_HOURS = 24;

export const TASK_ERRORS = {
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_INVALID_TRANSITION: 'TASK_INVALID_TRANSITION',
  CHECKLIST_INCOMPLETE: 'CHECKLIST_INCOMPLETE',
  PHOTO_REQUIRED: 'PHOTO_REQUIRED',
  NOTE_REQUIRED: 'NOTE_REQUIRED',
  VERIFICATION_NOT_REQUIRED: 'VERIFICATION_NOT_REQUIRED',
  TEMPLATE_MISMATCH: 'TEMPLATE_MISMATCH',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  DUPLICATE_TEMPLATE_CODE: 'DUPLICATE_TEMPLATE_CODE',
  ATTACHMENT_TOO_LARGE: 'ATTACHMENT_TOO_LARGE',
  UNSUPPORTED_MIME_TYPE: 'UNSUPPORTED_MIME_TYPE',
  ASSIGNEE_OUTLET_MISMATCH: 'ASSIGNEE_OUTLET_MISMATCH',
  EMPLOYEE_NOT_ACTIVE: 'EMPLOYEE_NOT_ACTIVE',
  RECURRENCE_NOT_FOUND: 'RECURRENCE_NOT_FOUND',
  INVALID_CRON_EXPRESSION: 'INVALID_CRON_EXPRESSION',
} as const;
export type TaskErrorCode = (typeof TASK_ERRORS)[keyof typeof TASK_ERRORS];

/**
 * Shape check only, five fields. The service parses the expression for real
 * with cron-parser; the shared package must not carry that dependency.
 */
export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^[0-9*,\-/]+$/.test(p));
}

/** A repeated query parameter arrives as an array, a CSV one as a string. */
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(
      (v) =>
        typeof v === 'string'
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : v,
      z.array(z.enum(values)).min(1),
    )
    .optional();
}

// ---- tasks ---------------------------------------------------------------

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(2000).nullish(),
    outletId: uuidSchema,
    departmentId: uuidSchema.nullish(),
    assigneeId: uuidSchema.nullish(),
    templateId: uuidSchema.nullish(),
    priority: z.enum(TASK_PRIORITIES).default('NORMAL'),
    dueAt: z.string().datetime().nullish(),
    requiresVerification: z.boolean().default(false),
  })
  .strict();
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

/**
 * `status` is accepted by the parser only so the service can reject it by name
 * with TASK_INVALID_TRANSITION. Stripping it silently would leave a caller
 * believing the status moved.
 */
export const updateTaskSchema = createTaskSchema
  .omit({ outletId: true, templateId: true })
  .partial()
  .extend({ status: z.string().optional() })
  .strict();
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

export const listTasksQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  kind: z.enum(TASK_KINDS).optional(),
  status: csvEnum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  q: z.string().trim().max(60).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuery>;

export const myTasksQuery = z.object({
  includeCompleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type MyTasksQuery = z.infer<typeof myTasksQuery>;

export const completeTaskSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
    attachmentIds: z.array(uuidSchema).max(5).optional(),
  })
  .strict();
export type CompleteTaskDto = z.infer<typeof completeTaskSchema>;

export const verifyTaskSchema = z
  .object({ note: z.string().trim().max(500).optional() })
  .strict();
export type VerifyTaskDto = z.infer<typeof verifyTaskSchema>;

export const cancelTaskSchema = z
  .object({ reason: z.string().trim().min(3).max(300) })
  .strict();
export type CancelTaskDto = z.infer<typeof cancelTaskSchema>;

export const createCommentSchema = z
  .object({ body: z.string().trim().min(1).max(1000) })
  .strict();
export type CreateCommentDto = z.infer<typeof createCommentSchema>;

export const createAttachmentSchema = z
  .object({
    storageKey: z.string().trim().min(1).max(300).optional(),
    mimeType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().min(1),
  })
  .strict();
export type CreateAttachmentDto = z.infer<typeof createAttachmentSchema>;

export const submitChecklistSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            templateItemId: uuidSchema,
            result: z.enum(CHECKLIST_ITEM_RESULTS),
            note: z.string().trim().max(500).nullish(),
            attachmentId: uuidSchema.nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type SubmitChecklistDto = z.infer<typeof submitChecklistSchema>;

// ---- checklist templates -------------------------------------------------

const templateItemSchema = z
  .object({
    sortOrder: z.number().int().min(1),
    label: z.string().trim().min(3).max(200),
    requiresPhoto: z.boolean().default(false),
    requiresNote: z.boolean().default(false),
    failCreatesTask: z.boolean().default(false),
  })
  .strict();

export const createTemplateSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,39}$/, 'Uppercase, 3 to 40 characters'),
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().max(500).nullish(),
    isAudit: z.boolean().default(false),
    outletId: uuidSchema.nullish(),
    items: z.array(templateItemSchema).min(1).max(60),
  })
  .strict()
  .refine((v) => new Set(v.items.map((i) => i.sortOrder)).size === v.items.length, {
    path: ['items'],
    message: 'sortOrder must be unique within the template',
  });
export type CreateTemplateDto = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(3).max(80).optional(),
    description: z.string().trim().max(500).nullish(),
    isActive: z.boolean().optional(),
    items: z.array(templateItemSchema).min(1).max(60).optional(),
  })
  .strict()
  .refine((v) => !v.items || new Set(v.items.map((i) => i.sortOrder)).size === v.items.length, {
    path: ['items'],
    message: 'sortOrder must be unique within the template',
  });
export type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;

export const listTemplatesQuery = z.object({
  code: z.string().trim().max(40).optional(),
  outletId: uuidSchema.optional(),
  isAudit: z.enum(['true', 'false']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuery>;

// ---- recurrences ---------------------------------------------------------

export const createRecurrenceSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    cronExpr: z.string().trim().refine(isValidCron, 'invalid cron expression'),
    templateId: uuidSchema.nullish(),
    title: z.string().trim().min(3).max(120).nullish(),
    outletId: uuidSchema.nullish(),
    departmentId: uuidSchema.nullish(),
    assigneeId: uuidSchema.nullish(),
    priority: z.enum(TASK_PRIORITIES).default('NORMAL'),
    dueAfterMins: z.number().int().min(15).max(1440).default(120),
  })
  .strict()
  .refine((v) => Boolean(v.templateId) || Boolean(v.title), {
    message: 'either templateId or title is required',
  });
export type CreateRecurrenceDto = z.infer<typeof createRecurrenceSchema>;

export const updateRecurrenceSchema = z
  .object({
    name: z.string().trim().min(3).max(80).optional(),
    cronExpr: z.string().trim().refine(isValidCron, 'invalid cron expression').optional(),
    templateId: uuidSchema.nullish(),
    title: z.string().trim().min(3).max(120).nullish(),
    outletId: uuidSchema.nullish(),
    departmentId: uuidSchema.nullish(),
    assigneeId: uuidSchema.nullish(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueAfterMins: z.number().int().min(15).max(1440).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateRecurrenceDto = z.infer<typeof updateRecurrenceSchema>;

export const listRecurrencesQuery = z.object({
  outletId: uuidSchema.optional(),
  isActive: z.enum(['true', 'false']).optional(),
});
export type ListRecurrencesQuery = z.infer<typeof listRecurrencesQuery>;
