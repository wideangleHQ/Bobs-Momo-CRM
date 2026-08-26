import { z } from 'zod';
import { pageQuerySchema } from './pagination';
import { businessDateSchema, uuidSchema } from './inventory';
import { moneySchema } from './purchase';

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_NOTICE', 'EXITED'] as const;
export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'ON_LEAVE',
  'WEEKLY_OFF',
] as const;
export const LEAVE_TYPES = ['CASUAL', 'SICK', 'UNPAID', 'COMP_OFF'] as const;
export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

// ---- employees -----------------------------------------------------------

export const createEmployeeSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(INDIAN_MOBILE, 'Ten digits, starting 6 to 9'),
    outletId: uuidSchema,
    departmentId: uuidSchema.nullish(),
    designation: z.string().trim().max(80).optional(),
    joinedOn: businessDateSchema,
    userId: uuidSchema.nullish(),
  })
  .strict();
export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema
  .partial()
  .omit({ joinedOn: true })
  .strict();
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;

export const exitEmployeeSchema = z
  .object({ exitedOn: businessDateSchema, reason: z.string().trim().min(3).max(280) })
  .strict();
export type ExitEmployeeDto = z.infer<typeof exitEmployeeSchema>;

export const listEmployeesQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuery>;

// ---- attendance ----------------------------------------------------------

export const punchSchema = z
  .object({
    direction: z.enum(['IN', 'OUT']),
    // Both are manager-only. Supplying either turns the punch into an edit.
    employeeId: uuidSchema.optional(),
    at: z.string().datetime().optional(),
    reason: z.string().trim().min(3).max(280).optional(),
  })
  .strict();
export type PunchDto = z.infer<typeof punchSchema>;

export const startBreakSchema = z
  .object({ reason: z.string().trim().max(200).optional() })
  .strict();
export type StartBreakDto = z.infer<typeof startBreakSchema>;

export const editPunchSchema = z
  .object({
    punchedAt: z.string().datetime(),
    reason: z.string().trim().min(3).max(280),
  })
  .strict();
export type EditPunchDto = z.infer<typeof editPunchSchema>;

export const listAttendanceQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  employeeId: uuidSchema.optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuery>;

// ---- shifts --------------------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const createShiftSchema = z
  .object({
    employeeId: uuidSchema,
    outletId: uuidSchema,
    shiftDate: businessDateSchema,
    startsAt: hhmm,
    endsAt: hhmm,
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type CreateShiftDto = z.infer<typeof createShiftSchema>;

export const bulkShiftSchema = z
  .object({ shifts: z.array(createShiftSchema).min(1).max(200) })
  .strict();
export type BulkShiftDto = z.infer<typeof bulkShiftSchema>;

export const listShiftsQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  employeeId: uuidSchema.optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListShiftsQuery = z.infer<typeof listShiftsQuery>;

// ---- leave ---------------------------------------------------------------

export const createLeaveSchema = z
  .object({
    employeeId: uuidSchema.optional(),
    type: z.enum(LEAVE_TYPES),
    fromDate: businessDateSchema,
    toDate: businessDateSchema,
    halfDay: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((o) => o.toDate >= o.fromDate, {
    path: ['toDate'],
    message: 'The end date is before the start date',
  })
  .refine((o) => !o.halfDay || o.fromDate === o.toDate, {
    path: ['halfDay'],
    message: 'A half day covers one date only',
  });
export type CreateLeaveDto = z.infer<typeof createLeaveSchema>;

export const decideLeaveSchema = z
  .object({ decisionNote: z.string().trim().max(500).optional() })
  .strict();
export type DecideLeaveDto = z.infer<typeof decideLeaveSchema>;

export const listLeaveQuery = pageQuerySchema.extend({
  outletId: uuidSchema.optional(),
  employeeId: uuidSchema.optional(),
  status: z.enum(LEAVE_STATUSES).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type ListLeaveQuery = z.infer<typeof listLeaveQuery>;

// ---- salary --------------------------------------------------------------

export const createSalarySchema = z
  .object({
    employeeId: uuidSchema,
    effectiveFrom: businessDateSchema,
    monthlyCtc: moneySchema,
    basic: moneySchema.optional(),
    allowances: moneySchema.optional(),
    note: z.string().trim().max(280).optional(),
  })
  .strict();
export type CreateSalaryDto = z.infer<typeof createSalarySchema>;
