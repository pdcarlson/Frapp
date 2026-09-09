import { isPseudonymHex, type AnalyticsIdentity } from "@repo/observability";

/**
 * The only identifier PostHog `identify` and Sentry `user.id` may hold.
 * Anything that is not a 64-char lowercase hex digest — a UUID, an email, a
 * raw user id — is dropped rather than trusted.
 */
export function validatedDistinctId(
  identity:
    | Pick<AnalyticsIdentity, "enabled" | "distinct_id">
    | null
    | undefined,
): string | null {
  if (!identity?.enabled) return null;
  return isPseudonymHex(identity.distinct_id) ? identity.distinct_id : null;
}

/**
 * Chapter group key for `posthog.group('chapter', …)`. Never a raw
 * `chapter_id`.
 */
export function validatedChapterGroupId(
  identity: Pick<AnalyticsIdentity, "chapter_group_id"> | null | undefined,
): string | null {
  return isPseudonymHex(identity?.chapter_group_id)
    ? identity.chapter_group_id
    : null;
}
