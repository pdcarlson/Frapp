"use client";

import { throwUnlessOk } from "@repo/api-sdk";
import {
  can,
  isDirectChannel,
  type ChatChapterLevel,
  type ChatNotificationLevel,
} from "@repo/validation";

import { useEffect, useMemo, useRef } from "react";
import {
  keepPreviousData,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useChapterScope } from "./chapter-scope";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { putSignedUpload } from "./put-signed-upload";
import {
  invalidateNotificationLists,
  markChannelNotificationsReadInCache,
  refetchIfChannelNotificationsShown,
} from "./use-notifications";

/** The query key `useChannels` caches the channel list under. */
export const CHANNEL_LIST_KEY = ["channels"] as const;

export function useChannels(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const enabled = options?.enabled ?? true;
  // No chapter-scoped read without a chapter to scope it to (#4094).
  const scope = useChapterScope({ enabled });
  return useQuery({
    queryKey: CHANNEL_LIST_KEY,
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: enabled && scope === "chapter",
  });
}

/** The query key `useChannelUnreadCounts` caches under. */
export const CHANNEL_UNREAD_COUNTS_KEY = ["channels", "unread"] as const;

/** One row per channel the caller can read, zeros included. */
export interface ChannelUnreadCount {
  channel_id: string;
  unread_count: number;
  mention_count: number;
}

/**
 * Unread and mention counts for every readable channel.
 *
 * `spec/behavior/chat/README.md` § Read Receipts is explicit that clients MUST
 * NOT re-derive either number: the server excludes the viewer's own messages and
 * deleted ones, and treats "never opened" as all-unread, so a second local
 * definition would disagree on exactly those cases.
 *
 * This is the one chat operation whose response body is actually generated in
 * `@repo/api-sdk` (every other one infers as `never`), so it needs no cast.
 */
export function useChannelUnreadCounts(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const enabled = options?.enabled ?? true;
  // No chapter-scoped read without a chapter to scope it to (#4094).
  const scope = useChapterScope({ enabled });
  return useQuery({
    queryKey: CHANNEL_UNREAD_COUNTS_KEY,
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/unread");
      if (error) throw error;
      return (data ?? []) as ChannelUnreadCount[];
    },
    // Deliberately shorter than the 60s on `useChannels`: a badge that lags a
    // read is the most visible staleness in the app.
    staleTime: 15_000,
    enabled: enabled && scope === "chapter",
  });
}

/** The query key `useChannelLatestMessages` caches under. */
export const CHANNEL_LATEST_MESSAGES_KEY = ["channels", "latest"] as const;

/**
 * Each readable channel's latest message, for mobile Chat home's row
 * previews and times (`GET /v1/channels/latest`). A channel with no message
 * has no row. Draw the line with `channelPreviewLine` in
 * `@repo/chat-core/channel-preview`.
 *
 * Under the `["channels"]` prefix and on the unread counts' 15s staleness, so
 * a preview refreshes whenever its row's badge does: the same invalidations
 * (opening a channel marks it read) and the same refetch on focus.
 */
export function useChannelLatestMessages(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const enabled = options?.enabled ?? true;
  // No chapter-scoped read without a chapter to scope it to (#4094).
  const scope = useChapterScope({ enabled });
  return useQuery({
    queryKey: CHANNEL_LATEST_MESSAGES_KEY,
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/latest");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
    enabled: enabled && scope === "chapter",
  });
}

export function useChannel(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!id,
  });
}

export function usePinnedMessages(channelId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", channelId, "pins"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}/pins", {
        params: { path: { id: channelId } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!channelId,
  });
}

/**
 * Everyone who can read a channel, with their top role rank (#3536). Ids and
 * ranks only: the member list joins names, avatars and role colors from
 * `useMemberDisplayNames`'s roster and presence from the chapter presence
 * socket, both of which Chat already holds.
 *
 * Keyed under `["members", chapterId, …]`, not `["channels", …]`, on purpose.
 * Every member and role mutation invalidates the members prefix (a role grant
 * changes who reads a ROLE_GATED channel), while the channels prefix is
 * invalidated by every read receipt, so under it this chapter-wide read would
 * refetch twice on each channel switch. A channel edit names it explicitly
 * (`useUpdateChannel`).
 */
export function useChannelMembers(
  channelId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, "channel", channelId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}/members", {
        params: { path: { id: channelId as string } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!channelId && (options?.enabled ?? true),
  });
}

