"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  type InvalidateQueryFilters,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { usePermissionPreview } from "./permission-preview";

/**
 * `enabled: false` keeps an observer from fetching, for a caller mounted where
 * nobody may be signed in yet (mobile's app-wide runtimes sit above the auth
 * gate). It still reads whatever another observer cached.
 */
export function useCurrentUser(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["user", "me"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/users/me");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: options?.enabled ?? true,
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
export function useViewerUserId(options?: {
  enabled?: boolean;
}): string | null {
  const query = useCurrentUser(options);
  return userIdOf(query.data);
}

/** A `/v1/users/me` row's `users.id`, narrowed as {@link useViewerUserId} says. */
function userIdOf(data: unknown): string | null {
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
    mutationKey: ["user", "update-user"],
    mutationFn: async (body: components["schemas"]["UpdateUserDto"]) => {
      const { data, error } = await client.PATCH("/v1/users/me", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      // The PATCH answers with the whole updated row, in the shape
      // `GET /v1/users/me` serves (both sign the photo), so it goes straight
      // into the cache: a form that closes on success closes onto it, without
      // waiting on a refetch a dropped connection could hold paused after the
      // save itself landed. Only over the same account's cached row: a save
      // still in flight across a sign-out or an account swap must not put the
      // previous member's row back into a cache the swap just cleared.
      queryClient.setQueryData(["user", "me"], (old: unknown) => {
        const id = userIdOf(old);
        return id !== null && id === userIdOf(saved) ? saved : old;
      });
      // `["user", "me"]` too, though it was just written: invalidating it
      // cancels a GET that left before the PATCH landed, which would
      // otherwise answer last and put the pre-save row back.
      void invalidateProfileReads(queryClient);
    },
  });
}

/**
 * Every query whose rows carry the viewer's profile (name, photo, bio,
 * graduation year, city, company): their own profile, every `["members", …]`
 * read (roster, directory, detail, search, and through the roster every chat
 * author label), the alumni directory and its city and company filters, and
 * the activity feed's actors. For the photo it matters twice over: the server
 * deletes the replaced object, so a query left out here keeps rendering a URL
 * to nothing.
 *
 * `["user", "me"]` is matched exactly: as a prefix it would also refetch
 * `["user", "me", "permissions", …]`, `["user", "me", "legal-acceptance"]` and
 * `["user", "me", "whats-new"]`, which a profile edit can't change. The photo mutations wait for every
 * refetch they start. `useUpdateUser` starts them without waiting, having
 * first written the saved row over the cached one when both are the same
 * account's.
 */
export const PROFILE_QUERY_FILTERS: readonly InvalidateQueryFilters[] = [
  { queryKey: ["user", "me"], exact: true },
  { queryKey: ["members"] },
  { queryKey: ["alumni"] },
  { queryKey: ["activity-feed"] },
];

function invalidateProfileReads(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return Promise.all(
    PROFILE_QUERY_FILTERS.map((filters) =>
      queryClient.invalidateQueries(filters),
    ),
  );
}

/**
 * Step 1 of 3 of a profile-photo change: `POST /v1/users/me/avatar-url`.
 *
 * Read the ticket with `readSignedUpload` from `@repo/validation`, PUT the
 * bytes to it, then confirm with {@link useConfirmAvatar}. The PUT is left to
 * the caller because the two clients hold different things: web a DOM `File`
 * (`putSignedUpload`), mobile a `file://` URI (`FileSystem.uploadAsync`).
 *
 * Chapter-scoped: the photo lands in the caller's folder for the active
 * chapter, which the confirm checks.
 */
export function useRequestAvatarUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["user", "request-avatar-upload-url"],
    mutationFn: async (body: {
      filename: string;
      content_type: string;
      size_bytes?: number;
    }) => {
      const { data, error } = await client.POST("/v1/users/me/avatar-url", {
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Step 3 of 3: `POST /v1/users/me/avatar` makes the uploaded object the
 * viewer's photo, and the server deletes the one it replaced.
 *
 * `mutateAsync` resolves once the reads that show the photo have refetched, so
 * a caller that clears its busy state on resolve never shows the old photo.
 */
export function useConfirmAvatar() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["user", "confirm-avatar"],
    mutationFn: async (storagePath: string) => {
      const { data, error } = await client.POST("/v1/users/me/avatar", {
        body: { storage_path: storagePath },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateProfileReads(queryClient),
  });
}

/** `DELETE /v1/users/me/avatar`: back to initials everywhere. */
export function useRemoveAvatar() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["user", "remove-avatar"],
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/v1/users/me/avatar");
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateProfileReads(queryClient),
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
    mutationKey: ["user", "delete-account"],
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
  // "View as a role" (#4072): the previewed set replaces the viewer's own in
  // what screens read. `select` runs per observer, so the cached answer (and
  // every invalidation of it) stays the viewer's own.
  const preview = usePermissionPreview();
  const select = useCallback(
    <T extends { permissions?: unknown }>(data: T): T =>
      preview ? { ...data, permissions: [...preview] } : data,
    [preview],
  );
  return useQuery({
    queryKey: ["user", "me", "permissions", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/users/me/permissions");
      if (error) throw error;
      return data;
    },
    select,
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
