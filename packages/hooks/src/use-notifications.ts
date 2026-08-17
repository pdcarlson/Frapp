"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Query keys for this module.
 *
 * Exported because the optimistic mutations below have to write into the same
 * cache entries the queries read, and inline literals in two places is how those
 * silently stop matching. The arrays are byte-identical to what the queries used
 * before the factory existed, so nothing outside this file moves.
 */
export const notificationKeys = {
  /** Prefix for every notification-scoped entry. */
  all: ["notifications"] as const,
  list: (chapterId: string | null, limit?: number) =>
    ["notifications", chapterId, limit] as const,
  /**
   * Every chapter's preferences. Invalidating here rather than per chapter is
   * deliberate and pre-existing: it is one extra refetch on chapter switch, and
   * it cannot leave a stale chapter cached behind an active one.
   */
  preferencesRoot: ["notifications", "preferences"] as const,
  preferences: (chapterId: string) =>
    ["notifications", "preferences", chapterId] as const,
};

/** `GET /v1/settings` is user-scoped, not chapter-scoped — hence no chapter id. */
export const userSettingsKey = ["settings"] as const;

/**
 * The quiet-hour and theme fields `PATCH /v1/settings` accepts.
 *
 * `null` clears a field; **omitting** it preserves the stored value. Both
 * clients rely on that distinction — web omits an untouched `quiet_hours_tz`
 * rather than echoing a zone this browser's tzdata may not resolve — which is
 * why the optimistic merge below drops `undefined` instead of spreading it.
 */
export interface UpdateUserSettingsBody {
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_tz?: string | null;
  theme?: "light" | "dark" | "system";
}

export interface UpdateNotificationPreferenceBody {
  chapter_id: string;
  category: string;
  is_enabled: boolean;
}

/** One row of `GET /v1/notifications/preferences`, as much as we rely on. */
interface PreferenceRow {
  category?: string;
  is_enabled?: boolean;
}

/**
 * Merge a PATCH body over cached settings, ignoring keys the caller omitted.
 *
 * A plain spread would write `undefined` for every omitted key, which reads back
 * as "no quiet hours" and blanks the member's window in the UI until the
 * refetch lands. Since omission means *preserve* on this endpoint, the
 * optimistic value has to preserve too or it is not predicting the same result.
 */
function mergeDefinedSettings(
  previous: unknown,
  patch: UpdateUserSettingsBody,
): Record<string, unknown> {
  const base =
    previous && typeof previous === "object"
      ? { ...(previous as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

/**
 * Apply a preference toggle to the cached row array.
 *
 * A nullish cache is treated as an empty row list, not as "do not touch": a
 * member who has never set a preference genuinely has no rows, the endpoint
 * answers that with `[]`, and after this PATCH it would answer with exactly the
 * one row appended below. Predicting that is the point.
 *
 * Anything else non-array — some envelope shape this function does not
 * understand — returns `null` and is left alone. `GET /v1/notifications/preferences`
 * has no response schema, so that case cannot be ruled out by types, and
 * appending to a payload of unknown shape would corrupt it.
 */
function applyPreferenceToRows(
  previous: unknown,
  patch: UpdateNotificationPreferenceBody,
): PreferenceRow[] | null {
  if (previous !== null && previous !== undefined && !Array.isArray(previous)) {
    return null;
  }
  const rows: PreferenceRow[] = Array.isArray(previous) ? previous : [];
  let replaced = false;
  const next = rows.map((row) => {
    if (row?.category !== patch.category) return row;
    replaced = true;
    return { ...row, is_enabled: patch.is_enabled };
  });
  // A category the member has never touched has no row — the server treats that
  // as enabled — so the first toggle appends rather than updates.
  if (!replaced) {
    next.push({ category: patch.category, is_enabled: patch.is_enabled });
  }
  return next;
}

export function useNotifications(limit?: number) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: notificationKeys.list(chapterId, limit),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/notifications", {
        params: { query: { limit: String(limit ?? 50) } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
    enabled: !!chapterId,
  });
}

export function useNotificationPreferences(chapterId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: notificationKeys.preferences(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/notifications/preferences",
        { params: { query: { chapterId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: !!chapterId,
  });
}

export function useUserSettings() {
  const client = useFrappClient();
  return useQuery({
    queryKey: userSettingsKey,
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/settings");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

export function useRegisterPushToken() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { token: string; device_name?: string }) => {
      const { data, error } = await client.POST("/v1/push-tokens", { body });
      if (error) throw error;
      return data;
    },
  });
}

export function useRemovePushToken() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/push-tokens/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useMarkNotificationRead() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.PATCH(
        "/v1/notifications/{id}/read",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/**
 * Toggle one notification category, optimistically (#312).
 *
 * The cache is the source of truth here, not a copy the screen keeps: before
 * this, the screen held its own `preferences` state and latched it after the
 * first server payload, so every later payload — a post-PATCH refetch that
 * normalized the value, an edit made on another device, a chapter switch — was
 * dropped on the floor.
 *
 * `onSettled` rather than `onSuccess` invalidates, so a failed PATCH also
 * reconciles against the server instead of leaving the rolled-back value
 * unverified.
 */
export function useUpdateNotificationPreference() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateNotificationPreferenceBody) => {
      const { data, error } = await client.PATCH(
        "/v1/notifications/preferences",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onMutate: async (body) => {
      const queryKey = notificationKeys.preferences(body.chapter_id);
      // An in-flight GET that started before this toggle has not observed it,
      // so letting it land would overwrite the optimistic value with a stale
      // one and look like the write was lost.
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      const next = applyPreferenceToRows(previous, body);
      if (next) queryClient.setQueryData(queryKey, next);
      return { queryKey, previous, wrote: next !== null };
    },
    onError: (_error, _body, context) => {
      if (!context?.wrote) return;
      queryClient.setQueryData(context.queryKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: notificationKeys.preferencesRoot,
      });
    },
  });
}

/**
 * Update quiet hours (and theme, on web), optimistically (#312).
 *
 * Same reconciliation story as the category mutation above. Note the merge
 * drops `undefined` values rather than spreading them — see
 * {@link mergeDefinedSettings}.
 */
export function useUpdateUserSettings() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateUserSettingsBody) => {
      const { data, error } = await client.PATCH("/v1/settings", { body });
      if (error) throw error;
      return data;
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: userSettingsKey });
      const previous = queryClient.getQueryData(userSettingsKey);
      // Only predict against a payload the server actually sent. With no
      // response schema on `GET /v1/settings` an unfetched entry is
      // `undefined`, and writing a body-shaped object into it would hand
      // consumers a settings row that never existed.
      const wrote = previous !== undefined;
      if (wrote) {
        queryClient.setQueryData(
          userSettingsKey,
          mergeDefinedSettings(previous, body),
        );
      }
      return { previous, wrote };
    },
    onError: (_error, _body, context) => {
      if (!context?.wrote) return;
      queryClient.setQueryData(userSettingsKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userSettingsKey });
    },
  });
}