export function useCategories() {
  const client = useFrappClient();
  const scope = useChapterScope();
  return useQuery({
    queryKey: ["channels", "categories"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/categories/list");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: scope === "chapter",
  });
}

/** Per-channel notification level. `off` is what the UI calls "muted". */
export type { ChatNotificationLevel } from "@repo/validation";

export interface ChannelNotificationPreference {
  channel_id: string;
  level: ChatNotificationLevel;
  /**
   * The level comes from the member's chapter-wide chat level (#3840), so the
   * control can say "your default". Absent from a server older than #3840.
   */
  from_chapter_level?: boolean;
}

/**
 * Query key for the effective-level collection. Channel-set mutations
 * invalidate this prefix; `useMarkChannelRead` does not — nesting under
 * `["channels"]` used to refetch this collection on every channel open and
 * close. A fingerprint of the readable channel set is watched separately so a
 * list that grew or was renamed still gets a fresh response without changing
 * this key (a key change would drop cached rows and disable every mute
 * control until the new GET landed). See #1401.
 */
export const CHANNEL_NOTIFICATION_PREFERENCES_KEY = [
  "channel-notification-preferences",
] as const;

/**
 * Stable identity of the readable channel set, and of every channel field the
 * server reads to resolve a channel's default level.
 *
 * `id` covers Discord-imported (and future created) channels appearing in the
 * rail. The rest are `builtInChannelDefault`'s and `defaultLevelFor`'s inputs
 * (#2771): `name` and `type` (a rename to or from `general`, `announcements`
 * or `chapter-audit`), `is_read_only` (the announcements channel needs it),
 * and `default_notification_level` (an officer setting or clearing one). A
 * change to any of them changes a level this member has not set, so it has to
 * refetch. Order-independent so a refetch that shuffles the list does not look
 * like a set change.
 */
export function channelSetFingerprint(channels: unknown): string {
  if (!Array.isArray(channels) || channels.length === 0) return "";
  const parts: string[] = [];
  for (const row of channels) {
    if (row === null || typeof row !== "object") continue;
    const field = (key: string) => {
      const value = key in row ? (row as Record<string, unknown>)[key] : null;
      return typeof value === "string" || typeof value === "boolean"
        ? String(value)
        : "";
    };
    if (typeof (row as { id?: unknown }).id !== "string") continue;
    parts.push(
      ["id", "name", "type", "is_read_only", "default_notification_level"]
        .map(field)
        .join(":"),
    );
  }
  parts.sort();
  return parts.join("\n");
}

/**
 * The caller's own per-channel notification levels.
 *
 * Served as its own collection rather than a field on the channel payload, for
 * the same reason unread counts are: `channel-list.tsx` documents that an
 * `unread_count?` field once sat on the channel type "populated by future
 * unread tracking", nothing ever populated it, and the badge reading it could
 * never render. `muted` was the second field in exactly that state until this
 * hook existed.
 *
 * Only channels the caller can still read come back — a preference row outlives
 * access to its channel, so the server filters before returning.
 */
export function useChannelNotificationPreferences() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  // Same cache entry as the rail's `useChannels()` — one GET, two observers.
  const channelsQuery = useChannels();
  const scope = useChapterScope();
  const fingerprint = channelSetFingerprint(channelsQuery.data);
  const prevFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (
      channelsQuery.status !== "success" &&
      channelsQuery.status !== "error"
    ) {
      return;
    }
    // First settled list: seed the fingerprint. Invalidating here would
    // refetch prefs that are already in flight in parallel with channels.
    if (prevFingerprint.current === null) {
      prevFingerprint.current = fingerprint;
      return;
    }
    if (prevFingerprint.current === fingerprint) return;
    prevFingerprint.current = fingerprint;
    void queryClient.invalidateQueries({
      queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
    });
  }, [fingerprint, channelsQuery.status, queryClient]);

  return useQuery({
    // Deliberately NOT nested under ["channels"]. `useMarkChannelRead`
    // invalidates that whole prefix, and TanStack Query matches prefixes
    // non-exactly, so nesting made this endpoint refetch on every channel open
    // AND close — two extra round trips per channel switch, each one re-running
    // the accessible-channel predicate server-side. Mute state does not change
    // when a read receipt is written, so it should not be invalidated by one.
    queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/channels/notification-preferences",
      );
      if (error) throw error;
      return (data ?? []) as ChannelNotificationPreference[];
    },
    // Matches `useChannels`: mute state changes far less often than unread
    // counts, and a stale mute badge is not the visible defect a stale unread
    // badge is.
    staleTime: 60_000,
    enabled: scope === "chapter",
  });
}

