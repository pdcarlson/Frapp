import { useLegalAcceptance, useListChapters } from "@repo/hooks";
import {
  gateReadStatus,
  resolveAuthGate,
  type AuthGateDestination,
} from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";

/**
 * The live input `resolveAuthGate` needs, read once so `(auth)/_layout.tsx`
 * and `AppRuntime` cannot drift.
 *
 * `(tabs)/_layout.tsx` is frozen and still calls `resolveAuthGate` with only
 * the session — it does not have to know about join/welcome. Walking a member
 * *out* of the tabs onto those screens is `AppRuntime`'s job.
 */
export function useAuthGateDestination(): AuthGateDestination {
  const { status, chapterId, isChapterResolving } = useAuthSession();
  const chapters = useListChapters({ enabled: status === "authenticated" });
  const legalAcceptance = useLegalAcceptance({
    enabled: status === "authenticated",
  });

  // Authenticated + not yet answered is pending, not idle. Idle is the
  // frozen tabs layout's "I cannot see memberships" fail-open; here we *can*
  // see the query, and treating a not-yet-started fetch as idle would paint
  // tabs for a frame and skip s02/s03. Answer before error: a failed refetch
  // keeps the cached list, or it would skip the Terms prompt (#2302).
  const membershipsStatus = gateReadStatus({
    authenticated: status === "authenticated",
    hasAnswer: Array.isArray(chapters.data),
    isError: chapters.isError,
  });

  const memberships = Array.isArray(chapters.data)
    ? chapters.data.map((row) => ({
        chapter_id: row.chapter_id,
        has_completed_onboarding: row.has_completed_onboarding,
      }))
    : [];

  // Answer first, error second: a failed refetch keeps its cached answer, so
  // it can neither blank the app nor let a member skip the prompt.
  const legalAcceptanceStatus = gateReadStatus({
    authenticated: status === "authenticated",
    hasAnswer: legalAcceptance.data !== undefined,
    isError: legalAcceptance.isError,
  });

  return resolveAuthGate({
    status,
    chapterId,
    isChapterResolving,
    membershipsStatus,
    memberships,
    legalAcceptanceStatus,
    legalAcceptanceRequired: legalAcceptance.data?.required === true,
  });
}
