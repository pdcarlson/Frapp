"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** Every write shares this key, so a write can tell whether another is still in flight. */
const CHAT_SIDEBAR_WRITE_KEY = ["chat-sidebar", "write"] as const;

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
 * Shared by every sidebar write: apply the change to the cache at once, then
 * take the server's answer as the truth.
 *
 * - The optimistic edit makes a tap on a header or a pin feel instant.
 * - On success the response is the whole arrangement, so it replaces the cache,
 *   unless another sidebar write is still in flight, whose optimistic edit this
 *   older answer would briefly undo. The last write to settle refreshes.
 * - On failure the cache is re-read rather than rolled back to a snapshot: a
 *   snapshot taken before a second write started would undo that one too. The
 *   caller still reports `isError` to the member.
 */
function useSidebarWrite<TVars>(
  request: (vars: TVars) => Promise<ChatSidebar>,
  optimistic: (current: ChatSidebar, vars: TVars) => ChatSidebar,
) {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: CHAT_SIDEBAR_WRITE_KEY,
    mutationFn: request,
    onMutate: async (vars) => {
      if (!chapterId) return;
      const key = chatSidebarKeys.chapter(chapterId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<ChatSidebar>(key, (current) =>
        current ? optimistic(current, vars) : current,
      );
    },
    onSuccess: (data) => {
      if (!chapterId) return;
      const key = chatSidebarKeys.chapter(chapterId);
      // This mutation still counts as in flight while its own callbacks run.
      if (queryClient.isMutating({ mutationKey: CHAT_SIDEBAR_WRITE_KEY }) > 1) {
        return;
      }
      queryClient.setQueryData(key, data);
    },
    onError: () => {
      if (!chapterId) return;
      void queryClient.invalidateQueries({
        queryKey: chatSidebarKeys.chapter(chapterId),
      });
    },
    onSettled: () => {
      if (!chapterId) return;
      if (queryClient.isMutating({ mutationKey: CHAT_SIDEBAR_WRITE_KEY }) > 1) {
        return;
      }
      // The last write to settle makes sure the cache ends on the server's
      // state, covering any answer skipped above.
      void queryClient.invalidateQueries({
        queryKey: chatSidebarKeys.chapter(chapterId),
      });
    },
  });
}

/** What a filter write sends: either filter, or both. */
export type SidebarFilterChange =
  | { unread_only: boolean; hide_muted?: boolean }
  | { unread_only?: boolean; hide_muted: boolean };

/** Switch one filter, or both. A filter left out keeps its stored value. */
export function useSetSidebarFilter() {
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
  );
}

/** Fold or unfold one section. */
export function useSetSidebarSectionCollapsed() {
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
  );
}

/** Pin or unpin one channel. */
export function useSetChannelPinned() {
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
  );
}