export function useSetChannelNotificationLevel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "set-channel-notification-level"],
    mutationFn: async ({
      channelId,
      level,
    }: {
      channelId: string;
      level: ChatNotificationLevel;
    }) => {
      const { data, error } = await client.PUT(
        "/v1/channels/{id}/notification-preference",
        { params: { path: { id: channelId } }, body: { level } },
      );
      if (error) throw error;
      return data as ChannelNotificationPreference;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
      });
    },
    // A failed write must not leave the control asserting a level the server
    // never stored. Re-reading is the honest recovery: the popover snaps back
    // to the real level instead of silently displaying the one that failed.
    // The caller still surfaces `isError` — this only repairs the displayed
    // state, it does not tell the member anything on its own.
    onError: () => {
      queryClient.invalidateQueries({
        queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
      });
    },
  });
}

/**
 * The member's chapter-wide chat level (#3840), keyed by chapter: a write that
 * resolves after a chapter switch lands on its own chapter's entry, never on
 * the chapter now shown (`chapter-query-keys.ts` says why `clear()` is not
 * enough).
 */
export const chapterChatLevelKeys =
  createChapterQueryKeys("chapter-chat-level");

/**
 * The member's chapter-wide chat level (#3840): `all` (each channel at its own
 * default) or `mentions` ("Mentions and DMs only").
 */
export function useChapterChatLevel() {
  const client = useFrappClient();
  const scope = useChapterScope();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: chapterChatLevelKeys.chapter(chapterId ?? ""),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/channels/notification-preferences/chapter",
      );
      if (error) throw error;
      return (data as { level: ChatChapterLevel }).level;
    },
    staleTime: 60_000,
    enabled: scope === "chapter" && Boolean(chapterId),
  });
}

/**
 * Set it. The per-channel levels are refetched too, since every channel the
 * member has not set resolves through this.
 */
export function useSetChapterChatLevel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["channels", "set-chapter-chat-level"],
    mutationFn: async (level: ChatChapterLevel) => {
      // The chapter the write is for, captured before the request leaves.
      const forChapter = chapterId;
      const { data, error } = await client.PUT(
        "/v1/channels/notification-preferences/chapter",
        { body: { level } },
      );
      if (error) throw error;
      return { level: (data as { level: ChatChapterLevel }).level, forChapter };
    },
    onSuccess: ({ level, forChapter }) => {
      if (forChapter) {
        queryClient.setQueryData(
          chapterChatLevelKeys.chapter(forChapter),
          level,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
      });
    },
    // Re-read rather than keep showing a level the server never stored.
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: chapterChatLevelKeys.all,
      });
    },
  });
}

export function useCreateChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "create-channel"],
    mutationFn: async (body: {
      name: string;
      description?: string;
      type: "PUBLIC" | "PRIVATE" | "ROLE_GATED";
      category_id?: string;
      /**
       * Who can see and who can post (#3722): `null` is everyone (who can
       * post: everyone who can see it), a list names tiers and roles from
       * `useChannelAccessOptions`. Left out, the channel copies its
       * category's answer. A private channel takes neither.
       */
      who_can_see?: string[] | null;
      who_can_post?: string[] | null;
      /** Always formal from the start (#3787); false when absent. */
      display_locked?: boolean;
    }) => {
      const { data, error } = await client.POST("/v1/channels", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      // The effective-level response is a function of the channel SET and each
      // channel NAME (`defaultLevelFor` is name-keyed), so a create, rename or
      // delete can change it. Lifting the prefs key out of the ["channels"]
      // prefix removed the incidental coupling that used to cover this, so the
      // channel-set mutations name it explicitly. Message-level and
      // read-receipt mutations deliberately do NOT.
      queryClient.invalidateQueries({
        queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
      });
    },
  });
}

