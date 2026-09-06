import { Chapter } from '#domain/entities/chapter.entity';

/**
 * The `chapters` columns any member of that chapter may read (#930).
 *
 * `GET /v1/chapters/current` and `GET /v1/chapters` both used to ship the whole
 * row, because `SupabaseChapterRepository.findById` is `select('*')` and the
 * service spread the result. That put `stripe_customer_id`, `subscription_id`
 * and the legal-acceptance columns in front of every member holding
 * `members:view` — which is everyone.
 *
 * ## Why an allowlist, and why it is iterated rather than deleted from
 *
 * `toChapterMemberView` builds its result by walking *this* array, so a column
 * added to `chapters` later is absent from the payload until someone adds it
 * here on purpose. The obvious alternative — spread the row and `delete` the
 * sensitive keys — fails open: the next migration to add a private column
 * exposes it by default, and nothing fails to tell you. That default-deny
 * property is acceptance criterion #4 on the issue, not a stylistic
 * preference.
 *
 * ## Two entries here are load-bearing and must not be "cleaned up"
 *
 * `subscription_status` and `past_due_since` are what the client-side
 * subscription gate reads (`use-subscription-write-state.ts`). Dropping them
 * would not throw anywhere: `isWithinSubscriptionGrace(null)` **fails open**,
 * so every client would render grace-window affordances indefinitely while the
 * server hard-locked the same writes. `chapter-member-view.spec.ts` pins both
 * for exactly this reason.
 *
 * ## Where the excluded columns are still available
 *
 * - `stripe_customer_id` / `subscription_id` — `GET /v1/billing/status`, which
 *   requires `billing:view` (`BillingController`). The web billing page already
 *   reads them from there.
 * - `org_archetype`, `enabled_modules`, `vocabulary`, `branding`,
 *   `theme_palette`, `beta_config` — also served by `GET /chapters/:id/config`
 *   (`useOrgConfig`). The first five stay here because the dashboard shell,
 *   `ChapterLockup` and the mobile branding hook read them off this payload
 *   directly; `beta_config` is internal rollout state with no reader on it.
 * - `legal_accepted_at` / `legal_policy_version` / `legal_accepted_by`,
 *   `last_stripe_webhook_at`, `directory_id` — no client reads them at all.
 */
export const CHAPTER_MEMBER_VIEW_FIELDS = [
  'id',
  'name',
  'university',
  // Entitlement mirror — see the docblock above before removing either.
  'subscription_status',
  'past_due_since',
  'accent_color',
  'logo_path',
  'donation_url',
  'created_at',
  'updated_at',
  // Chunk 02 customization columns the member-facing shell renders from.
  'org_archetype',
  'enabled_modules',
  'vocabulary',
  'branding',
  'theme_palette',
  'analytics_opt_out',
  // #349: every member must be able to see the orphan-president claim
  // prompt, since the eligible claimant is by definition NOT the president
  // (and often not a `roles:manage` holder either) — see
  // `PresidencyClaimBanner` in `roles-page.tsx`, which renders outside the
  // `roles:manage` gate for exactly this reason.
  'needs_president',
] as const satisfies readonly (keyof Chapter)[];

export type ChapterMemberViewField =
  (typeof CHAPTER_MEMBER_VIEW_FIELDS)[number];

/** A `Chapter` narrowed to the columns a chapter member may read. */
export type ChapterMemberView = Pick<Chapter, ChapterMemberViewField>;

/**
 * Project a full chapter row onto the member-safe view.
 *
 * Absent optional keys stay absent rather than becoming `undefined`: several
 * narrower repository projections (e.g. `ChapterGuard`'s) select only a few
 * columns, and materialising `vocabulary: undefined` on those would change
 * `'vocabulary' in chapter` for downstream readers.
 */
export function toChapterMemberView(chapter: Chapter): ChapterMemberView {
  const view: Partial<Record<ChapterMemberViewField, unknown>> = {};
  for (const field of CHAPTER_MEMBER_VIEW_FIELDS) {
    if (field in chapter) {
      view[field] = chapter[field];
    }
  }
  return view as ChapterMemberView;
}
