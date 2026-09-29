"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import type { SidebarSectionKey } from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { createChapterQueryKeys } from "./chapter-query-keys";
import type { SidebarFilters } from "./channel-sidebar";

/**
 * The member's own sidebar arrangement (#2877), from `/v1/chat-sidebar`. The
 * rule is `spec/behavior/chat/README.md` § Sidebar arrangement.
 *
 * Chapter-scoped, because an arrangement is per member per chapter: an
 * unscoped key would show the outgoing chapter's pins across a switch.
 */
export const chatSidebarKeys = createChapterQueryKeys("chat-sidebar");

export type ChatSidebar = components["schemas"]["ChatSidebarDto"];

export function useChatSidebar() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    // `chapterId!` is safe under `enabled`: the query never runs without one.
    queryKey: chatSidebarKeys.chapter(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chat-sidebar");
      if (error) throw error;
      return data;
    },
    // It changes only when the member changes it, and every write replaces the
    // cached copy with the server's answer.
    staleTime: 5 * 60_000,
    enabled: !!chapterId,
  });
}

/** The arrangement in the shape `arrangeChannelSidebar` reads. */
export interface SidebarPreferences {
  pinnedIds: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  filters: SidebarFilters;
}

const NO_PREFERENCES: SidebarPreferences = {
  pinnedIds: new Set(),
  collapsed: new Set(),
  filters: { unreadOnly: false, hideMuted: false },
};

/**
 * The member's arrangement, or the defaults while it loads or if it failed.
 *
 * The defaults are the sidebar as it was before #2877: nothing pinned, nothing
 * folded, no filter. So a failed read costs the member their arrangement for
 * now and never hides a channel.
 */
export function useSidebarPreferences(): SidebarPreferences {
  const { data } = useChatSidebar();
  return useMemo(
    () =>
      data
        ? {
            pinnedIds: new Set(data.pinned_channel_ids),
            collapsed: new Set(data.collapsed_sections),
            filters: {
              unreadOnly: data.unread_only,
              hideMuted: data.hide_muted,
            },
          }
        : NO_PREFERENCES,
    [data],
  );
}

/**
 * Sidebar writes in flight, per query client and chapter, so a write can tell
 * whether another one overlapped it. Kept outside TanStack's mutation cache on
 * purpose: a chapter switch clears that cache while the old chapter's writes
 * are still running.
 */
const writesInFlight = new WeakMap<
  QueryClient,
  Map<string, { pending: number; overlapped: boolean }>
>();

function writeTracker(queryClient: QueryClient, chapterId: string) {
  let byChapter = writesInFlight.get(queryClient);
  if (!byChapter) {
    byChapter = new Map();
    writesInFlight.set(queryClient, byChapter);
  }
  let tracker = byChapter.get(chapterId);
  if (!tracker) {
    tracker = { pending: 0, overlapped: false };
    byChapter.set(chapterId, tracker);
  }
  return tracker;
}

/** Options every sidebar write hook takes. */
export interface SidebarWriteOptions {
  /**
   * Called on every failed write. A hook option rather than `mutate`'s
   * per-call `onError`, which TanStack fires only for the latest call on the
   * hook: a pin that failed while a second pin was in flight would otherwise
   * be dropped silently.
   */
  onError?: () => void;
}

/**
 * Shared by every sidebar write: apply the change to the cache at once, then
 * end on the server's state.
 *
 * - The optimistic edit makes a tap on a header or a pin feel instant.
 * - The chapter is captured when the write starts. TanStack pushes each
 *   render's options onto a write still in flight, so reading the chapter at
 *   settle time would file a write sent for one chapter under the next.
 * - A write that overlapped no other write for its chapter takes its own
 *   response as the cache: the response is the whole arrangement, so no
 *   refetch is needed.
 * - When writes overlap, no response is trusted. Their answers can arrive in
 *   a different order from the one the server applied them in, so any one of
 *   them may predate another's change. The last to settle re-reads the server
 *   instead, once.
 * - A failure re-reads the server too, rather than restoring a snapshot, which
 *   would undo a second write taken after it.
 */