export function useUpdateChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["channels", "update-channel"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        description?: string;
        /** `null` clears the channel back to uncategorized; `undefined` leaves it untouched. */
        category_id?: string | null;
        /** Who can see and who can post (#3722); `undefined` leaves one alone. */
        who_can_see?: string[] | null;
        who_can_post?: string[] | null;
        /**
         * Copy both lists from the channel's category, so it matches and
         * follows the category again. Not with either list.
         */
        match_category_access?: boolean;
        /**
         * The officer-set default push level (#2771). `null` clears it back to
         * the built-in default; `undefined` leaves it untouched.
         */
        default_notification_level?: ChatNotificationLevel | null;
        /**
         * Make this the chapter's default channel (`true`), moving it off any
         * other, or leave the chapter with none (`false` on the current one).
         */
        is_default?: boolean;
        /**
         * Leave out of Activity (#3897): its sign-up links reach no one's
         * Activity page. Refused as `true` on a DM or group DM.
         */
        activity_excluded?: boolean;
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/channels/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      // `who_can_see` decides who reads the channel.
      queryClient.invalidateQueries({
        queryKey: ["members", chapterId, "channel"],
      });
      // The effective-level response is a function of the channel SET and each
      // channel NAME (`defaultLevelFor` is name-keyed), so a create, rename or
      // delete can change it. Lifting the prefs key out of the ["channels"]
      // prefix removed the incidental coupling that used to cover this, so the
      // channel-set mutations name it explicitly. Message-level and
      // read-receipt mutations deliberately do NOT.
      queryClient.invalidateQueries({
        queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
      });
    },
  });
}

/**
 * Sets or clears Always formal on a channel (#3787): every member sees it in
 * the formal display and can't pick another there. The channel's creator or
 * a `channels:manage` holder may set it; the server refuses anyone else and
 * any DM. `canSetChannelDisplayLock` is the client's half of that rule.
 */
export function useSetChannelDisplayLock() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "display-lock"],
    mutationFn: async ({ id, locked }: { id: string; locked: boolean }) => {
      const { data, error } = await client.PUT(
        "/v1/channels/{id}/display-lock",
        { params: { path: { id } }, body: { display_locked: locked } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHANNEL_LIST_KEY });
    },
  });
}

/**
 * Whether the caller may set Always formal on a channel, mirroring
 * `ChatService.setDisplayLock`: never on a DM or group DM; otherwise the
 * channel's creator, or anyone holding `channels:manage` (or `*`).
 */
export function canSetChannelDisplayLock(
  channel: { type?: string | null; created_by?: string | null },
  userId: string | null | undefined,
  permissions: readonly string[] | null | undefined,
): boolean {
  if (isDirectChannel({ type: channel.type ?? "" })) return false;
  if (userId && channel.created_by && channel.created_by === userId) {
    return true;
  }
  return can("channels:manage", permissions);
}

export function useDeleteChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "delete-channel"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/channels/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      // The effective-level response is a function of the channel SET and each
      // channel NAME (`defaultLevelFor` is name-keyed), so a create, rename or
      // delete can change it. Lifting the prefs key out of the ["channels"]
      // prefix removed the incidental coupling that used to cover this, so the
      // channel-set mutations name it explicitly. Message-level and
      // read-receipt mutations deliberately do NOT.
      queryClient.invalidateQueries({
        queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
      });
    },
  });
}

export interface GetOrCreateDmOptions {
  /**
   * Whether `mutateAsync` waits for the channel-list refetch below (default
   * `true`). A caller whose screen already observes `["channels"]` can pass
   * `false`, so it is answered as soon as the DM exists. Waiting has a cost on
   * mobile: under its `offlineFirst` query defaults, a refetch that fails
   * while the device goes offline pauses its retry until the app is online
   * and foregrounded again, and the mutation would stay pending with it.
   */
  awaitRefetch?: boolean;
}

export function useGetOrCreateDm({
  awaitRefetch = true,
}: GetOrCreateDmOptions = {}) {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "get-or-create-dm"],
    mutationFn: async (body: { member_id: string }) => {
      const { data, error } = await client.POST("/v1/channels/dm", { body });
      if (error) throw error;
      return data;
    },
    // Returning (not just starting) this promise makes mutateAsync's caller
    // wait for it: the member directory's "Message" action navigates to
    // /chat?channel=<id> right after this resolves, mounting a fresh
    // useChannels() observer there. Without awaiting, invalidateQueries'
    // default `refetchType: "active"` also silently no-ops here — the
    // directory route has no mounted ["channels"] observer to refetch — so
    // the new chat page would render the stale pre-DM channel list until a
    // later background refetch caught up. `refetchType: "all"` refetches the
    // cache entry regardless of whether anything currently observes it.
    onSuccess: () => {
      const refetched = Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["channels"],
          refetchType: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: CHANNEL_NOTIFICATION_PREFERENCES_KEY,
        }),
      ]);
      return awaitRefetch ? refetched : undefined;
    },
  });
}

