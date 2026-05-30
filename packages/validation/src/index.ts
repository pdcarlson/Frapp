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

// ── Chapter branding schema (Chunk 02: chapters.branding jsonb) ──────────────

export const ChapterBrandingSchema = z
  .object({
    greek_letters: z.string().optional(),
    designation: z.string().optional(),
    school_short: z.string().optional(),
    founded_at: z.number().int().min(1776).optional(),
    colors: z
      .object({
        dark: z
          .string()
          .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
          .optional(),
        accent: z
          .string()
          .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
          .optional(),
      })
      .optional(),
  })
  .optional();

/**
 * Subset of the chapter payload consumed by dashboard UI (`GET /v1/chapters/current`).
 * Extra API fields are allowed via `.passthrough()` so this stays a projection, not a strict full-entity schema.
 * Chunk 02 adds optional branding fields (greek_letters, designation, school_short)
 * so ChapterLockup can render real chapter identity.
 */
export const CurrentChapterPayloadSchema = z
  .object({
    name: z.string(),
    university: z.string(),
    accent_color: z.string().nullable().optional(),
    subscription_status: subscriptionStatusEnum,
    branding: ChapterBrandingSchema,
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
  "Exam",
  "Midterm",
  "Final Exam",
  "Quiz",
  "Homework",
  "Lab",
  "Project",
  "Study Guide",
  "Notes",
  "Other",
] as const;
export const DOCUMENT_VARIANTS = [
  "Student Copy",
  "Blank Copy",
  "Answer Key",
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

// ── Chapter config schemas (Chunk 02) ─────────────────────────────────────────

/** Reusable nonnegative-cents validator. Rejects NaN and negative values. */
const centsAmount = z.number().int().nonnegative();

export const ChapterDuesConfigSchema = z.object({
  cadence: z.enum(["semester", "monthly", "annual"]),
  active_amount_cents: centsAmount,
  new_member_amount_cents: centsAmount,
  alumni_amount_cents: centsAmount,
  installments_allowed: z.boolean(),
  late_fee_cents: centsAmount,
  grace_days: z.number().int().nonnegative(),
  scholarship_pool_cents: centsAmount,
});

/**
 * A single workflow override submitted from Settings → Workflows. `key`
 * identifies a workflow in the chapter's catalog; `threshold` guard-parses to a
 * nonnegative integer (NaN/negative rejected — never stored).
 */
export const ChapterWorkflowConfigSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  threshold: z.number().int().nonnegative().optional(),
});

export const PatchChapterConfigSchema = z.object({
  org_archetype: z.string().optional(),
  enabled_modules: z.record(z.boolean()).optional(),
  vocabulary: z.record(z.string()).optional(),
  branding: ChapterBrandingSchema,
  beta_config: z
    .object({
      enabled: z.boolean(),
      style: z.enum([
        "sidebar_pill",
        "top_banner",
        "corner_badge",
        "breadcrumb_pill",
      ]),
    })
    .optional(),
  dues: ChapterDuesConfigSchema.optional(),
  workflows: z.array(ChapterWorkflowConfigSchema).optional(),
});

// ── Chat message schemas (Chunk 02; hot-path moved to NestJS in #416)
// Originally shared with the Deno Edge Functions; kept dependency-light
// (zod only) so any future Deno consumer can still import this file
// directly via an import map without Node.js-specific resolution. ──────

export const CHAT_MESSAGE_KINDS = [
  "text",
  "event",
  "task",
  "poll",
  "dues",
  "points",
  "hours",
  "system_audit",
  "loading",
  "announcement",
] as const;

export const SendChatMessageSchema = z.object({
  /**
   * Client-generated idempotency key (UUID or UUID-like string).
   * The server dedupes on (channel_id, sender_id, client_message_id).
   * Actor identity is resolved from the authenticated session — never from
   * this payload.
   */
  client_message_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  content: z.string().min(1).max(10_000),
  kind: z.enum(CHAT_MESSAGE_KINDS).default("text"),
  payload: z.record(z.unknown()).optional(),
  reply_to_id: z.string().uuid().optional(),
});

export const ChatMessageActionSchema = z.object({
  message_id: z.string().uuid(),
  action_type: z.string().min(1).max(50),
  payload: z.record(z.unknown()).optional(),
});

