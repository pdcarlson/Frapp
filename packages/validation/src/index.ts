import { z } from "zod";

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3).max(100),
  university: z.string().min(2).max(100),
  stripeCustomerId: z.string().optional(),
  subscriptionStatus: z.enum(["incomplete", "active", "past_due", "canceled"]),
  accentColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  logoPath: z.string().optional(),
  donationUrl: z.string().url().optional(),
});

export const CreateChapterSchema = z.object({
  name: z.string().min(3, "Chapter name must be at least 3 characters"),
  university: z
    .string()
    .min(2, "University name must be at least 2 characters"),
});

export const CreateRoleSchema = z.object({
  name: z.string().min(1, "Role name is required"),
  permissions: z.array(z.string()),
  display_order: z.number().int().min(0).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export const UpdateMemberRolesSchema = z.object({
  role_ids: z.array(z.string().uuid()),
});

export const CreateInviteSchema = z.object({
  role: z.string().min(1),
});

export const RedeemInviteSchema = z.object({
  token: z.string().uuid(),
});

export const UpdateUserSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  avatar_url: z.string().url().optional(),
  graduation_year: z.number().int().min(1900).max(2100).optional(),
  current_city: z.string().max(100).optional(),
  current_company: z.string().max(100).optional(),
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type CreateChapter = z.infer<typeof CreateChapterSchema>;
export type CreateRole = z.infer<typeof CreateRoleSchema>;
export type UpdateMemberRoles = z.infer<typeof UpdateMemberRolesSchema>;
export type CreateInvite = z.infer<typeof CreateInviteSchema>;
export type RedeemInvite = z.infer<typeof RedeemInviteSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
