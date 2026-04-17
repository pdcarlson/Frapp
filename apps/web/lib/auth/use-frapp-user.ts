"use client";

import { useCurrentUser } from "@repo/hooks";

/**
 * Tiny convenience wrapper around `useCurrentUser` that exposes the
 * Frapp application user id as a stable string. Some realtime hooks need
 * the id to scope subscriptions — if the id isn't loaded yet, they gate
 * themselves via the `enabled` option.
 */
export function useFrappUser(): { userId: string | null; isLoading: boolean } {
  const query = useCurrentUser();
  const rawId =
    query.data && typeof query.data === "object" && "id" in query.data
      ? (query.data as { id?: string }).id ?? null
      : null;
  return {
    userId: typeof rawId === "string" && rawId.length > 0 ? rawId : null,
    isLoading: query.isPending,
  };
}
