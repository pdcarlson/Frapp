import { z } from "zod";
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  INVOICE_AMOUNT_MAX_CENTS,
  INVOICE_DESCRIPTION_MAX_LENGTH,
  INVOICE_TITLE_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  ROLE_KEY_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
} from "./field-limits";
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
} from "./upload-allowlists";

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
        // One seed. The legacy second colour (`dark`) fed only the
        // `derivePalette` token map and went with it in the #920 slice-9
        // cutover; rows written before that keep an inert stored value, which
        // this schema strips on read.
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
    // Same scalar the config PATCH writes; `GET /v1/chapters/current` returns
    // the chapter row (`select('*')`), so mobile reads the opt-out here the
    // way it already reads `enabled_modules` for `isModuleEnabled`.
    analytics_opt_out: z.boolean().optional(),
  })
  .passthrough();

export const CreateChapterSchema = z.object({
  name: z.string().min(3, "Chapter name must be at least 3 characters"),
  university: z
    .string()
    .min(2, "University name must be at least 2 characters"),
});

export const EmailInviteSchema = z.object({
  role: z.string().min(1),
  emails: z.array(z.string().email()).min(1).max(50),
});

/**
 * Case-insensitively de-dupes email addresses, preserving the first-seen
 * casing to send to. Shared between the API (`InviteService.createWithEmails`)
 * and the web onboarding wizard so the two runtimes' notion of "how many
 * unique addresses" can never drift apart.
 */
export function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export const UpdateUserSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  avatar_url: z.string().url().optional(),
  graduation_year: z.number().int().min(1900).max(2100).optional(),
  current_city: z.string().max(100).optional(),
  current_company: z.string().max(100).optional(),
});

// ── Billing ──────────────────────────────────────────────────────────────────

export const CreateCheckoutSchema = z.object({
  customer_email: z.string().email(),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
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

export const RequestUploadUrlSchema = z
  .object({
    filename: z.string().min(1).max(255),
    content_type: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    // Widest member-upload kind (`document`). Image- and proof-only routes
    // still narrow at the service. This is the shared schema that used to
    // accept any non-empty content_type string.
    if (!isAllowedUploadExtension("document", value.filename)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "file extension is not allowed",
        path: ["filename"],
      });
    }
    if (!isAllowedUploadMime("document", value.content_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "content type is not allowed",
        path: ["content_type"],
      });
    }
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
 * Ceiling on the configurable hourly adjustment rate. An unbounded value would
 * overflow `int4` on the upsert (a raw Postgres 22003 surfacing as a 500 after
 * a partial write), and short of that would simply switch the control off.
 */
export const ADJUSTMENT_RATE_LIMIT_MAX = 1000;

/**
 * A chapter's points anti-fraud limits (#394 — `spec/behavior/points.md`
 * § Anti-Fraud), persisted to `chapter_points_config`.
 *
 * Both floors are `min(1)`, mirroring the column CHECKs and the API DTO: a
 * rate limit of 0 refuses every adjustment with no way back out through the
 * append-only ledger, and a threshold of 0 flags every row.
 */
export const ChapterPointsConfigSchema = z.object({
  adjustment_rate_limit_per_hour: z
    .number()
    .int()
    .min(1)
    .max(ADJUSTMENT_RATE_LIMIT_MAX),
  // Ceiling is the ledger's own per-row bound: an adjustment can never exceed
  // +/-POINTS_ADJUSTMENT_MAX, so a threshold above it could never fire.
  anomaly_threshold: z.number().int().min(1).max(POINTS_ADJUSTMENT_MAX),
});

/**
 * What a chapter with no `chapter_points_config` row enforces — the values
 * `PointsService` hardcoded before the limits became configurable, which is
 * what makes the migration backfill-free.
 *
 * Lives here, in the package both `apps/api` and `packages/hooks` already
 * depend on, so the API's enforcement default and the number the web renders
 * cannot drift apart. They previously would have: a hand-copied frontend
 * constant compiles fine forever while the server default moves, and the
 * dashboard would then state an anti-fraud limit the server does not apply.
 * The migration's column defaults are the third copy and the one that cannot
 * import this; `chapter-points-config.service.spec.ts` pins them together.
 */
export const CHAPTER_POINTS_CONFIG_DEFAULTS: ChapterPointsConfig = {
  adjustment_rate_limit_per_hour: 50,
  anomaly_threshold: 100,
};

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
  // Zod 4: `z.record` takes (key, value). The one-arg form was Zod 3.
  enabled_modules: z.record(z.string(), z.boolean()).optional(),
  vocabulary: z.record(z.string(), z.string()).optional(),
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
  // Partial by design: an officer may move one limit without restating the
  // other, and the API merges onto the stored row.
  points: ChapterPointsConfigSchema.partial().optional(),
  workflows: z.array(ChapterWorkflowConfigSchema).optional(),
  // Per-chapter analytics opt-out (data-retention.md #analytics-events-pseudonymous).
  analytics_opt_out: z.boolean().optional(),
  // #422: role new invites default to. `.nullable()` before `.optional()` is
  // load-bearing — null is a real value here (clear the default) and must
  // survive the parse, while absent means "don't touch it". The API rejects a
  // uuid that is not one of this chapter's roles with a 400.
  default_invite_role_id: z.string().uuid().nullable().optional(),
});

