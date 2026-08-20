/**
 * Which membership the first-run gate cares about.
 *
 * Web's tutorial keys off the *active* membership
 * (`apps/web/components/onboarding/onboarding-tutorial.tsx`). Mobile does the
 * same when the JWT carries `active_chapter_id`. While #805 is open that claim
 * is absent in production, so a sole membership is the only one we can
 * attribute — a multi-chapter account with no claim is not forced through s03
 * (they already have a chapter they can open from More).
 */

export type OnboardingMembership = {
  chapter_id: string;
  has_completed_onboarding: boolean;
};

export function selectOnboardingMembership<T extends OnboardingMembership>(
  memberships: readonly T[],
  chapterId: string | null,
): T | null {
  if (memberships.length === 0) return null;
  if (chapterId) {
    return memberships.find((row) => row.chapter_id === chapterId) ?? null;
  }
  return memberships.length === 1 ? (memberships[0] ?? null) : null;
}

export function needsFirstRun(
  memberships: readonly OnboardingMembership[],
  chapterId: string | null,
): boolean {
  const membership = selectOnboardingMembership(memberships, chapterId);
  return membership?.has_completed_onboarding === false;
}
