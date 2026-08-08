import { z } from "zod";

// ── Legal / compliance ───────────────────────────────────────────────────────
/**
 * Version stamp recorded when a chapter admin accepts the Terms of Service and
 * Privacy Policy during onboarding (FRA-17, spec/behavior/legal.md). Bump this
 * whenever the Terms/Privacy materially change; it mirrors the landing pages'
 * "last updated" (frapp.live/terms, /privacy — currently "March 2026"). The
 * onboarding service stamps it onto the chapter row server-side; the web wizard
 * imports it so client and server agree on a single value.
 */
export const LEGAL_POLICY_VERSION = "2026-03";

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
  // Assigned chapter_custom_roles ids; omitted → unchanged, [] → cleared.
  custom_role_ids: z.array(z.string().uuid()).optional(),
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
  cadence: z.enum(["monthly", "per_semester", "per_quarter"]),
  active_amount_cents: centsAmount,
  new_member_amount_cents: centsAmount,
  alumni_amount_cents: centsAmount,
  installments_allowed: z.boolean(),
  installment_count: z.number().int().min(1),
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

/**
 * A chapter custom role (Settings → Roles → Custom), persisted to
 * `chapter_custom_roles`. `key` is a lowercase slug unique per chapter;
 * `capabilities` are arbitrary permission strings from the catalog. `core`
 * roles are protected from deletion.
 */
export const ChapterCustomRoleSchema = z.object({
  id: z.string(),
  chapter_id: z.string(),
  key: z.string(),
  label: z.string(),
  rank: z.number().int().nonnegative(),
  capabilities: z.array(z.string()),
  core: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Body for `POST /custom-roles`. `core` is intentionally absent — only system
 * seeding marks a role core; user-created roles are always non-core.
 */
export const CreateCustomRoleSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9_]+$/,
      "key must be lowercase letters, numbers, underscores",
    ),
  label: z.string().min(1),
  rank: z.number().int().nonnegative().optional(),
  capabilities: z.array(z.string()).optional(),
});

/** Body for `PATCH /custom-roles/:id` (key and core are immutable). */
export const UpdateCustomRoleSchema = z.object({
  label: z.string().min(1).optional(),
  rank: z.number().int().nonnegative().optional(),
  capabilities: z.array(z.string()).optional(),
});

/**
 * A chapter custom *field* (Settings → Fields), persisted to
 * `chapter_custom_fields`. The set of field types and visibility tiers mirrors
 * the table's CHECK constraints (`supabase/migrations/20260523120000`).
 */
export const CustomFieldTypeSchema = z.enum([
  "text",
  "number",
  "decimal",
  "phone",
  "select",
  "boolean",
]);

export const CustomFieldVisibilitySchema = z.enum([
  "self",
  "chapter",
  "exec",
  "president",
]);

/**
 * Type-specific configuration stored in the `options` jsonb column.
 * `choices` carries a `select` field's option list; `max_length` is an optional
 * constraint for `text`. Other types carry no config (the column is null).
 */
export const CustomFieldOptionsSchema = z
  .object({
    choices: z.array(z.string().min(1)).optional(),
    max_length: z.number().int().positive().optional(),
  })
  .strict();

export const ChapterCustomFieldSchema = z.object({
  id: z.string(),
  chapter_id: z.string(),
  key: z.string(),
  label: z.string(),
  type: CustomFieldTypeSchema,
  required: z.boolean(),
  visibility: CustomFieldVisibilitySchema,
  sensitive: z.boolean(),
  options: CustomFieldOptionsSchema.nullable(),
  sort: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Body for `POST /custom-fields`. `key` is a lowercase slug unique per chapter.
 * A `select` field must declare a non-empty `choices` list.
 */
export const CreateCustomFieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9_]+$/,
        "key must be lowercase letters, numbers, underscores",
      ),
    label: z.string().min(1),
    type: CustomFieldTypeSchema,
    required: z.boolean().optional(),
    visibility: CustomFieldVisibilitySchema.optional(),
    sensitive: z.boolean().optional(),
    options: CustomFieldOptionsSchema.optional(),
    sort: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.type !== "select" || (v.options?.choices?.length ?? 0) > 0, {
    message: "A select field requires a non-empty options.choices list",
    path: ["options", "choices"],
  });

