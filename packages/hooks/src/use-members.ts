"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import {
  roleColorOrNull,
  SYSTEM_SENDER_ID,
  type MemberDismissalKey,
} from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { resolveDisplayName, type DisplayNameMap } from "./display-names";
import { useViewerUserId } from "./use-user";
import {
  memberAvatarHue,
  memberAvatarTint,
  type MemberAvatarTint,
} from "./member-avatar-color";

/**
 * One member row as `GET /v1/members` and `GET /v1/members/search` serve it.
 *
 * An alias over the generated contract type rather than a hand-written shape,
 * because a restatement is a second answer to a question the contract already
 * answers. The two ways it went wrong here are worth keeping, because they are
 * different: six of the seven copies were *weaker* — `user_id` optional,
 * `display_name` nullable, where the DTO has both required and `display_name`
 * non-nullable — while the seventh matched the DTO field for field and had
 * simply *drifted*, transcribing fourteen of its fifteen required fields and
 * missing `custom_role_ids` (added after the copy was written). A narrowness
 * check would not have caught the second. Read the shape from
 * `apps/api/openapi.json`, which `check:api-contract` keeps honest.
 *
 * **Prefer {@link useChapterRoster} when a surface needs only a name or an
 * avatar.** This type is the *full* profile — email, bio, graduation year, city
 * and company — so taking it widens what a display-only screen can reach
 * (#1000, #986). Several consumers of this alias read `user_id` and
 * `display_name` and nothing else; their narrow local types used to say so, and
 * this one does not.
 *
 * `custom_fields` is on the DTO but present only on single-member reads — and
 * already filtered there to the fields the requesting viewer may see, server
 * side (`MemberService.findProfileById`). A list row never carries it.
 */
export type MemberProfile = components["schemas"]["MemberProfileDto"];

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

/**
 * Re-reads the roster when a surface is about to name a member it doesn't
 * hold, such as someone who joined after the roster loaded and is now typing
 * or posting (Paul, 2026-11-12). The roster is otherwise only re-read once it
 * is a minute stale *and* something remounts or refocuses, so a new joiner
 * read as `Member 2f4a1c` in the timeline and went unnamed on the typing line
 * for that long, which during the beta's onboarding is most of their first
 * conversation.
 *
 * Each missing id triggers at most one re-read per chapter, so a member who
 * really is gone (a removed member's old messages, an imported author) costs
 * one read, not a loop. The system sender is never looked up. Pass every id
 * the surface names: typists and message senders alike.
 */
export function useRosterCatchUp(
  userIds: readonly (string | null | undefined)[],
): void {
  const chapterId = useActiveChapterId();
  const { data, isFetching, refetch } = useChapterRoster();
  const tried = useRef<{ chapterId: string | null; ids: Set<string> }>({
    chapterId: null,
    ids: new Set(),
  });
  // A string, so a fresh array of the same ids each render reruns nothing.
  const wanted = useMemo(
    () =>
      [
        ...new Set(
          userIds.filter((id): id is string => !!id && id !== SYSTEM_SENDER_ID),
        ),
      ]
        .sort()
        .join(","),
    [userIds],
  );

  useEffect(() => {
    if (!data || isFetching || !wanted) return;
    if (tried.current.chapterId !== chapterId) {
      tried.current = { chapterId, ids: new Set() };
    }
    const known = new Set(data.map((row) => row.user_id));
    const missing = wanted
      .split(",")
      .filter((id) => !known.has(id) && !tried.current.ids.has(id));
    if (missing.length === 0) return;
    for (const id of missing) tried.current.ids.add(id);
    void refetch();
  }, [chapterId, data, isFetching, refetch, wanted]);
}

export interface MemberDisplayNames {
  /** `users.id` → `display_name`, for callers that resolve several ids at once. */
  byId: DisplayNameMap;
  /** Single-id resolver; `null` when unresolved so the caller picks its copy. */
  nameFor: (userId: string) => string | null;
  /**
   * The member's photo as a renderable (signed) URL, or `null` for initials.
   * Same roster read as `nameFor`, so a chat row needs no second request.
   */
  avatarFor: (userId: string) => string | null;
  /**
   * The palette color of the member's highest-ranked colored role, or `null`
   * for the plain foreground (#3485). Chat paints a sender's name in it. Same
   * roster read again, and re-checked against the palette here so a client
   * never paints a value the contrast guard did not cover.
   */
  roleColorFor: (userId: string) => string | null;
  /**
   * The paint for the member's initials avatar when they have no photo
   * (#3860): their {@link roleColorFor} color when their role colors their
   * name, so avatar and name match, otherwise their stable hashed hue.
   */
  avatarTintFor: (userId: string) => MemberAvatarTint;
  /**
   * True until the first roster read settles — and, because the read is
   * `enabled: !!chapterId`, true forever while there is no active chapter. A
   * surface that blocks rendering on this never renders for a chapterless
   * visitor; prefer degrading to {@link memberFallbackLabel} over waiting.
   */
  isPending: boolean;
  isError: boolean;
  /**
   * Whether a roster read has ever landed. TanStack keeps the last good data
   * through a failed refetch, so `isError` with `hasData` means stale names
   * that still draw, and a surface should keep them rather than swap in an
   * error (#3536).
   */
  hasData: boolean;
  /** A read is in flight, the first or a retry, for a Retry control's busy state. */
  isFetching: boolean;
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