/**
 * `POST /v1/channels/{id}/leave`: leave a Group DM, or hide a 1:1 DM from the
 * caller's own list (#2303, `spec/behavior/chat/README.md` § Direct Messages).
 * The server decides which by the channel's type.
 *
 * A hidden DM is not dropped from `GET /v1/channels`; it comes back flagged
 * `hidden`, and the list screens leave it out. So the effect lands through the
 * list refetch below, which `mutateAsync` waits for: a caller that resolves and
 * then re-renders the list must not render the row it just hid.
 */
export function useLeaveChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "leave-channel"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST("/v1/channels/{id}/leave", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    // `["channels"]` is a prefix, so this also refetches the unread counts,
    // which a hide changes: it marks the thread read, and clears the chat
    // notifications about it (#3788), so the inbox refetches when it shows one.
    onSuccess: (_data, id) => {
      refetchIfChannelNotificationsShown(queryClient, id);
      return queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useUnpinMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "unpin-message"],
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.DELETE(
        "/v1/channels/messages/{messageId}/pin",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/**
 * Identifies `useMarkChannelRead` (#3393), so a client can give it its own
 * defaults. Mobile retries it once through a resume-time socket drop (#3747,
 * `apps/mobile/lib/query-client.ts`): it stamps the read cursor to the API
 * server's clock, so a replay is harmless.
 *
 * The key is also the Sentry grouping root for its failures
 * (`@repo/observability`'s `query-errors.ts`), on web and mobile: they group
 * under `channels` now, not `unkeyed`. The unkeyed issues that likely
 * reported them before (FRAPP-MOBILE-F, J, unkeyed mutations from chat-thread
 * opening) going quiet therefore says nothing either way.
 */
export const markChannelReadMutationKey = ["channels", "read"] as const;

export function useMarkChannelRead() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: markChannelReadMutationKey,
    mutationFn: async (id: string) => {
      const result = await client.POST("/v1/channels/{id}/read", {
        params: { path: { id } },
      });
      // On the status, not `error` (see `throwUnlessOk`): an empty-bodied 5xx
      // has no `error` and would read as a stamp that landed, and a non-JSON
      // 4xx would carry no status, so the retry above it couldn't tell a
      // refusal from a dropped connection.
      throwUnlessOk(result);
      return result.data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      // The read also cleared this channel's chat notifications on the server
      // (#3788). Mirror that in the inbox's cache, and refetch it only when it
      // was showing one, so a busy channel's reads don't each cost a list GET.
      if (markChannelNotificationsReadInCache(queryClient, id)) {
        void invalidateNotificationLists(queryClient);
      }
    },
  });
}

/**
 * Mint a signed upload URL for a chat attachment.
 *
 * `size_bytes` is optional on the wire and optional here, but supply it when
 * you know it: the API's 25 MB check only runs when it is present, so omitting
 * it trades a readable 400 from our own DTO for whatever Supabase Storage
 * returns when the PUT exceeds the bucket's `file_size_limit` — a raw,
 * non-JSON body a client cannot render to a member. Read
 * `@repo/validation`'s `upload-allowlists.ts` header before assuming the two
 * ceilings are the same number; the hosted per-object limit is deliberately
 * not claimed there.
 */
export function useRequestChatUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["channels", "request-chat-upload-url"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        filename: string;
        content_type: string;
        size_bytes?: number;
        with_preview?: boolean;
      };
    }) => {
      const { data, error } = await client.POST(
        "/v1/channels/{id}/upload-url",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
  });
}

/** An attachment plus the short-lived signed URL that downloads it. */
export interface MessageAttachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  /** ThumbHash, base64: draw it (`thumbhash` package) until the photo loads. */
  thumbhash?: string | null;
  download_url: string;
  /**
   * Signed URL of the photo's smaller copy, for the timeline; open
   * `download_url` full screen. Null or absent: draw `download_url`.
   */
  preview_url?: string | null;
}

/**
 * Attachments on one message, each with a signed download URL.
 *
 * Fetched on demand rather than embedded in the message list, because the URLs
 * expire — minting them into a cache that `staleTime: Infinity` never refreshes
 * would hand out links that are dead by the time anyone clicks. `staleTime` is
 * therefore well inside the server's one-hour TTL.
 *
 * Gated on `enabled` so the common case — a message with no attachments — costs
 * no request at all. Callers pass `message.attachment_count > 0`.
 */