/** Body for `PATCH /custom-fields/:id` (`key` and `type` are immutable). */
export const UpdateCustomFieldSchema = z.object({
  label: z.string().min(1).optional(),
  required: z.boolean().optional(),
  visibility: CustomFieldVisibilitySchema.optional(),
  sensitive: z.boolean().optional(),
  options: CustomFieldOptionsSchema.nullable().optional(),
  sort: z.number().int().nonnegative().optional(),
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
  // Per-chapter analytics opt-out (data-retention.md #analytics-events-pseudonymous).
  analytics_opt_out: z.boolean().optional(),
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

/**
 * Operation the predicate is being consulted for. Defaults to "read".
 *
 * `"vote"` is a write that does not author channel content (poll votes). It
 * clears the same read-only / `announcements:post` gate as `"post"`, but is
 * deliberately **not** subject to the Alumni lifecycle rule — alumni are
 * restricted from posting, not from participating in a poll they can read.
 */
export type ChannelOperation = "read" | "post" | "vote";

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
  /**
   * Whether the caller holds the chapter's Alumni role. Alumni are read-mostly:
   * they keep full read access but may only post in direct conversations and in
   * ROLE_GATED channels that require `alumni:post` (the seeded `#alumni`). Only
   * consulted when `operation === "post"`; omit (or `false`) for active members.
   */
  isAlumni?: boolean;
}

/**
 * Channel types an Alumni-role member may post into. Alumni keep read access
 * everywhere they can see, but writing is limited to the alumni channel
 * (ROLE_GATED) and direct conversations. See `spec/behavior/alumni.md`.
 */
// Typed on construction so a typo is a compile error, but exposed as a
// ReadonlySet<string> because `ChannelAccessRecord.type` is widened to string.
//
// DM / GROUP_DM are unconditional: a direct conversation is alumni-writable by
// construction. ROLE_GATED is deliberately NOT in this set — being role-gated
// says nothing about being *for* alumni, and treating the two as the same thing
// made every ROLE_GATED channel (e.g. a chapter's `#exec-board`) alumni-postable
// (FRA-321). A ROLE_GATED channel is alumni-writable only when it explicitly
// requires `ALUMNI_CHANNEL_PERMISSION`; see `isAlumniPostableChannel`.
export const ALUMNI_POSTABLE_CHANNEL_TYPES: ReadonlySet<string> =
  new Set<ChatChannelType>(["DM", "GROUP_DM"]);

/**
 * The permission a ROLE_GATED channel must *require* to be alumni-writable.
 *
 * This is read off the channel's `required_permissions`, not off the caller's
 * permissions: it marks the channel as an alumni space. Checking a permission
 * alumni merely *hold* would not work — the Alumni role also holds
 * `members:view`, which is exactly the value a chapter would put on a private
 * `#exec-board`, so that check would re-open the hole it is meant to close.
 */
export const ALUMNI_CHANNEL_PERMISSION = "alumni:post";

/**
 * Whether an Alumni-role member may author content in `channel`.
 *
 * Exported so the API can skip the Alumni role lookup on channels where the
 * rule cannot apply, using the same predicate the gate itself uses.
 */
export function isAlumniPostableChannel(channel: ChannelAccessRecord): boolean {
  if (ALUMNI_POSTABLE_CHANNEL_TYPES.has(channel.type)) return true;
  if (channel.type !== "ROLE_GATED") return false;
  return (channel.required_permissions ?? []).includes(
    ALUMNI_CHANNEL_PERMISSION,
  );
}

/**
 * Decide whether `userId` may access (read / participate in) `channel`.
 *
 * - Non-members of the owning chapter are always denied.
 * - PUBLIC: any chapter member.
 * - PRIVATE / DM / GROUP_DM: the user must be in the explicit `member_ids` list.
 * - ROLE_GATED: the user must hold `"*"` or one of `required_permissions`. An
 *   empty/absent requirement list is denied — a role-gated channel that gates on
 *   nothing is a misconfiguration, not a public channel (FRA-321).
 * - Unknown channel type: denied (guarded default — never falls open).
 *
 * When `operation` is a write (`"post"` or `"vote"`), the read check above must
 * pass AND the channel must either not be read-only, or the caller must hold
 * `"*"` or `"announcements:post"`. Existing callers default to `"read"`, so the
 * predicate stays backward-compatible.
 *
 * When `operation === "post"` and `isAlumni` is set, the caller is additionally
 * limited to direct conversations and ROLE_GATED channels that explicitly
 * require `alumni:post` — alumni read everywhere they can see but do not author
 * content in operational channels.
 * `"*"` (President) still bypasses, so a chapter cannot lock itself out.
 * `"vote"` is exempt: participating in a poll is not posting.
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
        if (permissions.includes("*")) return true;
        const required = channel.required_permissions ?? [];
        // An empty requirement list is a misconfiguration, not an invitation:
        // it used to mean "any chapter member", which made a ROLE_GATED channel
        // functionally PUBLIC and silently un-gated (FRA-321). Deny instead, and
        // keep the field populated at both write points (channel create/update
        // reject an empty list; the seeder always persists one).
        if (required.length === 0) return false;
        return required.some((permission) => permissions.includes(permission));
      }

      default:
        return false;
    }
  })();

  if (!canRead) return false;
  if (operation === "read") return true;

  const isPresident = permissions.includes("*");

  // Alumni lifecycle: read-mostly. They may only write in the alumni channel
  // and direct conversations, never in operational PUBLIC/PRIVATE channels.
  // Only authored content ("post") is restricted — "vote" is participation in
  // something they can already read, so it stays open.
  if (
    operation === "post" &&
    input.isAlumni &&
    !isPresident &&
    !isAlumniPostableChannel(channel)
  ) {
    return false;
  }

  // operation === "post": gate read-only channels behind announcements:post / *.
  if (!channel.is_read_only) return true;
  if (isPresident) return true;
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
export type ChapterCustomRole = z.infer<typeof ChapterCustomRoleSchema>;
export type CreateCustomRole = z.infer<typeof CreateCustomRoleSchema>;
export type UpdateCustomRole = z.infer<typeof UpdateCustomRoleSchema>;
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;
export type CustomFieldVisibility = z.infer<typeof CustomFieldVisibilitySchema>;
export type CustomFieldOptions = z.infer<typeof CustomFieldOptionsSchema>;
export type ChapterCustomField = z.infer<typeof ChapterCustomFieldSchema>;
export type CreateCustomField = z.infer<typeof CreateCustomFieldSchema>;
export type UpdateCustomField = z.infer<typeof UpdateCustomFieldSchema>;
export type SendChatMessage = z.infer<typeof SendChatMessageSchema>;
export type ChatMessageAction = z.infer<typeof ChatMessageActionSchema>;
export type BackfillMessagesQuery = z.infer<typeof BackfillMessagesQuerySchema>;

// ── Pseudonymous analytics (issue #464) ──────────────────────────────────────
export {
  hashUserIdForAnalytics,
  hmacSha256Hex,
  assertContentFreeProperties,
  ContentFreePropertyError,
  FORBIDDEN_ANALYTICS_PROPERTY_KEYS,
} from "./analytics";
export type { AnalyticsEvent, AnalyticsProperties } from "./analytics";

export {
  isSupportedTimeZone,
  normalizeTimeZoneInput,
  MAX_TIME_ZONE_LENGTH,
} from "./time-zone";
