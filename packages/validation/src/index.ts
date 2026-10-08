import { z } from "zod";
import {
  CHAPTER_SHORT_NAME_MAX_LENGTH,
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  YEAR_MAX,
} from "./field-limits";

// ── Legal / compliance ───────────────────────────────────────────────────────
// The policy version itself is the API's (`apps/api/src/domain/constants/
// legal.ts`, #3268): clients never compare against it.

/**
 * The checkbox every acceptance surface shows: the create-chapter wizard, the
 * join screens and the Terms prompt, on web and mobile. The owner approved this
 * wording with the Terms of 2026-09 (#2261), so change it only with them, and
 * with the Terms.
 */
export const LEGAL_ACCEPTANCE_LABEL =
  "I'm 18 or older and agree to the Terms of Service and Privacy Policy.";

/**
 * The 403 the API answers with when a caller who hasn't accepted the current
 * Terms tries to join or create a chapter without the checkbox (#2302). It
 * throws both; `isTermsRequiredError` in `@repo/hooks` recognises either.
 *
 * The message matters as much as the code. Clients read the code first, but
 * an API older than #1020 sent none, so the message is the fallback, and it
 * is shared from here so the server and both apps can't drift apart on it.
 */
export const LEGAL_ACCEPTANCE_REQUIRED_CODE = "legal.acceptance_required";
export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE =
  "Agree to the Terms of Service and Privacy Policy to continue.";

/**
 * The 404 code on `GET /v1/channels/{id}/messages` when its `since` cursor
 * names no message in the channel (#2807). Chat clients read it
 * (`readMessageRows` in `@repo/chat-core/history`) to tell a cursor they should
 * drop from a channel they can't read, which answers 404 too.
 */
export const CHAT_SINCE_NOT_FOUND_CODE = "chat.since_not_found";

/**
 * The API's 410 message for a request from an account that has been deleted
 * but whose session hasn't ended yet. Shared so a client can tell it apart
 * from the other 410s it can meet on the same route (an expired invite).
 */
export const ACCOUNT_DELETED_MESSAGE = "Account has been deleted";

/**
 * The join screens' copy when the box isn't ticked, or when the server refused
 * a join for want of it (#2302). Web `/join` and mobile s02 both render it;
 * `spec/ui/design-system/writing.md` § 7, Join chapter, is its spec.
 */
export const JOIN_TERMS_REQUIRED_COPY =
  "Agree to the Terms of Service and Privacy Policy to join.";

/**
 * The Terms prompt's copy (#2302), rendered by mobile `(auth)/terms.tsx` and
 * web's `TermsPrompt`. `spec/ui/design-system/writing.md` § 7, Terms prompt,
 * is its spec.
 */
export const TERMS_PROMPT_COPY = {
  title: "Agree to the Terms to continue",
  body: "We've updated the Terms of Service and Privacy Policy. Read them, then agree to keep using Frapp.",
  cta: "Agree and continue",
  unticked: "Agree to the Terms of Service and Privacy Policy to continue.",
  deleted: "This account has been deleted. Sign out to continue.",
  failed: "Couldn't save your agreement. Check your connection and try again.",
} as const;

// ── Chapter branding schema (Chunk 02: chapters.branding jsonb) ──────────────

/**
 * The branding block's shape. No product code parses with it: it is the type
 * source for the config PATCH body (`PatchChapterConfig`) and the API's
 * `ChapterBrandingInput`, and the API's `BrandingDto` is what enforces values.
 * A client reads a stored `branding` as the contract types it, loose jsonb
 * values, and skips one that doesn't fit (`chapter-mark.ts`): a read that
 * refused one value would blank every field beside it (#2844).
 */
