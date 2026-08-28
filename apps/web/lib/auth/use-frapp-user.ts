"use client";

import { useCurrentUser, useViewerUserId } from "@repo/hooks";

/**
 * Tiny convenience wrapper that exposes the Frapp application user id as a
 * stable string alongside the load state. Some realtime hooks need the id to
 * scope subscriptions — if the id isn't loaded yet, they gate themselves via
 * the `enabled` option.
 *
 * The narrowing itself lives in `useViewerUserId` (`@repo/hooks`), shared with
 * mobile; this only adds the `isLoading` half that web's call sites read.
 */
export function useFrappUser(): { userId: string | null; isLoading: boolean } {
  return {
    userId: useViewerUserId(),
    isLoading: useCurrentUser().isPending,
  };
}
