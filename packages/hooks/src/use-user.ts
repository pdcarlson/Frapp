"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
 * Deliberately invalidates nothing: on success every cached query belongs to an
 * account that no longer exists, and the caller signs out, which tears the cache
 * down anyway.
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

export function useRequestAvatarUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { filename: string; content_type: string }) => {
      const { data, error } = await client.POST("/v1/users/me/avatar-url", {
        body,
      });
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