export function useMessageAttachments(
  channelId: string,
  messageId: string,
  enabled: boolean,
  /**
   * `refetchOnMount: false` for an observer that joins a query another one
   * already reads, such as the chat image viewer joining its row's: every
   * refetch mints new signed URLs, so refetching on the join would swap the
   * image being opened for a fresh copy of itself.
   */
  options: { refetchOnMount?: boolean } = {},
) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", channelId, "messages", messageId, "attachments"],
    enabled: enabled && !!channelId && !!messageId,
    ...(options.refetchOnMount === false ? { refetchOnMount: false } : {}),
    // Comfortably inside the API's 3600s signed-URL TTL, so a link handed to the
    // DOM is still live when it is used.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/channels/{id}/messages/{messageId}/attachments",
        { params: { path: { id: channelId, messageId } } },
      );
      if (error) throw error;
      return (data ?? []) as MessageAttachment[];
    },
  });
}

/**
 * Server caps one `avatars` request at this many message ids
 * (`MAX_AUTHOR_AVATAR_PATHS_PER_REQUEST` in `chat.dto.ts`) — kept in sync by
 * hand since the two packages don't share a constants module.
 */
const AVATAR_REQUEST_CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Signed URLs for imported-author avatars (#1231), batched across every
 * distinct `author_avatar_path` among the given messages — one representative
 * message id per distinct path, so a channel with many messages from few
 * authors costs one small request rather than one per message.
 *
 * The server derives the avatar path set itself from `channelId` plus these
 * message ids rather than trusting a caller-supplied storage path (the
 * `chat-archive` bucket has no storage RLS, and an avatar path is otherwise
 * indistinguishable from another message's attachment path) — see
 * `ChatAttachmentService.resolveAuthorAvatars`. `ChatMessage.author_avatar_path` itself
 * never leaves the client in this call; it's only the lookup key used against
 * the result below.
 *
 * Requests are chunked at the server's per-call cap so a channel with more
 * distinct imported authors than that doesn't 400 the whole batch — chunks
 * merge into one `path → signedUrl` map. A path missing from the result (no
 * avatar, or a signing failure) has nothing to render, so callers should fall
 * back to initials rather than treat a miss as loading.
 *
 * Chunks are isolated from each other: one chunk's request failing does not
 * throw the other chunks' already-fetched avatars away. A channel with 120
 * distinct imported authors sends 3 chunked requests — a transient failure on
 * the third should degrade those 20 authors to initials, not all 120.
 *
 * A linked row (an imported message with a `sender_id`, #2878) is the member's
 * message, so it never draws the Discord avatar its snapshot still carries,
 * and its path is not signed. Unlinked rows sharing that path still are.
 */
export function useAuthorAvatars(
  channelId: string | undefined,
  messages: {
    id: string;
    sender_id?: string | null;
    author_avatar_path?: string | null;
  }[],
) {
  const client = useFrappClient();
  const messageIdsByDistinctPath = useMemo(() => {
    const seen = new Map<string, string>();
    for (const message of messages) {
      if (message.sender_id) continue;
      if (message.author_avatar_path && !seen.has(message.author_avatar_path)) {
        seen.set(message.author_avatar_path, message.id);
      }
    }
    return [...seen.values()].sort();
  }, [messages]);

  return useQuery({
    queryKey: ["channels", channelId, "avatars", messageIdsByDistinctPath],
    enabled: !!channelId && messageIdsByDistinctPath.length > 0,
    // The key grows as history pages in and new authors appear; keeping the
    // previous map while the larger one loads stops every avatar already on
    // screen dropping back to initials for a round-trip.
    placeholderData: keepPreviousData,
    // Comfortably inside the API's signed-URL TTL, so a URL handed to the DOM
    // is still live when it renders.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const chunks = chunk(messageIdsByDistinctPath, AVATAR_REQUEST_CHUNK_SIZE);
      const settled = await Promise.allSettled(
        chunks.map((ids) =>
          client.POST("/v1/channels/{id}/messages/avatars", {
            params: { path: { id: channelId! } },
            body: { message_ids: ids },
          }),
        ),
      );
      const result: Record<string, string> = {};
      for (const outcome of settled) {
        if (outcome.status !== "fulfilled" || outcome.value.error) continue;
        Object.assign(result, outcome.value.data ?? {});
      }
      return result;
    },
  });
}

/**
 * Performs the PUT to a Supabase Storage signed URL returned by
 * `useRequestChatUploadUrl`, through `putSignedUpload`, so the chat composer
 * gets TanStack Query's pending state and error handling on it.
 *
 * `contentType` is the type the upload URL was requested with, not
 * `file.type`: the browser leaves that empty for legacy Office files, and the
 * bucket rejects an empty type. No `x-upsert`: every chat upload gets a fresh
 * path, so there is never an object to overwrite.
 */
export function useUploadSignedUrl() {
  return useMutation({
    // Rooted at `storage`, not `channels`: the PUT goes to Supabase Storage,
    // not our API, so its 5xx is Storage's (Beta Watch reads it that way).
    mutationKey: ["storage", "upload-signed-url"],
    mutationFn: async ({
      signedUrl,
      file,
      contentType,
    }: {
      signedUrl: string;
      file: File;
      contentType: string;
    }) => {
      await putSignedUpload({ signedUrl, body: file, contentType });
      return { contentType, size: file.size };
    },
  });
}

export function useCreateCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "create-category"],
    mutationFn: async (body: {
      name: string;
      display_order: number;
      /** What a new channel in it copies (#3722); everyone when left out. */
      who_can_see?: string[] | null;
      who_can_post?: string[] | null;
    }) => {
      const { data, error } = await client.POST("/v1/channels/categories", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["channels", "categories"],
      });
    },
  });
}

