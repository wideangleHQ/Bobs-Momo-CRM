import { z } from 'zod';
import { ROLE_KEYS } from './enums';
import { businessDateSchema, uuidSchema } from './inventory';
import { pageQuerySchema } from './pagination';

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * These two hold no UserOutlet rows. Their outlet list is resolved at login
 * from the active outlet cache, so opening a third outlet needs no data fix.
 */
export const ALL_OUTLET_ROLE_KEYS: readonly string[] = ['OWNER', 'OPERATIONS_MANAGER'];

export const ADMIN_ERRORS = {
  ADMIN_USER_NOT_FOUND: 'ADMIN_USER_NOT_FOUND',
  ADMIN_USERNAME_TAKEN: 'ADMIN_USERNAME_TAKEN',
  ADMIN_EMAIL_TAKEN: 'ADMIN_EMAIL_TAKEN',
  ADMIN_USER_ALREADY_DISABLED: 'ADMIN_USER_ALREADY_DISABLED',
  ADMIN_SELF_ACTION_BLOCKED: 'ADMIN_SELF_ACTION_BLOCKED',
  ADMIN_ROLE_UNCHANGED: 'ADMIN_ROLE_UNCHANGED',
  ADMIN_OUTLET_NOT_FOUND: 'ADMIN_OUTLET_NOT_FOUND',
  ADMIN_OUTLET_CODE_TAKEN: 'ADMIN_OUTLET_CODE_TAKEN',
  ADMIN_DEPARTMENT_NOT_FOUND: 'ADMIN_DEPARTMENT_NOT_FOUND',
  ADMIN_DEPARTMENT_NAME_TAKEN: 'ADMIN_DEPARTMENT_NAME_TAKEN',
  ADMIN_CATEGORY_NOT_FOUND: 'ADMIN_CATEGORY_NOT_FOUND',
  ADMIN_CATEGORY_NAME_TAKEN: 'ADMIN_CATEGORY_NAME_TAKEN',
  ADMIN_UNIT_NOT_FOUND: 'ADMIN_UNIT_NOT_FOUND',
  ADMIN_UNIT_CODE_TAKEN: 'ADMIN_UNIT_CODE_TAKEN',
} as const;
export type AdminErrorCode = (typeof ADMIN_ERRORS)[keyof typeof ADMIN_ERRORS];

// A manager reads these out loud when handing over a login, so no spaces and
// no case ambiguity.
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Letters, digits, dot, dash and underscore only');

const emailSchema = z.string().trim().toLowerCase().email().max(160);
const reasonSchema = z.string().trim().min(3).max(280);

// A query string carries "false", and Boolean("false") is true.
const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

// ---- users ---------------------------------------------------------------

export const createUserSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema.optional(),
    roleKey: z.enum(ROLE_KEYS),
    outletIds: z.array(uuidSchema).max(20).default([]),
  })
  .strict()
  .refine((o) => ALL_OUTLET_ROLE_KEYS.includes(o.roleKey) || o.outletIds.length > 0, {
    path: ['outletIds'],
    message: 'Pick at least one outlet for this role',
  });
export type CreateUserDto = z.infer<typeof createUserSchema>;

// No password field. A new login always gets a generated temporary one, and
// DISABLED is reached through the disable endpoint, which also kills sessions.
export const updateUserSchema = z
  .object({
    username: usernameSchema.optional(),
    email: emailSchema.nullish(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const disableUserSchema = z.object({ reason: reasonSchema }).strict();
export type DisableUserDto = z.infer<typeof disableUserSchema>;

export const assignRoleSchema = z
  .object({ roleKey: z.enum(ROLE_KEYS), reason: reasonSchema.optional() })
  .strict();
export type AssignRoleDto = z.infer<typeof assignRoleSchema>;

export const assignOutletsSchema = z
  .object({ outletIds: z.array(uuidSchema).min(1).max(20) })
  .strict();
export type AssignOutletsDto = z.infer<typeof assignOutletsSchema>;

export const listUsersQuery = pageQuerySchema.extend({
  roleKey: z.enum(ROLE_KEYS).optional(),
  status: z.enum(USER_STATUSES).optional(),
  outletId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuery>;

// ---- outlets and departments ---------------------------------------------

// `code` is absent from the update schema on purpose: it is printed on every
// purchase number ever issued at that outlet.
export const createOutletSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(20)
      .regex(/^[A-Z0-9-]+$/, 'Capitals, digits and dashes only'),
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().max(300).optional(),
    timezone: z.string().trim().max(64).default('Asia/Kolkata'),
  })
  .strict();
export type CreateOutletDto = z.infer<typeof createOutletSchema>;

export const updateOutletSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    address: z.string().trim().max(300).nullish(),
    timezone: z.string().trim().max(64).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateOutletDto = z.infer<typeof updateOutletSchema>;

export const createDepartmentSchema = z
  .object({ outletId: uuidSchema, name: z.string().trim().min(2).max(60) })
  .strict();
export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;

export const listDepartmentsQuery = z
  .object({ outletId: uuidSchema.optional(), isActive: boolQuery })
  .strict();
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuery>;

// ---- reference data ------------------------------------------------------

export const createCategorySchema = z
  .object({ name: z.string().trim().min(2).max(60) })
  .strict();
export type CreateCategoryDto = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial().strict();
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;

export const createUnitSchema = z
  .object({
    code: z.string().trim().toUpperCase().min(1).max(10).regex(/^[A-Z0-9]+$/, 'Capitals and digits only'),
    name: z.string().trim().min(1).max(40),
  })
  .strict();
export type CreateUnitDto = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = createUnitSchema.partial().strict();
export type UpdateUnitDto = z.infer<typeof updateUnitSchema>;

// ---- audit log -----------------------------------------------------------

export const listAuditQuery = pageQuerySchema.extend({
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: uuidSchema.optional(),
  actorId: uuidSchema.optional(),
  outletId: uuidSchema.optional(),
  // A prefix, so "admin." reads every admin action in one query.
  action: z.string().trim().min(1).max(80).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuery>;
