"use client";

import type { ReactNode } from "react";
import { useMyPermissions } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { can, canAll, canAny } from "@/lib/auth/can";

type BaseProps = {
  children: ReactNode;
  /**
   * Rendered while the permission request is in flight. Defaults to `null`
   * — callers who want a skeleton should pass one explicitly so we never
   * show a flash of un-permitted content.
   */
  fallback?: ReactNode;
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
 */
export function Can({
  children,
  fallback = null,
  deniedFallback = null,
  permission,
  anyOf,
  allOf,
}: CanProps) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isPending, isError } = useMyPermissions({
    enabled: Boolean(activeChapterId),
  });

  if (!activeChapterId) {
    // No chapter picked yet — there is no permission context to evaluate
    // against. Treat this as "denied" so children aren't rendered.
    return <>{deniedFallback}</>;
  }

  if (isPending) {
    return <>{fallback}</>;
  }

  if (isError) {
    // A failed permissions fetch is fail-safe closed. The shell shows a
    // global error banner in this case; individual gated controls just
    // disappear until the fetch recovers.
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
