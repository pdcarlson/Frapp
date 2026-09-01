"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useChannels() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

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
export function useChannelUnreadCounts() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", "unread"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/unread");
      if (error) throw error;
      return (data ?? []) as ChannelUnreadCount[];
    },
    // Deliberately shorter than the 60s on `useChannels`: a badge that lags a
    // read is the most visible staleness in the app.
    staleTime: 15_000,
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

export function useMessages(
  channelId: string,
  options?: { limit?: number; before?: string },
) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", channelId, "messages", options],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}/messages", {
        params: { path: { id: channelId }, query: options },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!channelId,
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

export function useReactions(messageId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["messages", messageId, "reactions"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/channels/messages/{messageId}/reactions",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!messageId,
  });
}

export function useCategories() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", "categories"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/categories/list");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

/** Per-channel notification level. `off` is what the UI calls "muted". */
export type ChatNotificationLevel = "all" | "mentions" | "off";

export interface ChannelNotificationPreference {
  channel_id: string;
  level: ChatNotificationLevel;
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
  return useQuery({
    // Deliberately NOT nested under ["channels"]. `useMarkChannelRead`
    // invalidates that whole prefix, and TanStack Query matches prefixes
    // non-exactly, so nesting made this endpoint refetch on every channel open
    // AND close — two extra round trips per channel switch, each one re-running
    // the accessible-channel predicate server-side. Mute state does not change
    // when a read receipt is written, so it should not be invalidated by one.
    queryKey: ["channel-notification-preferences"],
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
  });
}

export function useSetChannelNotificationLevel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
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
        queryKey: ["channel-notification-preferences"],
      });
    },
    // A failed write must not leave the control asserting a level the server
    // never stored. Re-reading is the honest recovery: the popover snaps back
    // to the real level instead of silently displaying the one that failed.
    // The caller still surfaces `isError` — this only repairs the displayed
    // state, it does not tell the member anything on its own.
    onError: () => {
      queryClient.invalidateQueries({
        queryKey: ["channel-notification-preferences"],
      });
    },
  });
}

export function useCreateChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      description?: string;
      type: "PUBLIC" | "PRIVATE" | "ROLE_GATED";
      required_permissions?: string[];
      category_id?: string;
      is_read_only: boolean;
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
        queryKey: ["channel-notification-preferences"],
      });
    },
  });
}

export function useUpdateChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        description?: string;
        required_permissions?: string[];
        /** `null` clears the channel back to uncategorized; `undefined` leaves it untouched. */
        category_id?: string | null;
        is_read_only?: boolean;
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
      // The effective-level response is a function of the channel SET and each
      // channel NAME (`defaultLevelFor` is name-keyed), so a create, rename or
      // delete can change it. Lifting the prefs key out of the ["channels"]
      // prefix removed the incidental coupling that used to cover this, so the
      // channel-set mutations name it explicitly. Message-level and
      // read-receipt mutations deliberately do NOT.
      queryClient.invalidateQueries({
        queryKey: ["channel-notification-preferences"],
      });
    },
  });
}

export function useDeleteChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
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
        queryKey: ["channel-notification-preferences"],
      });
    },
  });
}

export function useGetOrCreateDm() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
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
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["channels"],
          refetchType: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: ["channel-notification-preferences"],
        }),
      ]);
    },
  });
}

export function useCreateGroupDm() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { member_ids: string[]; name?: string }) => {
      const { data, error } = await client.POST("/v1/channels/group-dm", {
        body,
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
        queryKey: ["channel-notification-preferences"],
      });
    },
  });
}

export function useSendMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      channelId,
      body,
    }: {
      channelId: string;
      body: {
        client_message_id: string;
        content: string;
        kind?:
          | "text"
          | "event"
          | "task"
          | "poll"
          | "dues"
          | "points"
          | "hours"
          | "system_audit"
          | "loading"
          | "announcement";
        payload?: Record<string, never>;
        reply_to_id?: string;
        metadata?: Record<string, never>;
      };
    }) => {
      const { data, error } = await client.POST("/v1/channels/{id}/messages", {
        params: { path: { id: channelId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["channels", variables.channelId, "messages"],
      });
    },
  });
}

export function useEditMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      body,
    }: {
      messageId: string;
      body: { content: string };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/channels/messages/{messageId}",
        { params: { path: { messageId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useDeleteMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.DELETE(
        "/v1/channels/messages/{messageId}",
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

export function usePinMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.POST(
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

export function useUnpinMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
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

export function useToggleReaction() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      body,
    }: {
      messageId: string;
      body: { emoji: string };
    }) => {
      const { data, error } = await client.POST(
        "/v1/channels/messages/{messageId}/reactions",
        { params: { path: { messageId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["messages", variables.messageId, "reactions"],
      });
    },
  });
}

export function useMarkChannelRead() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST("/v1/channels/{id}/read", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useRequestChatUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { filename: string; content_type: string };
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
  download_url: string;
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
) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", channelId, "messages", messageId, "attachments"],
    enabled: enabled && !!channelId && !!messageId,
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
 * Signed URLs for imported-author avatars (#1231), batched across every
 * distinct `author_avatar_path` the caller passes — one request no matter
 * how many visible messages share an author. `ChatMessage.author_avatar_path`
 * is the same opaque, private-bucket path already riding on message rows the
 * caller fetched; this only turns it into something renderable.
 *
 * Returns a `path → signedUrl` map covering only the paths that resolved — a
 * path missing from the result (a message with no avatar, one the server
 * rejected as out of chapter, or a signing failure) has nothing to render, so
 * callers should fall back to initials rather than treat a miss as loading.
 */
export function useAuthorAvatars(paths: (string | null | undefined)[]) {
  const client = useFrappClient();
  const distinctPaths = useMemo(
    () => [...new Set(paths.filter((p): p is string => !!p))].sort(),
    [paths],
  );
  return useQuery({
    queryKey: ["channels", "avatars", distinctPaths],
    enabled: distinctPaths.length > 0,
    // Comfortably inside the API's signed-URL TTL, so a URL handed to the DOM
    // is still live when it renders.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await client.POST("/v1/channels/avatars", {
        body: { paths: distinctPaths },
      });
      if (error) throw error;
      return (data ?? {}) as Record<string, string>;
    },
  });
}

/**
 * Performs the PUT to a Supabase Storage signed URL returned by
 * `useRequestChatUploadUrl`. Wraps the raw `fetch` so every chat network
 * call stays inside `@repo/hooks` and benefits from TanStack Query's retry,
 * pending state, and error handling primitives.
 */
export function useUploadSignedUrl() {
  return useMutation({
    mutationFn: async ({
      signedUrl,
      file,
    }: {
      signedUrl: string;
      file: File;
    }) => {
      const res = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }
      return { status: res.status, contentType: file.type, size: file.size };
    },
  });
}

export function useCreateCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; display_order: number }) => {
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
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { name?: string; display_order?: number };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/channels/categories/{id}",
        { params: { path: { id } }, body },
      );
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

export function useDeleteCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
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