export const BackfillMessagesQuerySchema = z.object({
  since: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Chat channel-access predicate ────────────────────────────────────────────
// Shared by every chat + search code path in the NestJS API: cold reads,
// the hot-path send + react controllers (`ChatService.sendMessage`,
// `ChatService.recordMessageAction`), and search. Pure: no zod, no I/O,
// no framework imports. Callers perform their own TRUSTED database
// lookups (channel record, the caller's chapter membership, and — only
// for ROLE_GATED channels — the caller's effective permissions) and feed
// them in here. Centralizing the rule prevents the layers from drifting
// apart, which is how cross-tenant authorization holes appear.
//
// (Pre-ADR-11 / #416, the Supabase Edge Functions `chat-send` and
// `chat-react` imported this same module via a Deno import map — kept
// inline in `index.ts` so they never had to resolve an extensionless
// relative import. The chat path now lives entirely in NestJS, but the
// "keep it inline" rule stays so any future Deno consumer can reuse it.)

export type ChatChannelType =
  | "PUBLIC"
  | "PRIVATE"
  | "ROLE_GATED"
  | "DM"
  | "GROUP_DM";

/** The trusted channel fields the access decision depends on. */
export interface ChannelAccessRecord {
  type: ChatChannelType | string;
  member_ids: string[] | null;
  required_permissions: string[] | null;
  /**
   * Whether the channel rejects member writes (e.g. `#announcements` and
   * `#chapter-audit`). Only consulted when `operation === "post"`; safe to
   * omit (treated as `false`) for read checks. (Chunk 05 / ADR-07.)
   */
  is_read_only?: boolean | null;
}

/** Operation the predicate is being consulted for. Defaults to "read". */
export type ChannelOperation = "read" | "post";

/** Permission key that grants posting into a read-only channel (e.g. `#announcements`). */
export const ANNOUNCEMENTS_POST_PERMISSION = "announcements:post";

export interface ChannelAccessInput {
  channel: ChannelAccessRecord;
  /** App-level user id, resolved from the session — never the client payload. */
  userId: string;
  /** Whether the caller is an active member of the chapter that owns the channel. */
  isChapterMember: boolean;
  /**
   * The caller's effective permission strings in that chapter. Consulted for
   * ROLE_GATED channels and for write checks against read-only channels.
   * `"*"` (wildcard) grants access.
   */
  permissions: string[];
  /**
   * What the caller is trying to do. `"read"` (default) checks visibility;
   * `"post"` additionally enforces the read-only / announcements:post gate.
   */
  operation?: ChannelOperation;
}

/**
 * Decide whether `userId` may access (read / participate in) `channel`.
 *
 * - Non-members of the owning chapter are always denied.
 * - PUBLIC: any chapter member.
 * - PRIVATE / DM / GROUP_DM: the user must be in the explicit `member_ids` list.
 * - ROLE_GATED: the user must hold `"*"` or one of `required_permissions`. An
 *   empty/absent requirement list means any chapter member may access it.
 * - Unknown channel type: denied (guarded default — never falls open).
 *
 * When `operation === "post"`, the read check above must pass AND the
 * channel must either not be read-only, or the caller must hold `"*"` or
 * `"announcements:post"`. Existing callers default to `"read"`, so the
 * predicate stays backward-compatible.
 */
export function canAccessChannel(input: ChannelAccessInput): boolean {
  const { channel, userId, isChapterMember, permissions } = input;
  const operation: ChannelOperation = input.operation ?? "read";

  if (!isChapterMember) return false;

  const canRead = (() => {
    switch (channel.type) {
      case "PUBLIC":
        return true;

      case "PRIVATE":
      case "DM":
      case "GROUP_DM":
        return (channel.member_ids ?? []).includes(userId);

      case "ROLE_GATED": {
        const required = channel.required_permissions ?? [];
        if (required.length === 0) return true;
        if (permissions.includes("*")) return true;
        return required.some((permission) => permissions.includes(permission));
      }

      default:
        return false;
    }
  })();

  if (!canRead) return false;
  if (operation === "read") return true;

  // operation === "post": gate read-only channels behind announcements:post / *.
  if (!channel.is_read_only) return true;
  if (permissions.includes("*")) return true;
  return permissions.includes(ANNOUNCEMENTS_POST_PERMISSION);
}

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
export type CreateFinancialInvoice = z.infer<
  typeof CreateFinancialInvoiceSchema
>;
export type UpdateFinancialInvoice = z.infer<
  typeof UpdateFinancialInvoiceSchema
>;
export type TransitionInvoiceStatus = z.infer<
  typeof TransitionInvoiceStatusSchema
>;
export type RequestUploadUrl = z.infer<typeof RequestUploadUrlSchema>;
export type ConfirmUpload = z.infer<typeof ConfirmUploadSchema>;

export type ChapterBranding = z.infer<typeof ChapterBrandingSchema>;
export type ChapterDuesConfig = z.infer<typeof ChapterDuesConfigSchema>;
export type PatchChapterConfig = z.infer<typeof PatchChapterConfigSchema>;
export type SendChatMessage = z.infer<typeof SendChatMessageSchema>;
export type ChatMessageAction = z.infer<typeof ChatMessageActionSchema>;
export type BackfillMessagesQuery = z.infer<typeof BackfillMessagesQuerySchema>;
