import { pageSchema, paginationQuerySchema } from '@retail/kit';
import { z } from 'zod';
import { ROLES } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

export const roleSchema = z.enum(ROLES);

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const name = z.string().trim().min(1).max(100);
/** Length matters more than composition rules (NIST 800-63B); the upper bound limits hashing cost. */
const password = z.string().min(12).max(128);

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: roleSchema,
  active: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type UserDto = z.output<typeof userSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export type Login = z.output<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export type RefreshRequest = z.output<typeof refreshSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  user: userSchema,
});
export type TokenPair = z.output<typeof tokenPairSchema>;

/** Only the owner creates staff accounts; there is no public sign-up. */
export const createStaffSchema = z
  .object({ email, password, firstName: name, lastName: name, role: roleSchema })
  .strict();
export type CreateStaff = z.output<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    version: z.number().int().min(1).describe('The version you last read; a mismatch returns 409'),
    firstName: name.optional(),
    lastName: name.optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
    password: password.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateStaff = z.output<typeof updateStaffSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: password })
  .strict();
export type ChangePassword = z.output<typeof changePasswordSchema>;

export const listStaffQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Case-insensitive match on name or email'),
  role: roleSchema.optional(),
});
export type ListStaffQuery = z.output<typeof listStaffQuerySchema>;
export const staffPageSchema = pageSchema(userSchema);