function useSidebarWrite<TVars>(
  request: (vars: TVars) => Promise<ChatSidebar>,
  optimistic: (current: ChatSidebar, vars: TVars) => ChatSidebar,
  options: SidebarWriteOptions = {},
) {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: request,
    onMutate: async (vars) => {
      if (!chapterId) return undefined;
      const tracker = writeTracker(queryClient, chapterId);
      tracker.pending += 1;
      if (tracker.pending > 1) tracker.overlapped = true;
      const key = chatSidebarKeys.chapter(chapterId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<ChatSidebar>(key, (current) =>
        current ? optimistic(current, vars) : current,
      );
      return {
        chapterId,
        entry: queryClient.getQueryCache().find({ queryKey: key, exact: true }),
      };
    },
    onError: () => {
      options.onError?.();
    },
    onSettled: (data, error, _vars, context) => {
      if (!context) return;
      const tracker = writeTracker(queryClient, context.chapterId);
      tracker.pending -= 1;
      if (tracker.pending > 0) return;
      const key = chatSidebarKeys.chapter(context.chapterId);
      const overlapped = tracker.overlapped;
      tracker.overlapped = false;
      // Only into the cache entry this write started against. The key names
      // the chapter, not the member, and signing out or switching account
      // clears the cache: a write still in flight across that must not seed
      // the next member's sidebar for this chapter with the last member's
      // arrangement. A new entry is someone else's read; leave it alone.
      if (
        !context.entry ||
        queryClient.getQueryCache().find({ queryKey: key, exact: true }) !==
          context.entry
      ) {
        return;
      }
      if (!error && !overlapped && data) {
        queryClient.setQueryData(key, data);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** What a filter write sends: either filter, or both. */
export type SidebarFilterChange =
  | { unread_only: boolean; hide_muted?: boolean }
  | { unread_only?: boolean; hide_muted: boolean };

/** Switch one filter, or both. A filter left out keeps its stored value. */
export function useSetSidebarFilter(options?: SidebarWriteOptions) {
  const client = useFrappClient();
  return useSidebarWrite(
    async (change: SidebarFilterChange) => {
      const { data, error } = await client.PATCH("/v1/chat-sidebar", {
        body: change,
      });
      if (error) throw error;
      return data;
    },
    (current, change) => ({ ...current, ...change }),
    options,
  );
}

/** Fold or unfold one section. */
export function useSetSidebarSectionCollapsed(options?: SidebarWriteOptions) {
  const client = useFrappClient();
  return useSidebarWrite(
    async ({
      sectionKey,
      collapsed,
    }: {
      sectionKey: SidebarSectionKey;
      collapsed: boolean;
    }) => {
      const params = { params: { path: { sectionKey } } };
      const { data, error } = collapsed
        ? await client.PUT("/v1/chat-sidebar/collapsed/{sectionKey}", params)
        : await client.DELETE(
            "/v1/chat-sidebar/collapsed/{sectionKey}",
            params,
          );
      if (error) throw error;
      return data;
    },
    (current, { sectionKey, collapsed }) => ({
      ...current,
      collapsed_sections: collapsed
        ? current.collapsed_sections.includes(sectionKey)
          ? current.collapsed_sections
          : [...current.collapsed_sections, sectionKey]
        : current.collapsed_sections.filter((key) => key !== sectionKey),
    }),
    options,
  );
}

/** Pin or unpin one channel. */
export function useSetChannelPinned(options?: SidebarWriteOptions) {
  const client = useFrappClient();
  return useSidebarWrite(
    async ({ channelId, pinned }: { channelId: string; pinned: boolean }) => {
      const params = { params: { path: { channelId } } };
      const { data, error } = pinned
        ? await client.PUT("/v1/chat-sidebar/pins/{channelId}", params)
        : await client.DELETE("/v1/chat-sidebar/pins/{channelId}", params);
      if (error) throw error;
      return data;
    },
    (current, { channelId, pinned }) => ({
      ...current,
      pinned_channel_ids: pinned
        ? current.pinned_channel_ids.includes(channelId)
          ? current.pinned_channel_ids
          : [...current.pinned_channel_ids, channelId]
        : current.pinned_channel_ids.filter((id) => id !== channelId),
    }),
    options,
  );
}
