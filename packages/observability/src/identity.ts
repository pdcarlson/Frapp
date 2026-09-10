import { isPseudonymHex, type AnalyticsIdentity } from "./correlation";

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

/**
 * `GET /v1/analytics/identity` through the generated client. Apps pass the
 * bound `GET` so this package never imports the SDK.
 */
export async function fetchAnalyticsIdentity(
  get: () => Promise<{ data?: AnalyticsIdentity | null; error?: unknown }>,
): Promise<AnalyticsIdentity | null> {
  const { data, error } = await get();
  if (error) throw error;
  return data ?? null;
}

/**
 * TanStack Query key for `GET /v1/analytics/identity`.
 *
 * Subject is the Supabase auth uid, not `users.id` / `useViewerUserId`.
 * `["user","me"]` is not account-scoped, so a magic-link swap can keep the
 * previous Frapp user row while the JWT has already changed. Chapter is
 * second so a switch still refetches `chapter_group_id`.
 */
export function observabilityIdentityQueryKey(
  subjectId: string | null | undefined,
  chapterId: string | null | undefined,
): readonly ["observability-identity", string, string] {
  return ["observability-identity", subjectId ?? "none", chapterId ?? "none"];
}

/**
 * Shared `useQuery` options for the identity providers. Apps still own the
 * `enabled` predicate (web: vendor DSNs; mobile: authenticated + vendors).
 */
export function observabilityIdentityQueryOptions(
  subjectId: string | null | undefined,
  chapterId: string | null | undefined,
  get: () => Promise<{ data?: AnalyticsIdentity | null; error?: unknown }>,
  enabled: boolean,
) {
  return {
    queryKey: observabilityIdentityQueryKey(subjectId, chapterId),
    queryFn: () => fetchAnalyticsIdentity(get),
    enabled,
    staleTime: Infinity,
    retry: false as const,
  };
}
