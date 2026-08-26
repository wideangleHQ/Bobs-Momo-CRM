import { z } from 'zod';

// Chapter 13 password policy: length over character-class theatre.
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => v.trim().length === v.length, 'No leading or trailing spaces');

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(128),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const adminResetSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
});
export type AdminResetDto = z.infer<typeof adminResetSchema>;
