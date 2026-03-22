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

const subscriptionStatusEnum = z.enum([
  "incomplete",
  "active",
  "past_due",
  "canceled",
]);

/**
 * Subset of the chapter payload consumed by dashboard UI (`GET /v1/chapters/current`).
 * Extra API fields are allowed via `.passthrough()` so this stays a projection, not a strict full-entity schema.
 */
export const CurrentChapterPayloadSchema = z
  .object({
    name: z.string(),
    university: z.string(),
    accent_color: z.string().nullable().optional(),
    subscription_status: subscriptionStatusEnum,
  })
  .passthrough();

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

export const UpdateAttendanceSchema = z.object({
  status: z.enum(["PRESENT", "EXCUSED", "ABSENT", "LATE"]),
  excuse_reason: z.string().optional(),
});

export const PointsWindowSchema = z.object({
  window: z.enum(["all", "semester", "month"]).optional(),
});

export const AdjustPointsSchema = z.object({
  target_user_id: z.string().uuid(),
  amount: z.number().int(),
  category: z.enum(["MANUAL", "FINE"]),
  reason: z.string().min(1),
});

// ── Billing ──────────────────────────────────────────────────────────────────

export const CreateCheckoutSchema = z.object({
  customer_email: z.string().email(),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});

export const CreatePortalSchema = z.object({
  return_url: z.string().url(),
});

// ── Financial Invoices ───────────────────────────────────────────────────────

export const CreateFinancialInvoiceSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  amount: z.number().int().positive(),
  due_date: z.string(),
});

export const UpdateFinancialInvoiceSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  amount: z.number().int().positive().optional(),
  due_date: z.string().optional(),
});

export const TransitionInvoiceStatusSchema = z.object({
  status: z.enum(["OPEN", "PAID", "VOID"]),
});

// ── Backwork ─────────────────────────────────────────────────────────────────

export const SEMESTERS = ["Spring", "Summer", "Fall", "Winter"] as const;
export const ASSIGNMENT_TYPES = [
  "Exam", "Midterm", "Final Exam", "Quiz", "Homework",
  "Lab", "Project", "Study Guide", "Notes", "Other",
] as const;
export const DOCUMENT_VARIANTS = [
  "Student Copy", "Blank Copy", "Answer Key",
] as const;

export const RequestUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1),
});

export const ConfirmUploadSchema = z.object({
  storage_path: z.string().min(1),
  file_hash: z.string().min(1),
  title: z.string().max(255).optional(),
  department_code: z.string().max(20).optional(),
  course_number: z.string().max(20).optional(),
  professor_name: z.string().max(255).optional(),
  year: z.number().int().min(1900).optional(),
  semester: z.enum(SEMESTERS).optional(),
  assignment_type: z.enum(ASSIGNMENT_TYPES).optional(),
  assignment_number: z.number().int().min(1).optional(),
  document_variant: z.enum(DOCUMENT_VARIANTS).optional(),
  tags: z.array(z.string()).optional(),
  is_redacted: z.boolean().optional(),
});

// ── Type Exports ─────────────────────────────────────────────────────────────

export type Chapter = z.infer<typeof ChapterSchema>;
export type CurrentChapterPayload = z.infer<typeof CurrentChapterPayloadSchema>;
export type CreateChapter = z.infer<typeof CreateChapterSchema>;
export type CreateRole = z.infer<typeof CreateRoleSchema>;
export type UpdateMemberRoles = z.infer<typeof UpdateMemberRolesSchema>;
export type CreateInvite = z.infer<typeof CreateInviteSchema>;
export type RedeemInvite = z.infer<typeof RedeemInviteSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type UpdateAttendance = z.infer<typeof UpdateAttendanceSchema>;
export type PointsWindow = z.infer<typeof PointsWindowSchema>;
export type AdjustPoints = z.infer<typeof AdjustPointsSchema>;
export type CreateCheckout = z.infer<typeof CreateCheckoutSchema>;
export type CreatePortal = z.infer<typeof CreatePortalSchema>;
export type CreateFinancialInvoice = z.infer<typeof CreateFinancialInvoiceSchema>;
export type UpdateFinancialInvoice = z.infer<typeof UpdateFinancialInvoiceSchema>;
export type TransitionInvoiceStatus = z.infer<typeof TransitionInvoiceStatusSchema>;
export type RequestUploadUrl = z.infer<typeof RequestUploadUrlSchema>;
export type ConfirmUpload = z.infer<typeof ConfirmUploadSchema>;
