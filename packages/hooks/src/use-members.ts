"use client";

import { useCallback, useMemo } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { OpsNudgeModuleKey } from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { resolveDisplayName, type DisplayNameMap } from "./display-names";

export function useMembers(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/**
 * The chapter roster projected to display fields only — `GET /v1/members/roster`.
 *
 * Prefer this over {@link useMembers} whenever the surface only needs a name or
 * an avatar. `useMembers` returns the full profile, including every member's
 * email, bio, graduation year, city and company, which a display concern has no
 * business putting on a device (#1000, #986).
 *
 * Keyed under `["members", chapterId, …]` so the existing member mutations,
 * which invalidate `["members", chapterId]`, prefix-match it — removing a member
 * drops them from the roster with no extra wiring.
 */
export function useChapterRoster() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, "roster"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/roster");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export interface MemberDisplayNames {
  /** `users.id` → `display_name`, for callers that resolve several ids at once. */
  byId: DisplayNameMap;
  /** Single-id resolver; `null` when unresolved so the caller picks its copy. */
  nameFor: (userId: string) => string | null;
  /**
   * True until the first roster read settles — and, because the read is
   * `enabled: !!chapterId`, true forever while there is no active chapter. A
   * surface that blocks rendering on this never renders for a chapterless
   * visitor; prefer degrading to {@link memberFallbackLabel} over waiting.
   */
  isPending: boolean;
  isError: boolean;
  /** Re-runs the roster read, so a caller's retry control can recover names. */
  refetch: () => void;
}

/**
 * Resolve `users.id` to a display name from one cached roster fetch.
 *
 * This is how the chat surface names message authors and DM rows. Both halves
 * are returned on purpose: `nameFor` is what a render path wants (one stable
 * callback, no per-row object churn), while `byId` is what
 * `directChannelDisplayName` wants, since it resolves a channel's whole
 * `member_ids` list.
 */
export function useMemberDisplayNames(): MemberDisplayNames {
  const query = useChapterRoster();

  // No `unknown`-parsing here, unlike the channel selectors: this route ships a
  // response DTO, so the SDK gives the rows a real type.
  const byId = useMemo<DisplayNameMap>(
    () =>
      Object.fromEntries(
        (query.data ?? []).map((row) => [row.user_id, row.display_name]),
      ),
    [query.data],
  );

  const nameFor = useCallback(
    (userId: string) => resolveDisplayName(byId, userId),
    [byId],
  );

  // Keyed on `query.refetch`, which TanStack keeps stable, rather than on
  // `query` — the observer hands back a fresh result object every render, so
  // depending on it would make this callback a new identity each time and defeat
  // memoization in any consumer that lists it as a dependency.
  const { refetch: runRefetch } = query;
  const refetch = useCallback(() => {
    void runRefetch();
  }, [runRefetch]);

  return {
    byId,
    nameFor,
    isPending: query.isPending,
    isError: query.isError,
    refetch,
  };
}

export function useMember(id: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!id,
  });
}

export function useMemberSearch(query: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, "search", query],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/search", {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!query,
  });
}

export function useAlumni(filters?: {
  graduation_year?: string;
  city?: string;
  company?: string;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["alumni", chapterId, filters],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/alumni", {
        params: { query: filters },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
    // Filters change the query key on every keystroke; keeping the previous
    // page's rows on screen until the new ones land avoids a full-list flash
    // to the loading skeleton for what's really a live-narrowing search.
    placeholderData: keepPreviousData,
  });
}

export function useUpdateMemberRoles() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async ({
      id,
      role_ids,
      custom_role_ids,
    }: {
      id: string;
      role_ids: string[];
      /** chapter_custom_roles ids; omit to leave the assignment unchanged. */
      custom_role_ids?: string[];
    }) => {
      const { data, error } = await client.PATCH("/v1/members/{id}/roles", {
        params: { path: { id } },
        body: {
          role_ids,
          ...(custom_role_ids !== undefined ? { custom_role_ids } : {}),
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}

export function useRemoveMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters", chapterId] });
    },
  });
}

export function useUpdateOnboarding() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: { has_completed_onboarding: boolean }) => {
      const { data, error } = await client.PATCH("/v1/members/me/onboarding", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      // The mobile first-run gate (and the web tutorial) read this flag off
      // `GET /v1/chapters`. Leaving that cache standing would re-send a member
      // who just finished s03 back to s03.
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
    },
  });
}

/**
 * Dismiss one ops-module setup nudge for the caller in the active chapter
 * (#492).
 *
 * Invalidates `["chapters"]` for the same reason `useUpdateOnboarding` does:
 * the dismissed set is read off the membership summary from `GET /v1/chapters`,
 * so leaving that cache standing would re-show the card the member just closed.
 * Not scoped to the active chapter id — the summary list is one cache entry
 * covering every membership, and the dismissal changed a row inside it.
 *
 * **`scope` is load-bearing, not decoration.** The server appends to
 * `members.dismissed_ops_nudges` read-modify-write, and dismissing one nudge
 * falls the next one through immediately — a fresh dismiss control lands under
 * the cursor in the same spot. Without a shared scope those two writes overlap,
 * each reads the pre-write array, and the later one erases the earlier key.
 * A shared scope id makes TanStack run them in series instead, so the second
 * read sees the first write.
 *
 * Chosen over disabling the control while `isPending`: mutations here retry
 * with backoff and pause outright while offline (`networkMode` is the default
 * `"online"`), so a disabled control would grey out the successor card for
 * ~12s on a flaky connection and indefinitely offline — a dead-end control,
 * which `spec/ui/design-system/README.md` bans.
 */
export function useDismissOpsNudge() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: "ops-nudge-dismiss" },
    mutationFn: async (body: { module_key: OpsNudgeModuleKey }) => {
      const { data, error } = await client.PATCH(
        "/v1/members/me/ops-nudges/dismiss",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
    },
  });
}