export const ChapterBrandingSchema = z
  .object({
    greek_letters: z.string().optional(),
    // The chapter mark's text options (#2876); precedence is `chapter-mark.ts`.
    // An empty string is how Settings clears a short name, since the config
    // PATCH deep-merges and an omitted key keeps its stored value.
    //
    // No `.max()` here, deliberately. The cap (`CHAPTER_SHORT_NAME_MAX_LENGTH`)
    // is enforced by the DTO, whose class-validator count differs from zod's:
    // it drops variation selectors, so "❤️❤️❤️❤️" is 4 to the API and 8 to zod.
    // A zod cap would state a stricter limit than the one enforced; the inputs'
    // `maxLength` is the client-side cap.
    short_name: z.string().optional(),
    show_greek_letters: z.boolean().optional(),
    designation: z.string().optional(),
    school_short: z.string().optional(),
    founded_at: z.number().int().min(1776).max(YEAR_MAX).optional(),
    colors: z
      .object({
        // One seed. The legacy second colour (`dark`) fed only the
        // `derivePalette` token map and went with it in the #920 slice-9
        // cutover; rows written before that keep an inert stored value, which
        // nothing reads.
        accent: z
          .string()
          .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
          .optional(),
      })
      .optional(),
  })
  .optional();

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

const MODULE_DISABLED_PREFIX = 'The "';
const MODULE_DISABLED_SUFFIX =
  '" module is disabled for this chapter. Re-enable it in Settings → Modules to make changes.';

/**
 * The message `ChapterGuard.enforceModule` refuses a write with when `key` is
 * off. The guard throws exactly this string, so it lives here rather than in
 * the guard: the clients recognise the refusal by it, and one builder means
 * the two cannot drift.
 *
 * It is addressed to an officer ("Re-enable it in Settings → Modules"), which
 * is right for the web dashboard and wrong for a member, who cannot follow it.
 * A member surface matches it with `moduleRefusalFromServerMessage` and shows
 * its own copy instead.
 */
export function moduleDisabledMessage(key: string): string {
  return `${MODULE_DISABLED_PREFIX}${key}${MODULE_DISABLED_SUFFIX}`;
}

/**
 * Recognise the module gate's refusal from the server's `message`, returning
 * the module it names, or `null` for any other message.
 *
 * **Why the message.** The guard also throws `code: 'chapter.module.disabled'`,
 * but until #1020 `AllExceptionsFilter` dropped it, so a branch keyed on the
 * code typechecked, passed any test that hand-built a body with `code`, and
 * never fired in production: that was mobile study's module branch until
 * #2393. The code reaches clients now, but only this message names the
 * module, and installed builds match it; checking the code first is #2995.
 * Nor is a bare 403 a substitute, because the same routes 403 for permission
 * denials that must keep their own copy.
 *
 * The match is exact apart from the key: the whole fixed prefix and suffix
 * must be present, and the key between them must be non-empty and unquoted.
 */
export function moduleRefusalFromServerMessage(
  message: string | null | undefined,
): { moduleKey: string } | null {
  if (typeof message !== "string") return null;
  if (!message.startsWith(MODULE_DISABLED_PREFIX)) return null;
  if (!message.endsWith(MODULE_DISABLED_SUFFIX)) return null;
  const moduleKey = message.slice(
    MODULE_DISABLED_PREFIX.length,
    message.length - MODULE_DISABLED_SUFFIX.length,
  );
  if (moduleKey.length === 0 || moduleKey.includes('"')) return null;
  return { moduleKey };
}

// ── Chat message schemas (Chunk 02; hot-path moved to NestJS in #416)
// Originally shared with the Deno Edge Functions; kept dependency-light
// (zod only) so any future Deno consumer can still import this file
// directly via an import map without Node.js-specific resolution. ──────

/**
 * `users.id` of the system actor behind server-originated chat messages — the
 * chapter welcome post, the `#chapter-audit` bridge, invite-accept DMs and the
 * poll-expiry notice. A real seeded `users` row
 * (`supabase/migrations/20260524120000_chapter_directory_requests.sql`).
 *
 * Canonical here rather than in the API so clients read the same value the
 * server enforces: `spec/behavior/chat/README.md` § Block makes the system
 * actor unblockable (`ChatBlockService` refuses it with a 400), and a client
 * offering "Block" on a system message would be a dead control. The API's
 * `domain/constants/chat.ts` re-exports this rather than keeping a copy.
 */
