import { z } from 'zod';

// Chapter & Onboarding
export const ChapterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3).max(100),
  university: z.string().min(2).max(100),
  clerkOrganizationId: z.string().optional(),
  stripeCustomerId: z.string().optional(),
  subscriptionStatus: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const OnboardingInitSchema = z.object({
  name: z.string().min(3, 'Chapter name must be at least 3 characters'),
  university: z.string().min(2, 'University name must be at least 2 characters'),
  clerkOrganizationId: z.string().optional(),
});

// RBAC
export const CreateRoleSchema = z.object({
  name: z.string().min(3, 'Role name must be at least 3 characters'),
  permissions: z.array(z.string()),
});

// Members
export const UpdateMemberRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()),
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type OnboardingInit = z.infer<typeof OnboardingInitSchema>;
export type CreateRole = z.infer<typeof CreateRoleSchema>;
export type UpdateMemberRoles = z.infer<typeof UpdateMemberRolesSchema>;