  const avatarById = useMemo(
    () =>
      new Map(
        (query.data ?? []).map((row) => [row.user_id, row.avatar_url ?? null]),
      ),
    [query.data],
  );
  const avatarFor = useCallback(
    (userId: string) => avatarById.get(userId) ?? null,
    [avatarById],
  );

  const roleColorById = useMemo(
    () =>
      new Map(
        (query.data ?? []).map((row) => [
          row.user_id,
          roleColorOrNull(row.role_color),
        ]),
      ),
    [query.data],
  );
  const roleColorFor = useCallback(
    (userId: string) => roleColorById.get(userId) ?? null,
    [roleColorById],
  );

  const avatarTintFor = useCallback(
    (userId: string) =>
      memberAvatarTint(memberAvatarHue(userId, roleColorById.get(userId))),
    [roleColorById],
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
    avatarFor,
    roleColorFor,
    avatarTintFor,
    isPending: query.isPending,
    isError: query.isError,
    hasData: query.data !== undefined,
    isFetching: query.isFetching,
    refetch,
  };
}

/**
 * One member's full profile, by their `users.id` — the id chat carries on a
 * message's sender and its mentions — and the one profile read both clients'
 * member sheets use (web's since #3726, which retired the by-membership-id
 * hook). It also hands back the membership `id` a role edit needs. Keyed under
 * `["members", chapterId, …]` so a role edit's invalidation reaches it.
 */
export function useMemberByUserId(userId: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, "by-user", userId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/by-user/{userId}", {
        params: { path: { userId } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!userId,
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
    mutationKey: ["members", "update-member-roles"],
    mutationFn: async ({
      id,
      role_ids,
    }: {
      id: string;
      role_ids: string[];
    }) => {
      const { data, error } = await client.PATCH("/v1/members/{id}/roles", {
        params: { path: { id } },
        body: { role_ids },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      // Granting or revoking the Alumni role moves a member between the
      // directory's two tabs (#2484): Actives filters `GET /v1/members` on
      // `is_alumni`, Alumni is `GET /v1/alumni`. Refetching only the first
      // would drop a newly graduated member from Actives while the cached
      // Alumni list still lacks them, so for up to a minute they'd be on
      // neither tab.
      queryClient.invalidateQueries({ queryKey: ["alumni", chapterId] });
      // An officer editing their own roles can change what they may do, so
      // their permission list is re-read rather than kept for its stale time.
      queryClient.invalidateQueries({
        queryKey: ["user", "me", "permissions", chapterId],
      });
    },
  });
}

export function useRemoveMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["members", "remove-member"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      // A removed alumnus is gone from the Alumni tab too.
      queryClient.invalidateQueries({ queryKey: ["alumni", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters", chapterId] });
    },
  });
}

export function useUpdateOnboarding() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["members", "update-onboarding"],
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
 * Chosen over disabling the control while `isPending`. `query-provider.tsx`
 * retries a transient failure twice with `min(1000 * 2 ** attempt, 10_000)`,
 * so a disabled control would grey out the *successor* card — a different
 * nudge the member has not acted on — for ~3s of backoff across three
 * attempts, plus however
 * long each request itself takes. `scope` costs that nothing: the second write
 * simply queues, and its control stays pressable throughout.
 *
 * That reasoning originally leaned on offline pausing *indefinitely*, which is
 * no longer true: #1754 set `networkMode: "always"` so an offline mutation now
 * runs its retries and rejects in ~3s rather than parking until reconnect. The
 * conclusion survives its premise — a needlessly inert control is still worse
 * than a queued write — but the "forever" case is gone, so it is not claimed
 * here.
 *
 * One consequence of that same change is worth knowing at this call site: an
 * offline dismissal now **fails** instead of resuming on reconnect. `onError`
 * below is a deliberate no-op, so the card stays gone for the session and the
 * next `GET /v1/chapters` re-offers it. That is the documented behaviour for a
 * failed dismissal either way — the member closes it again — and #1754 accepts
 * the same trade repo-wide rather than keeping an accidental queue with no UI.
 */
export function useDismissOpsNudge() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["members", "dismiss-ops-nudge"],
    scope: { id: "ops-nudge-dismiss" },
    mutationFn: async (body: { module_key: MemberDismissalKey }) => {
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

/**
 * The viewer's own initials paint (#3860): the color the chapter sees on them,
 * for the surfaces that draw the viewer's own avatar (the account button, the
 * More tab's card, the profile page). `null` until the viewer's id is known.
 */
export function useOwnAvatarTint(): MemberAvatarTint | null {
  const viewerId = useViewerUserId();
  const { avatarTintFor } = useMemberDisplayNames();
  return viewerId ? avatarTintFor(viewerId) : null;
}
