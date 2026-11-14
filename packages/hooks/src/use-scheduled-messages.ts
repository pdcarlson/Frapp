import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { createChapterQueryKeys } from "./chapter-query-keys";

export type ScheduledMessage = components["schemas"]["ScheduledMessageDto"];

/**
 * The member's own scheduled messages (#4956), per chapter, since a list read
 * in one chapter must never answer in another.
 */
export const scheduledMessageKeys =
  createChapterQueryKeys("scheduled-messages");

/**
 * How often an open list re-reads, so a message the sweep just posted leaves
 * it. The sweep runs each minute.
 */
const REFETCH_MS = 60_000;

/** The member's pending and failed scheduled messages in one channel. */
export function useScheduledMessages(channelId: string | null | undefined) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: [...scheduledMessageKeys.list(chapterId!), channelId ?? ""],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/scheduled-messages", {
        params: { query: { channel_id: channelId! } },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && !!channelId,
    // Only while there is something to watch: most members have nothing
    // scheduled, and a row scheduled here invalidates the read itself.
    refetchInterval: (query) => (query.state.data?.length ? REFETCH_MS : false),
  });
}

function useInvalidateScheduled() {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return () =>
    queryClient.invalidateQueries({
      queryKey: scheduledMessageKeys.lists(chapterId!),
    });
}

/** A staged file as the schedule takes it (`MessageAttachmentDto`). */
export type ScheduledAttachmentInput =
  components["schemas"]["MessageAttachmentDto"];

export interface ScheduleMessageVariables {
  channelId: string;
  content: string;
  sendAt: Date;
  mentionPicks?: { user_id: string; label: string }[];
  /** Files already uploaded to the channel (#4971). */
  attachments?: ScheduledAttachmentInput[];
  /** The message it quotes, root-normalized as a live reply's (#4971). */
  replyToId?: string | null;
  /** The thread it posts into (#4971). */
  threadRootId?: string | null;
}

export function useScheduleMessage() {
  const client = useFrappClient();
  const invalidate = useInvalidateScheduled();
  return useMutation({
    mutationKey: ["scheduled-messages", "create"],
    mutationFn: async (vars: ScheduleMessageVariables) => {
      const { data, error } = await client.POST("/v1/scheduled-messages", {
        body: {
          channel_id: vars.channelId,
          content: vars.content,
          send_at: vars.sendAt.toISOString(),
          ...(vars.mentionPicks?.length
            ? { mention_picks: vars.mentionPicks }
            : {}),
          ...(vars.attachments?.length
            ? { attachments: vars.attachments }
            : {}),
          ...(vars.replyToId ? { reply_to_id: vars.replyToId } : {}),
          ...(vars.threadRootId ? { thread_root_id: vars.threadRootId } : {}),
        },
      });
      if (error) throw error;
      return data;
    },
    onSettled: invalidate,
  });
}

export interface UpdateScheduledMessageVariables {
  id: string;
  content?: string;
  sendAt?: Date;
  mentionPicks?: { user_id: string; label: string }[];
}

export function useUpdateScheduledMessage() {
  const client = useFrappClient();
  const invalidate = useInvalidateScheduled();
  return useMutation({
    mutationKey: ["scheduled-messages", "update"],
    mutationFn: async (vars: UpdateScheduledMessageVariables) => {
      const { data, error } = await client.PATCH(
        "/v1/scheduled-messages/{id}",
        {
          params: { path: { id: vars.id } },
          body: {
            ...(vars.content !== undefined ? { content: vars.content } : {}),
            ...(vars.sendAt ? { send_at: vars.sendAt.toISOString() } : {}),
            ...(vars.mentionPicks?.length
              ? { mention_picks: vars.mentionPicks }
              : {}),
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSettled: invalidate,
  });
}

export function useDeleteScheduledMessage() {
  const client = useFrappClient();
  const invalidate = useInvalidateScheduled();
  return useMutation({
    mutationKey: ["scheduled-messages", "delete"],
    mutationFn: async (id: string) => {
      const { error } = await client.DELETE("/v1/scheduled-messages/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    onSettled: invalidate,
  });
}

/**
 * Posts it now. The posted message reaches the timeline by Realtime, as any
 * other member's post does.
 */
export function useSendScheduledMessageNow() {
  const client = useFrappClient();
  const invalidate = useInvalidateScheduled();
  return useMutation({
    mutationKey: ["scheduled-messages", "send-now"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST(
        "/v1/scheduled-messages/{id}/send",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSettled: invalidate,
  });
}

/**
 * What a scheduled message carries besides its text (#4971), as its list row
 * says it: "Reply · 2 photos", "In a thread · 1 file". `null` for plain text.
 */
export function scheduledMessageExtras(
  row: Pick<ScheduledMessage, "attachments" | "reply_to_id" | "thread_root_id">,
): string | null {
  const parts: string[] = [];
  if (row.thread_root_id) parts.push("In a thread");
  else if (row.reply_to_id) parts.push("Reply");
  const photos = row.attachments.filter((file) =>
    file.content_type.startsWith("image/"),
  ).length;
  const files = row.attachments.length - photos;
  if (photos > 0) parts.push(photos === 1 ? "1 photo" : `${photos} photos`);
  if (files > 0) parts.push(files === 1 ? "1 file" : `${files} files`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
