import { throwUnlessOk } from "@repo/api-sdk";
import type { ChatBackgroundKey } from "@repo/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { putSignedUpload } from "./put-signed-upload";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Chat backgrounds (#3973): what to draw behind a channel's messages, and the
 * two settings that decide it: the chapter default and a channel's override.
 * Behavior: `spec/behavior/chat/README.md` § Chat backgrounds.
 */
export const chatBackgroundKeys = createChapterQueryKeys("chat-backgrounds");

/** A photo picked on the device, uploaded before the setting is saved. */
export interface ChatBackgroundPhotoInput {
  body: Blob;
  filename: string;
  contentType: string;
}

/** The resolved background for one channel (the channel's own, else the chapter default). */
export function useChatBackground(channelId: string | null | undefined) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: chatBackgroundKeys.detail(chapterId!, channelId ?? ""),
    queryFn: async () => {
      const result = await client.GET("/v1/chat-backgrounds/channels/{id}", {
        params: { path: { id: channelId! } },
      });
      throwUnlessOk(result);
      return result.data!;
    },
    // A background is decoration: it changes rarely, and a stale one for a
    // few minutes costs nothing. The signed photo URL lives for hours.
    staleTime: 5 * 60_000,
    enabled: !!chapterId && !!channelId,
  });
}

export function useChapterChatBackground() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: chatBackgroundKeys.detail(chapterId!, "default"),
    queryFn: async () => {
      const result = await client.GET("/v1/chat-backgrounds/default");
      throwUnlessOk(result);
      return result.data!;
    },
    staleTime: 5 * 60_000,
    enabled: !!chapterId,
  });
}

/** Set (or, with `background: null`, clear) a channel's own background. */
export function useSetChannelBackground() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["chat-backgrounds", "set-channel"],
    mutationFn: async ({
      channelId,
      background,
      photo,
    }: {
      channelId: string;
      background: ChatBackgroundKey | null;
      photo?: ChatBackgroundPhotoInput;
    }) => {
      let storagePath: string | undefined;
      if (background === "photo") {
        if (!photo) throw new Error("Pick a photo first.");
        const ticket = await client.POST(
          "/v1/chat-backgrounds/channels/photo-url",
          {
            body: { filename: photo.filename, content_type: photo.contentType },
          },
        );
        throwUnlessOk(ticket);
        const { upload_url, storage_path } = ticket.data!;
        await putSignedUpload({
          signedUrl: upload_url,
          body: photo.body,
          contentType: photo.contentType,
        });
        storagePath = storage_path;
      }
      const result = await client.PUT("/v1/chat-backgrounds/channels/{id}", {
        params: { path: { id: channelId } },
        body: { background, storage_path: storagePath },
      });
      throwUnlessOk(result);
      return result.data!;
    },
    onSuccess: () => {
      if (chapterId) {
        void queryClient.invalidateQueries({
          queryKey: chatBackgroundKeys.chapter(chapterId),
        });
      }
    },
  });
}

/** Set the chapter's default background; every channel without its own follows it. */
export function useSetChapterChatBackground() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["chat-backgrounds", "set-default"],
    mutationFn: async ({
      background,
      photo,
    }: {
      background: ChatBackgroundKey;
      photo?: ChatBackgroundPhotoInput;
    }) => {
      let storagePath: string | undefined;
      if (background === "photo") {
        if (!photo) throw new Error("Pick a photo first.");
        const ticket = await client.POST(
          "/v1/chat-backgrounds/default/photo-url",
          {
            body: { filename: photo.filename, content_type: photo.contentType },
          },
        );
        throwUnlessOk(ticket);
        const { upload_url, storage_path } = ticket.data!;
        await putSignedUpload({
          signedUrl: upload_url,
          body: photo.body,
          contentType: photo.contentType,
        });
        storagePath = storage_path;
      }
      const result = await client.PUT("/v1/chat-backgrounds/default", {
        body: { background, storage_path: storagePath },
      });
      throwUnlessOk(result);
      return result.data!;
    },
    onSuccess: () => {
      if (chapterId) {
        void queryClient.invalidateQueries({
          queryKey: chatBackgroundKeys.chapter(chapterId),
        });
      }
    },
  });
}