// ── Module enablement predicate (issue #264) ─────────────────────────────────

/**
 * Single source of truth for "is this module on for this chapter?".
 *
 * Deliberately shared rather than reimplemented per surface: the web nav, the
 * Cmd+K palette, the chat slash-command palette, and the API's `ChapterGuard`
 * all answer this question, and a disagreement between the client and the
 * server means either a surface the user can see but not use, or a write the
 * UI hides but the API still accepts.
 *
 * A module is enabled unless the chapter explicitly turned it off. Absence is
 * not disablement — a chapter created before a module existed has no key for
 * it, and must not be locked out of something it never disabled.
 *
 * @param enabledModules the chapter's `enabled_modules` map, if loaded
 * @param key a `MODULE_CATALOG` key, e.g. `"events"`
 */
export function isModuleEnabled(
  enabledModules: Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  return enabledModules?.[key] !== false;
}

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
  "imported",
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
  content: z.string().min(1).max(CHAT_MESSAGE_CONTENT_MAX_LENGTH),
  kind: z.enum(CHAT_MESSAGE_KINDS).default("text"),
  payload: z.record(z.string(), z.unknown()).optional(),
  reply_to_id: z.string().uuid().optional(),
});

export const ChatMessageActionSchema = z.object({
  message_id: z.string().uuid(),
  action_type: z.string().min(1).max(50),
  payload: z.record(z.string(), z.unknown()).optional(),
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
  /**
   * Set once a GROUP_DM's membership drops to <= 1 via the leave endpoint
   * (#348). Only consulted for a write operation, where it denies
   * unconditionally — unlike `is_read_only`, no permission clears it, since
   * there is no "unarchive" flow. Safe to omit for read checks: an archived
   * channel stays directly readable by whoever is still in `member_ids`.
   */
  archived_at?: string | null;
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
 * Whether `channel` accepts in-thread replies.
 *
 * Read-only channels (`#announcements`, `#chapter-audit`) are broadcast
 * surfaces. Per `spec/behavior/chat/README.md` § Announcements: "Announcement
 * messages cannot be replied to in-thread (read-only channel for non-admins)."
 * A reply would turn a one-way broadcast into a conversation the channel's
 * whole point is to not have — note the rationale is the one-way model, *not*
 * hidden nesting: replies here are Discord-style reply-with-quote rendered in
 * the main timeline (§ Reply threads), so nothing is ever tucked out of sight.
 *
 * Two deliberate properties:
 *
 * - **Keyed off `is_read_only`, not the channel name.** The same flag already
 *   decides *who* may post (`canAccessChannel`), so one flag governs broadcast
 *   semantics end to end. A name match would silently stop enforcing the moment
 *   a chapter renamed its announcements channel, and would miss `#chapter-audit`
 *   and any chapter-created read-only channel.
 * - **Unconditional on permissions.** `canAccessChannel` decides who may author a
 *   top-level announcement; this decides that nobody threads one — holders of
 *   `announcements:post` and of the `"*"` wildcard included. The rule is a
 *   property of the channel, not of the caller, so this deliberately takes no
 *   permissions argument. Do not add one: a `"*"` escape hatch here reopens
 *   exactly the hole the predicate exists to close.
 *
 * Takes a whole `ChannelAccessRecord` rather than just the field it reads, for
 * the same reason `isAlumniPostableChannel` does: a `Pick<…, "is_read_only">`
 * is an all-optional type, so a caller handing over a projection that never
 * selected the column would type-check and read as replyable. Requiring the
 * full record makes the caller prove it loaded a real channel — this predicate
 * must fail closed, and an omitted field is the one way it could fail open.
 */
export function allowsInThreadReplies(channel: ChannelAccessRecord): boolean {
  return !channel.is_read_only;
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

  // An archived channel (#348) is frozen: no further writes from anyone,
  // regardless of permissions. Checked before the President wildcard below —
  // unlike the read-only / announcements:post gate, there is no override,
  // because there is no "unarchive" flow to make an override meaningful.
  if (channel.archived_at) return false;

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
export type EmailInvite = z.infer<typeof EmailInviteSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type CreateCheckout = z.infer<typeof CreateCheckoutSchema>;
export type RequestUploadUrl = z.infer<typeof RequestUploadUrlSchema>;

export type ChapterBranding = z.infer<typeof ChapterBrandingSchema>;
export type ChapterDuesConfig = z.infer<typeof ChapterDuesConfigSchema>;
export type ChapterPointsConfig = z.infer<typeof ChapterPointsConfigSchema>;
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
  hashChapterIdForAnalytics,
  hashIpForObservability,
  hmacSha256Hex,
  assertContentFreeProperties,
  ContentFreePropertyError,
  FORBIDDEN_ANALYTICS_PROPERTY_KEYS,
} from "./analytics";
export type { AnalyticsEvent, AnalyticsProperties } from "./analytics";

// ── Activation funnel (issue #267) ───────────────────────────────────────────
export { ACTIVATION_MILESTONES, activationMilestoneStep } from "./analytics";
export type { ActivationMilestone } from "./analytics";

// ── `@`-mention resolution (C1 of #937) ──────────────────────────────────────
// Shared because the API's authoritative pass and any client-side preview must
// not disagree about who `@jane` is — but only the API's result is persisted,
// since mentions override a per-channel mute in the push rules and a
// client-supplied list would be forgeable.
export {
  extractMentionTokens,
  matchMentionCandidate,
  resolveMentions,
} from "./mentions";
export type { MentionCandidate } from "./mentions";

// ── Sentry PII scrubbing (issues #481, #896, #865) ───────────────────────────
// Shared rather than API-local because a browser bundle holds strictly more PII
// than the server does, so `apps/web` must scrub to the *same* rules rather than
// a second, looser copy of them. Parameterized by a pseudonymizer because the
// HMAC salt is API-only on purpose and must never reach a client bundle.
export {
  createSentryScrubber,
  NO_PSEUDONYMS,
  // Exported so the API's request-log helper consumes this exact parser
  // rather than keeping a second copy (#1388).
  stripAuthority,
} from "./sentry-scrubbing";
export type {
  ScrubbableEvent,
  SentryPseudonymizer,
} from "./sentry-scrubbing";

// ── Time zones (issue #687) ──────────────────────────────────────────────────
export {
  isSupportedTimeZone,
  normalizeTimeZoneInput,
  MAX_TIME_ZONE_LENGTH,
} from "./time-zone";

// ── Notification categories (issue #564; mobile half shipped in C4 of #937) ──
// Shared because each `key` is written verbatim into
// `notification_preferences.category` and nothing validates it — the column is
// unconstrained `text` and the DTO only length-limits the string — so a
// per-surface copy drifts into preference rows the server never reads. Both
// surfaces now draw from here: mobile's s16 grid and web's Profile card.
// `rowsToNotificationCategoryState` is shared for the same reason the catalog
// is — it is the fold from server rows onto those keys, and a second copy is
// how two surfaces come to disagree about what a member's switches say.
export {
  NOTIFICATION_CATEGORIES,
  isNotificationCategoryKey,
  defaultNotificationCategoryState,
  rowsToNotificationCategoryState,
} from "./notification-categories";
export type {
  NotificationCategory,
  NotificationCategoryKey,
  NotificationCategoryState,
} from "./notification-categories";

// ── Poll vote rules ──────────────────────────────────────────────────────────
// Shared by the two paths that accept a vote, which are NOT the same code path
// and cannot be merged into one: `PollService.vote` writes `poll_votes` keyed by
// a numeric `option_index`, while `ChatService.recordMessageAction` writes
// `chat_message_actions` with a string `payload.option_id`. Two storage shapes,
// two encodings, one set of rules.
//
// Only the chat-card path was unguarded (#871): it checked channel access and
// then inserted whatever it was handed, so a member could vote on a closed
// poll, submit an option that does not exist, or send several selections to a
// single-choice poll — all rejected by the polls surface for the same poll.
//
// Pure: no zod, no I/O, no framework imports. Callers do their own trusted
// lookups and feed the results in, exactly like the channel-access predicate
// above.

/** Why a vote was rejected. `null` from the validators below means "accept". */
export type PollVoteRejection =
  | { reason: "closed" }
  | { reason: "unknown_option"; option: string | number }
  | { reason: "cardinality"; selected: number };

/**
 * A poll is closed once its deadline has passed. An absent deadline means it
 * never closes. The boundary is inclusive — a poll closing exactly now is
 * closed — matching the polls surface, where a vote landing on the deadline
 * has missed it.
 */
export function isPollClosed(
  closesAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!closesAt) return false;
  const deadline = new Date(closesAt);
  // An unparseable deadline is not treated as closed: refusing every vote on a
  // poll whose metadata is malformed would turn a data bug into an outage.
  if (Number.isNaN(deadline.getTime())) return false;
  return deadline <= now;
}

function evaluatePollVote(input: {
  closed: boolean;
  unknownOption: string | number | null;
  selectedCount: number;
  choiceMode: "single" | "multi" | undefined;
}): PollVoteRejection | null {
  if (input.closed) return { reason: "closed" };
  if (input.unknownOption !== null) {
    return { reason: "unknown_option", option: input.unknownOption };
  }
  // Multi-choice accepts zero selections — that is how the polls surface clears
  // an existing vote. Single-choice requires exactly one.
  if (input.choiceMode === "single" && input.selectedCount !== 1) {
    return { reason: "cardinality", selected: input.selectedCount };
  }
  return null;
}

/** Validates a vote addressed by option INDEX (`poll_votes`, the polls surface). */
export function validateIndexedPollVote(input: {
  expiresAt: string | null | undefined;
  optionCount: number;
  optionIndexes: readonly number[];
  choiceMode: "single" | "multi" | undefined;
  now?: Date;
}): PollVoteRejection | null {
  const unknown = input.optionIndexes.find(
    (index) => !Number.isInteger(index) || index < 0 || index >= input.optionCount,
  );

  return evaluatePollVote({
    closed: isPollClosed(input.expiresAt, input.now),
    unknownOption: unknown === undefined ? null : unknown,
    selectedCount: input.optionIndexes.length,
    choiceMode: input.choiceMode,
  });
}

/** Validates a vote addressed by option ID (`chat_message_actions`, the chat card). */
export function validateCardPollVote(input: {
  closesAt: string | null | undefined;
  optionIds: readonly string[];
  selected: readonly string[];
  choiceMode: "single" | "multi" | undefined;
  now?: Date;
}): PollVoteRejection | null {
  const unknown = input.selected.find((id) => !input.optionIds.includes(id));

  return evaluatePollVote({
    closed: isPollClosed(input.closesAt, input.now),
    unknownOption: unknown === undefined ? null : unknown,
    selectedCount: input.selected.length,
    choiceMode: input.choiceMode,
  });
}

// Client-side RBAC gates, shared by apps/web and apps/mobile. Moved out of
// `apps/web/lib/auth/can.ts` with #994 so the wildcard rule has one definition.
export { can, canAll, canAny, WILDCARD_PERMISSION } from "./permissions";

// Client-side subscription write gate. Moved out of `apps/web/lib/subscription.ts`
// so it sits next to `can` and `isModuleEnabled` as the third shared client gate.
export {
  SUBSCRIPTION_GRACE_PERIOD_MS,
  isSubscriptionStatus,
  isWithinSubscriptionGrace,
  subscriptionWriteState,
} from "./subscription";
// Client-side analytics opt-out. Fourth shared client gate alongside `can`,
// `isModuleEnabled`, and `subscriptionWriteState`.
export { isAnalyticsOptedOut } from "./analytics-opt-out";
export type {
  SubscriptionBlockCode,
  SubscriptionStatus,
  SubscriptionWriteClass,
  SubscriptionWriteState,
} from "./subscription";

// ── Field limits (moved from apps/api domain constants) ─────────────────────
export {
  ROLE_NAME_MAX_LENGTH,
  ROLE_KEY_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  INVOICE_AMOUNT_MAX_CENTS,
  INVOICE_TITLE_MAX_LENGTH,
  INVOICE_DESCRIPTION_MAX_LENGTH,
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
};

// ── Upload MIME / extension allowlists + 25 MB size cap ─────────────────────
export {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  MAX_ARCHIVE_UPLOAD_BYTES,
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
  MAX_ARCHIVE_CHAPTER_BYTES,
  DOCUMENT_UPLOAD_SURFACES,
  uploadMimeTypes,
  uploadMimeList,
  uploadExtensions,
  contentTypeByExtension,
  acceptAttribute,
  fileExtension,
  normalizeExtension,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  isWithinArchiveUploadSizeLimit,
  mimeForUploadFile,
  inspectUploadFile,
} from "./upload-allowlists";
export type { UploadKind, InspectedUpload } from "./upload-allowlists";

// Discord export (DCE) preamble parsing, shared between the import wizard
// (apps/web) and the import worker (apps/api). See ./discord-export for why
// this used to be two copies of the same scanner.
export { parseExportPreamble } from "./discord-export";
export type { DiscordExportPreamble } from "./discord-export";

// Event recurrence: the rule catalog the DTOs validate against, the child
// counts the series generator materializes, and the RFC 5545 RRULE the two
// .ics exporters emit. One source so the generated series and the exported
// series cannot describe different meetings.
export {
  RECURRENCE_RULES,
  RECURRENCE_RULE_LABELS,
  isRecurrenceRule,
  recurrenceChildCount,
  toRRuleLine,
} from "./recurrence";
export type { RecurrenceRule } from "./recurrence";
