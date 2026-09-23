"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export function useCurrentUser() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["user", "me"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/users/me");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

/**
 * The viewer's `users.id`, or `null` until it is known.
 *
 * Narrowed at runtime rather than read off the generated type: `/v1/users/me`
 * carries no response schema, so `openapi-typescript` infers its body as
 * `never` and a direct `user.id` does not compile on either client. Both apps
 * had grown their own copy of this narrowing; this is the single one.
 *
 * `users.id` is the id chat is keyed on — `chat_messages.sender_id` and a DM
 * channel's `member_ids` both reference it, *not* the Supabase auth uid.
 */
export function useViewerUserId(): string | null {
  const query = useCurrentUser();
  const data: unknown = query.data;
  const raw =
    data && typeof data === "object" && "id" in data
      ? ((data as { id?: unknown }).id ?? null)
      : null;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function useUpdateUser() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      display_name?: string;
      bio?: string;
      avatar_url?: string;
      graduation_year?: number | null;
      current_city?: string;
      current_company?: string;
    }) => {
      const { data, error } = await client.PATCH("/v1/users/me", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

/**
 * Delete the caller's account — irreversible (#713).
 *
 * Self-service: bearer token only, no chapter header. The endpoint's own
 * contract makes the failure path unusual and callers must honor it: a **502
 * means the flow did not finish**, and because every step is idempotent the
 * right response is to retry, not to treat it as fatal. Depending on which step
 * failed the account may already be anonymized while sign-in still works, so a
 * surface must not claim the account survived either.
 *
 * **The caller must clear the query cache on success.** Every cached entry now
 * belongs to an account that no longer exists, and several keys are not
 * user-scoped — `["settings"]` least of all — so a second member signing in on
 * the same device would be served the deleted member's rows until each entry
 * went stale. On mobile the `QueryClient` is a module singleton; `signOut`
 * and an in-place auth-uid swap both clear it. Invalidating from here would be
 * worse than useless, since a refetch on a deleted account cannot succeed.
 * Callers still clear on success as defense in depth for web and for any path
 * that does not go through those funnels.
 */
export function useDeleteAccount() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/v1/users/me");
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Load the caller's effective permission set for the active chapter.
 *
 * `staleTime` is intentionally long: permissions are already flattened
 * server-side from role memberships, and role changes are rare. The hook
 * is disabled until a chapter is selected so new sign-ins do not hit the
 * API before the chapter store is hydrated.
 */
export function useMyPermissions(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const enabled = (options?.enabled ?? true) && !!chapterId;
  return useQuery({
    queryKey: ["user", "me", "permissions", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/users/me/permissions");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    enabled,
  });
}

/**
 * The viewer's flattened permission set for the active chapter, or `[]`
 * while it is loading/disabled.
 *
 * Thin convenience wrapper around {@link useMyPermissions} for the common
 * case of call sites that only need the `permissions` array, not the full
 * query object.
 */
export function usePermissionList(): readonly string[] {
  const { data } = useMyPermissions();
  return Array.isArray(data?.permissions) ? data.permissions : [];
}

/** Where the viewer stands against the Terms the server enforces now (#2302). */
export type LegalAcceptance = components["schemas"]["LegalAcceptanceDto"];

/**
 * Query key for {@link useLegalAcceptance}. Under `["user", "me"]`, so
 * `useUpdateUser`'s invalidation refreshes it too.
 */
export const legalAcceptanceQueryKey = () =>
  ["user", "me", "legal-acceptance"] as const;

/**
 * Whether the viewer has accepted the Terms of Service and Privacy Policy
 * version the server enforces (#2302).
 *
 * Show the prompt on `data.required`, never by comparing versions: a store
 * binary can't be updated over the air, so one compiled against an older
 * `LEGAL_POLICY_VERSION` would disagree with the server forever. Needs no
 * chapter, because a user is asked before they join one.
 */
export function useLegalAcceptance(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  return useQuery({
    queryKey: legalAcceptanceQueryKey(),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/users/me/legal-acceptance",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Mark the cached status accepted after a request that recorded the
 * acceptance server-side: the Terms prompt, a join with the box ticked, or
 * the create-chapter wizard.
 *
 * Written straight into the cache rather than only invalidated. Those
 * requests also refresh the viewer's memberships, and a gate that saw the new
 * membership before the refetched status would flash the Terms prompt at
 * someone who ticked the box a moment ago. The invalidation that follows
 * still reads the server's answer.
 */
export function markLegalAcceptanceRecorded(queryClient: QueryClient): void {
  queryClient.setQueryData<LegalAcceptance>(legalAcceptanceQueryKey(), (old) =>
    old
      ? {
          ...old,
          accepted_version: old.current_version,
          accepted_at: old.accepted_at ?? new Date().toISOString(),
          required: false,
        }
      : old,
  );
  void queryClient.invalidateQueries({ queryKey: legalAcceptanceQueryKey() });
}

/**
 * Accept the current Terms of Service and Privacy Policy (#2302). The server
 * records the version and time; the body only says the box was ticked.
 */
export function useAcceptLegalTerms() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.POST(
        "/v1/users/me/legal-acceptance",
        { body: { accept_terms_privacy: true } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(legalAcceptanceQueryKey(), data);
    },
  });
}
