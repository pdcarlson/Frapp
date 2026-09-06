"use client";

import type { ReactNode } from "react";
import { useMyPermissions } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { can, canAll, canAny } from "@repo/validation";
import { PermissionsOffline } from "@/components/shared/async-states";

type BaseProps = {
  children: ReactNode;
  /**
   * Rendered while the permission request is **in flight or disabled** —
   * `isLoading`, or the `enabled: false` window before a chapter resolves.
   * Defaults to `null` — callers who want a skeleton should pass one
   * explicitly so we never show a flash of un-permitted content. `null` keeps
   * permission-denied UX crisp: the button/page simply isn't there, rather
   * than showing a placeholder that implies "loading" even to permitted users
   * whose fetch is still in flight.
   *
   * It does **not** cover the paused case any more; see `offlineFallback`.
   */
  fallback?: ReactNode;
  /**
   * Rendered when the permission query is **paused with nothing cached** —
   * offline, first visit this session, no answer to be stale about.
   *
   * Unlike the other two, this defaults to something rather than to `null`.
   * The default is the control-slot member of the §10 offline family, which is
   * the right shape for the eighteen call sites that gate a single button; the
   * five that stand in for a screen or a card pass `OfflineState` /
   * `NestedOffline` themselves. Defaulting it non-null is the point: #1211 was
   * twelve surfaces rendering nothing at all, and every one of them reached
   * that by *omitting* a prop rather than by passing `null`.
   *
   * Pass a function to receive the gate's own `retry`. The recovery path here
   * is the *permission* query, which the call site does not hold — handing it
   * down beats making five screens re-declare `useMyPermissions()` beside the
   * component that already owns it. `ReactNode` excludes functions, so the two
   * forms discriminate cleanly.
   */
  offlineFallback?: ReactNode | ((retry: () => void) => ReactNode);
  /**
   * Rendered when the caller lacks the required permissions. Defaults to
   * `null`; pass a disabled-state element for UX where hiding the whole
   * control would be disorienting.
   */
  deniedFallback?: ReactNode;
};

type CanProps = BaseProps &
  (
    | { permission: string; anyOf?: never; allOf?: never }
    | { permission?: never; anyOf: readonly string[]; allOf?: never }
    | { permission?: never; anyOf?: never; allOf: readonly string[] }
  );

/**
 * Render `children` only when the current caller holds the required
 * permission(s) for the active chapter.
 *
 * Wraps `useMyPermissions()` so screens don't have to duplicate the TanStack
 * Query wiring. While the query is in flight we render `fallback` (default
 * `null`) to avoid flashing un-permitted UI, matching the UI resilience
 * spec's "show, don't guess" principle.
 *
 * ```tsx
 * <Can permission="members:invite">
 *   <Button>Invite member</Button>
 * </Can>
 * ```
 *
 * Exactly one of `permission`, `anyOf`, or `allOf` must be provided.
 *
 * ## Permissions are stale-while-revalidate, and a paused check is never silent
 *
 * `README.md` §4 has said since the Chapter Ops slice that a spinner gates on
 * `isLoading` or `fetchStatus === "paused"`, and that `isPending &&
 * fetchStatus === "idle"` is the entitlement branch. That rule was applied to
 * the *data* queries on `/polls` and `/backwork` and not to the *permission*
 * query that decides whether those queries render at all — so this component
 * branched on `isPending` alone, and a member who opened a gated route offline
 * for the first time in a session held the gate's fallback forever (#1211).
 * TanStack's default `networkMode` is `"online"`, nothing here sets one, and
 * there is no persister, so nothing resolved it but the network coming back.
 *
 * The three branches below are that rule spelled in flags:
 *
 * - **Cached answer, whatever the fetch is doing** → evaluate it. v5 keeps
 *   `isPending` false whenever `data` exists, so a paused *refetch* falls
 *   straight through to the verdict on its own; the `isError` branch below had
 *   to be narrowed to `!data` for a *failed* refetch to do the same. Both are
 *   pinned in `can-fallback.spec.tsx`, because the obvious fix — gate on
 *   `fetchStatus === "paused"` alone — breaks the first, which is the defect
 *   the Resources & Reporting slice found on two data queries.
 * - **Paused, nothing cached** → `offlineFallback`. Never `null`: an
 *   unanswerable check is a recoverable state, and §5 rule 4 reserves hiding
 *   for "permissions the user will never hold".
 * - **Idle, nothing cached** → `fallback`, and the gate still **fails closed**.
 *   Swapping `isPending` for `isLoading` here would render gated content to a
 *   viewer whose permissions were never fetched; §4 names that trap by name.
 *
 * `refetch` is threaded into the default's Retry. While the link is still down
 * TanStack re-pauses it, which is the honest outcome — the control re-arms
 * rather than claiming to have checked.
 */
export function Can({
  children,
  fallback = null,
  offlineFallback,
  deniedFallback = null,
  permission,
  anyOf,
  allOf,
}: CanProps) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isPending, isError, fetchStatus, refetch } = useMyPermissions({
    enabled: Boolean(activeChapterId),
  });

  if (!activeChapterId) {
    // No chapter picked yet — there is no permission context to evaluate
    // against. Treat this as "denied" so children aren't rendered.
    return <>{deniedFallback}</>;
  }

  if (isPending && fetchStatus === "paused") {
    // Above the bare `isPending` below, which would otherwise swallow it: a
    // paused query is pending too.
    const retry = () => {
      void refetch();
    };
    return (
      <>
        {typeof offlineFallback === "function"
          ? offlineFallback(retry)
          : offlineFallback === undefined
            ? // Omitted, so the caller gets the default. `=== undefined` and
              // not `??`: the three gates that deliberately pass `null` mean
              // "render nothing", and `null ?? x` is `x`, so `??` handed them
              // the very chip they were suppressing — two identical rows on
              // `/backwork`, one where the Upload button was and one where the
              // notice should have been silent. Found by the pre-push review,
              // twice, because the source-level guard below cannot see it.
              <PermissionsOffline onRetry={retry} />
            : offlineFallback}
      </>
    );
  }

  if (isPending) {
    return <>{fallback}</>;
  }

  if (isError && !data) {
    // A failed permissions fetch with nothing cached is fail-safe closed. The
    // shell shows a global error banner in this case; individual gated
    // controls just disappear until the fetch recovers.
    //
    // `&& !data` because v5 keeps `data` through a *background* refetch
    // failure and only resets `status` to `pending` when there is none
    // (`query-core`'s reducer guards that reset on `data === undefined`). So a
    // 500 on a refetch used to discard an answer we still hold and deny a
    // member their own controls — the same stale-while-revalidate mistake as
    // the paused branch above, one status over. Found by the pre-push review
    // of this change, which correctly refused the docstring's claim that a
    // cached answer is used "whatever the fetch is doing" until it was.
    return <>{deniedFallback}</>;
  }

  const permissions = data?.permissions ?? [];
  const granted = permission
    ? can(permission, permissions)
    : anyOf
      ? canAny(anyOf, permissions)
      : allOf
        ? canAll(allOf, permissions)
        : false;

  return <>{granted ? children : deniedFallback}</>;
}