export function useUpdateCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "update-category"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        display_order?: number;
        /**
         * Who can see and post (#3722). Every channel in the category that
         * matched it follows the change.
         */
        who_can_see?: string[] | null;
        who_can_post?: string[] | null;
      };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/channels/categories/{id}",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { body }) => {
      // A change to the lists moves the channels that matched the category,
      // so the whole channel family goes stale, not just the categories.
      queryClient.invalidateQueries({
        queryKey:
          body.who_can_see !== undefined || body.who_can_post !== undefined
            ? ["channels"]
            : ["channels", "categories"],
      });
    },
  });
}

export function useDeleteCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "delete-category"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE(
        "/v1/channels/categories/{id}",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["channels", "categories"],
      });
      // Deleting a category sets every channel that referenced it back to
      // uncategorized server-side (`ON DELETE SET NULL`). `["channels"]` is a
      // sibling key, not a descendant of `["channels", "categories"]`, so the
      // invalidation above alone leaves cached channel rows pointing at a
      // category id that no longer exists.
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

// ── Channel order (#4178) ───────────────────────────────────────────────────
//
// An officer drags a channel or a category heading in the web rail; every
// member then sees that order (`spec/behavior/chat/README.md` § Sidebar
// arrangement). Both writes show at once: the cache takes the new order before
// the request goes, goes back to what it held if the request fails, and is
// re-read once it settles, since the server also renumbers rows the officer
// can't see.

/** A cached channel row, as far as the order writes touch it. */
interface OrderableChannelRow {
  id: string;
  category_id?: string | null;
  display_order?: number | null;
}

/** A cached category row, as far as the order writes touch it. */
interface OrderableCategoryRow {
  id: string;
  display_order?: number;
}

const CATEGORY_LIST_KEY = ["channels", "categories"] as const;

/**
 * The channel list with `channelIds` filed under `categoryId` in that order.
 * Rows not listed are untouched. Exported for its spec.
 */
export function applyChannelOrder<R extends OrderableChannelRow>(
  rows: readonly R[],
  categoryId: string | null,
  channelIds: readonly string[],
): R[] {
  const position = new Map(channelIds.map((id, index) => [id, index]));
  return rows.map((row) => {
    const index = position.get(row.id);
    return index === undefined
      ? row
      : { ...row, category_id: categoryId, display_order: index };
  });
}

/**
 * The category list in `categoryIds` order, any category not listed after
 * them in its old order, as the server's RPC leaves it. Exported for its spec.
 */
export function applyCategoryOrder<R extends OrderableCategoryRow>(
  rows: readonly R[],
  categoryIds: readonly string[],
): R[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const listed = categoryIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  const listedIds = new Set(categoryIds);
  const rest = rows.filter((row) => !listedIds.has(row.id));
  return [...listed, ...rest].map((row, index) => ({
    ...row,
    display_order: index,
  }));
}