export const SYSTEM_SENDER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Where a client's read of its own chat block list stands
 * (`spec/behavior/chat/README.md` § The masking contract). Tri-state, never
 * boolean: a failed read that looked like "nobody is blocked" would fail open
 * on a safety feature — the exact defect #2315 records.
 *
 * Canonical here because two packages that may not import each other share
 * it: `@repo/hooks`' `useBlockedUserIds` produces it, and `@repo/chat-core`'s
 * classifier (`blocks.ts`) consumes it.
 */
export type BlockListStatus = "ready" | "loading" | "unavailable";

export const CHAT_MESSAGE_KINDS = [
  "text",
  "event",
  "task",
  "poll",
  "dues",
  "points",
  "hours",
  "rush",
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

// ── Alumni channel permission ────────────────────────────────────────────────
// The channel-access predicate that reads this lives in the API
// (`apps/api/src/domain/utils/channel-access.ts`, #3268); mobile reads the
// value too, so it stays shared.

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

// ── Type Exports ─────────────────────────────────────────────────────────────

export type ChapterBranding = z.infer<typeof ChapterBrandingSchema>;
export type ChapterDuesConfig = z.infer<typeof ChapterDuesConfigSchema>;
export type ChapterPointsConfig = z.infer<typeof ChapterPointsConfigSchema>;
export type PatchChapterConfig = z.infer<typeof PatchChapterConfigSchema>;
export type ChapterCustomRole = z.infer<typeof ChapterCustomRoleSchema>;
export type CreateCustomRole = z.infer<typeof CreateCustomRoleSchema>;
export type UpdateCustomRole = z.infer<typeof UpdateCustomRoleSchema>;
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;
export type CustomFieldVisibility = z.infer<typeof CustomFieldVisibilitySchema>;
export type ChapterCustomField = z.infer<typeof ChapterCustomFieldSchema>;
export type CreateCustomField = z.infer<typeof CreateCustomFieldSchema>;
export type UpdateCustomField = z.infer<typeof UpdateCustomFieldSchema>;

// ── Analytics payload hygiene (issue #464) ───────────────────────────────────
export {
  assertContentFreeProperties,
  ContentFreePropertyError,
  FORBIDDEN_ANALYTICS_PROPERTY_KEYS,
} from "./analytics";
export type { AnalyticsEvent, AnalyticsProperties } from "./analytics";

// ── `@`-mention resolution (C1 of #937) ──────────────────────────────────────
// Shared because the API's authoritative pass and any client-side preview must
// not disagree about who `@jane` is — but only the API's result is persisted,
// since mentions override a per-channel mute in the push rules and a
// client-supplied list would be forgeable.
export {
  extractMentionTokens,
  findMentionSpans,
  matchMentionCandidate,
  resolveMentions,
} from "./mentions";
export type { MentionCandidate, MentionSpan } from "./mentions";

// ── Time zones (issue #687) ──────────────────────────────────────────────────
export {
  isSupportedTimeZone,
  isUtcOffset,
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

// ── Ops-setup nudges (issue #492) ────────────────────────────────────────────
// Shared for the same reason as the categories above: each `key` is written
// verbatim into `members.dismissed_ops_nudges`, the column is an unconstrained
// `text[]`, and `DismissOpsNudgeDto` validates against this catalog — so a
// per-surface copy would drift into dismissal entries that suppress nothing.
// `selectOpsNudge` carries the spec's priority order, which is behavior rather
// than presentation, so it is shared too rather than re-derived per surface.
export {
  OPS_NUDGE_MODULES,
  isOpsNudgeModuleKey,
  selectOpsNudge,
} from "./ops-nudges";
export type { OpsNudgeModule, OpsNudgeModuleKey } from "./ops-nudges";

// Client-side RBAC gates, shared by apps/web and apps/mobile. Moved out of
// `apps/web/lib/auth/can.ts` with #994 so the wildcard rule has one definition.
export {
  can,
  canAll,
  canAny,
  CHAPTER_PROFILE_PERMISSIONS,
  CHAT_REPORT_QUEUE_PERMISSIONS,
  WILDCARD_PERMISSION,
} from "./permissions";

// Client-side subscription write gate. Moved out of `apps/web/lib/subscription.ts`
// so it sits next to `can` and `isModuleEnabled` as the third shared client gate.
export {
  SUBSCRIPTION_GRACE_PERIOD_MS,
  isSubscriptionStatus,
  isWithinSubscriptionGrace,
  subscriptionRefusalFromServerMessage,
  subscriptionWriteState,
} from "./subscription";
// Client-side analytics opt-out. Fourth shared client gate alongside `can`,
// `isModuleEnabled`, and `subscriptionWriteState`.
export {
  isAnalyticsOptedOut,
  isChapterAnalyticsOptedOut,
} from "./analytics-opt-out";

// Connection state machine (`spec/ui/resilience/connection-state.md`). Shared so web and
// mobile cannot disagree about ONLINE / DEGRADED / OFFLINE. Each app owns
// the effects that feed it; this package owns the rule.
export {
  DEGRADED_THRESHOLD,
  deriveConnectionState,
  healthProbeIsReachable,
} from "./connection-state";
export type { ConnectionInput, ConnectionState } from "./connection-state";
export type {
  SubscriptionBlockCode,
  SubscriptionRefusal,
  SubscriptionStatus,
  SubscriptionWriteClass,
  SubscriptionWriteState,
} from "./subscription";

// ── Field limits ─────────────────────────────────────────────────────────────
// The bounds a client or a schema here reads. The API-only ones are in
// `apps/api/src/domain/constants/field-limits.ts` (#3268).
export {
  ROLE_NAME_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  CHAPTER_SHORT_NAME_MAX_LENGTH,
};
export { POLL_OPTIONS_MAX, POLL_OPTIONS_MIN, YEAR_MAX } from "./field-limits";

// ── Chapter mark (logo → short name → Greek letters → initials) ─────────────
export {
  chapterInitials,
  chapterTextMark,
  displayedGreekLetters,
  greekLettersShown,
  resolveChapterMark,
} from "./chapter-mark";
export type {
  ChapterMark,
  ChapterMarkBranding,
  ChapterTextMarkSource,
} from "./chapter-mark";

// ── Upload MIME / extension allowlists + 25 MB size cap ─────────────────────
export {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  DOCUMENT_UPLOAD_SURFACES,
  contentTypeByExtension,
  acceptAttribute,
  fileExtension,
  normalizeExtension,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  mimeForUploadFile,
  inspectUploadFile,
} from "./upload-allowlists";
export type { UploadKind, InspectedUpload } from "./upload-allowlists";

// Discord export (DCE) preamble parsing, shared between the import wizard
// (apps/web) and the import worker (apps/api). See ./discord-export for why
// this used to be two copies of the same scanner.
export { parseExportPreamble } from "./discord-export";
export type { DiscordExportPreamble } from "./discord-export";

// Which Discord imports may be cleared off the list, shared so the web never
// offers a Clear the API refuses. See ./discord-import.
export {
  DISCORD_IMPORT_CLEARABLE_STATUSES,
  isDiscordImportClearable,
} from "./discord-import";

// Invite paste/URL extraction and https minting, shared so web `/join`,
// mobile s02, the API email helper, and the landing `/join` redirect cannot
// drift on what a copied join link is or whether a public http: origin is
// allowed. See ./invite-token.
export {
  extractInviteToken,
  extractInviteTokenFromQuery,
  assertHttpsJoinOrigin,
  mintJoinUrl,
  PRODUCTION_APP_ORIGIN,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_SUPABASE_PROJECT_REF,
  isProductionSupabaseUrl,
  assertProductionAppOrigin,
  assertProductionApiOrigin,
  assertProductionSupabaseUrl,
} from "./invite-token";

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
export { MISSING_SIGNED_UPLOAD, readSignedUpload } from "./signed-upload";

export {
  CHAT_NOTIFICATION_LEVELS,
  builtInChannelDefault,
  isAnnouncementChannel,
  isDirectChannel,
} from "./chat-notification-defaults";
export type {
  ChatNotificationLevel,
  NotificationDefaultChannel,
} from "./chat-notification-defaults";

export {
  SIDEBAR_FIXED_SECTION_KEYS,
  categoryIdFromSectionKey,
  categorySectionKey,
  isSidebarSectionKey,
} from "./chat-sidebar";
export type { SidebarFixedSectionKey, SidebarSectionKey } from "./chat-sidebar";