/** `PUT /v1/channels/order`: one section's channels, top to bottom. */
export function useReorderChannels() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "reorder"],
    mutationFn: async (body: {
      category_id: string | null;
      channel_ids: string[];
    }) => {
      const { data, error } = await client.PUT("/v1/channels/order", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({
        queryKey: CHANNEL_LIST_KEY,
        exact: true,
      });
      const previous = queryClient.getQueryData(CHANNEL_LIST_KEY);
      if (Array.isArray(previous)) {
        queryClient.setQueryData(
          CHANNEL_LIST_KEY,
          applyChannelOrder(
            previous as OrderableChannelRow[],
            body.category_id,
            body.channel_ids,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context && context.previous !== undefined) {
        queryClient.setQueryData(CHANNEL_LIST_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: CHANNEL_LIST_KEY,
        exact: true,
      });
    },
  });
}

/** `PUT /v1/channels/categories/order`: the chapter's categories, top to bottom. */
export function useReorderCategories() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["channels", "reorder-categories"],
    mutationFn: async (categoryIds: string[]) => {
      const { data, error } = await client.PUT(
        "/v1/channels/categories/order",
        { body: { category_ids: categoryIds } },
      );
      if (error) throw error;
      return data;
    },
    onMutate: async (categoryIds) => {
      await queryClient.cancelQueries({ queryKey: CATEGORY_LIST_KEY });
      const previous = queryClient.getQueryData(CATEGORY_LIST_KEY);
      if (Array.isArray(previous)) {
        queryClient.setQueryData(
          CATEGORY_LIST_KEY,
          applyCategoryOrder(previous as OrderableCategoryRow[], categoryIds),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context && context.previous !== undefined) {
        queryClient.setQueryData(CATEGORY_LIST_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORY_LIST_KEY });
    },
  });
}

// ── Bookmarks (#462) ────────────────────────────────────────────────────────
//
// Personal and private, per `spec/behavior/chat/README.md` § Bookmarks. The API
// derives the owner from the bearer token and never takes a user id, so there
// is nothing viewer-scoped for these hooks to pass — but the *cache* is still
// per-viewer-per-chapter data, so the key carries the chapter. An unscoped
// `["bookmarks"]` would serve the outgoing chapter's rows across a switch, the
// bug `chapter-query-keys.ts` exists to make untypeable.

// Built with the shared factory rather than hand-rolled. `chapter-query-keys.ts`
// exists precisely so a key missing its tenant scope cannot type-check, and its
// docblock is explicit: "Do not add `string | null` back. A hook that has no
// chapter yet should not build a key; it should leave the query `enabled:
// false`." The first draft here hand-rolled a `string | null` signature while
// citing that module — the exact drift it was written to prevent.
export const bookmarkKeys = createChapterQueryKeys("bookmarks");

/**
 * The viewer's own bookmarks in the active chapter, newest first, each with
 * its message.
 *
 * Deliberately one query rather than a per-message "is this bookmarked?" —
 * `useIsBookmarked` below derives that from this list, so the timeline renders
 * bookmark state for a whole page without a second round trip, and the popover
 * and the per-row toggle can never disagree about what is bookmarked.
 */
export function useBookmarks() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    // `chapterId!` is safe under `enabled` below: the factory refuses a null
    // chapter by design, and the query never runs without one.
    queryKey: bookmarkKeys.list(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/bookmarks");
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId,
  });
}

/**
 * Set of bookmarked message ids for the active chapter.
 *
 * Memoized on the query data so the timeline's per-row lookup is O(1) and does
 * not rebuild on every render.
 */
export function useBookmarkedMessageIds(): Set<string> {
  const { data } = useBookmarks();
  return useMemo(
    () => new Set((data ?? []).map((bookmark) => bookmark.message_id)),
    [data],
  );
}

export function useBookmarkMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["bookmarks", "bookmark-message"],
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.POST(
        "/v1/bookmarks/messages/{messageId}",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: bookmarkKeys.lists(chapterId!),
      });
    },
  });
}

export function useUnbookmarkMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["bookmarks", "unbookmark-message"],
    mutationFn: async (messageId: string) => {
      const { error } = await client.DELETE(
        "/v1/bookmarks/messages/{messageId}",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: bookmarkKeys.lists(chapterId!),
      });
    },
  });
}

/**
 * What a channel's or category's who-can-see and who-can-post lists can name
 * (#3722): the chapter's tiers, then its roles, each with the members it
 * reaches. Groups (#4076) arrive as another `kind`; the editor groups by
 * kind, so it shows them without a change here. Keyed under `roles` so a
 * role or tier edit, which invalidates that prefix, refreshes it.
 */
export function useChannelAccessOptions(enabled = true) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId, "channel-access-options"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/access-options");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: enabled && !!chapterId,
  });
}
