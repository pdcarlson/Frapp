import { throwUnlessOk } from "@repo/api-sdk";
import {
  can,
  channelTakesBackground,
  MAX_UPLOAD_LABEL,
  type ChatBackgroundKey,
} from "@repo/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { errorCopy } from "./error-copy";
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

/**
 * Who may set a channel's own background: `channels:manage` (the route's
 * guard), on a channel that takes one at all (`channelTakesBackground`, the
 * rule the API applies too). Web's channel menu and mobile's long-press menu
 * both read this. A photo also needs the setter's right to post there (its
 * announcing line), which the API checks on the save.
 */
export function canSetChannelBackground(
  channel: {
    type?: string | null;
    is_audit_log?: boolean | null;
    archived_at?: string | null;
  },
  permissions: readonly string[] | null | undefined,
): boolean {
  if (!channelTakesBackground(channel)) return false;
  return can("channels:manage", permissions);
}

/**
 * The photo half of a set: either the bytes (web, a DOM `File`), uploaded
 * here, or a path the caller already uploaded (mobile, which PUTs a
 * `file://` URI with `FileSystem.uploadAsync` after minting the URL through
 * {@link useRequestChatBackgroundPhotoUrl}).
 */
export interface ChatBackgroundPhotoSource {
  photo?: ChatBackgroundPhotoInput;
  /** Wins over `photo` when both are given: the bytes are already there. */
  storagePath?: string;
}

/** Where a photo is for: a channel's own background, or the chapter default. */
export type ChatBackgroundPhotoScope = "channel" | "default";

const PHOTO_URL_ROUTE = {
  channel: "/v1/chat-backgrounds/channels/photo-url",
  default: "/v1/chat-backgrounds/default/photo-url",
} as const;

/**
 * Mint the signed upload URL for a background photo, for a caller that PUTs
 * the bytes itself (mobile). Returns `{ upload_url, storage_path }`.
 */
export function useRequestChatBackgroundPhotoUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["chat-backgrounds", "photo-url"],
    mutationFn: async ({
      scope,
      filename,
      contentType,
    }: {
      scope: ChatBackgroundPhotoScope;
      filename: string;
      contentType: string;
    }) => {
      const result = await client.POST(PHOTO_URL_ROUTE[scope], {
        body: { filename, content_type: contentType },
      });
      throwUnlessOk(result);
      return result.data!;
    },
  });
}

/**
 * What a member reads when a step of setting a background fails and the
 * failure itself says nothing more specific (a 5xx, or a refusal the copy map
 * doesn't know). Each names the step, so "Try again in a moment" never stands
 * in for a failure that has a reason (#4262).
 */
export const CHAT_BACKGROUND_FAILURE_COPY = {
  /** Minting the signed upload URL. */
  prepare: "Couldn't start the photo upload. Try again, or pick another photo.",
  /** Storage refused the PUT (any status but 413, which says "too large"). */
  upload: `The photo didn't upload. Pick a JPEG, PNG, GIF or WebP up to ${MAX_UPLOAD_LABEL} and try again.`,
  /** The photo is up; saving it as the background failed. */
  savePhoto:
    "The photo uploaded, but it couldn't be saved as the background. Try again.",
  /** Saving a built-in background, or clearing a channel's own. */
  save: "Couldn't save the background. Try again.",
} as const;

export type ChatBackgroundStep = Exclude<
  keyof typeof CHAT_BACKGROUND_FAILURE_COPY,
  "upload"
>;

const STEP = Symbol.for("frapp.chatBackgroundStep");

/**
 * Runs one step, marking a failure with the step it came from. The error
 * itself is rethrown untouched, so its status, code and request id still
 * reach the Sentry reporter and every caller's own `errorCopy` fallback
 * (mobile's included) still applies; web reads the mark through
 * {@link chatBackgroundErrorCopy}.
 */
async function step<T>(
  run: () => Promise<T>,
  name: ChatBackgroundStep,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error !== null && typeof error === "object" && !(STEP in error)) {
      try {
        Object.defineProperty(error, STEP, { value: name });
      } catch {
        // A frozen error keeps no mark; it reads with the plain fallback.
      }
    }
    throw error;
  }
}

/**
 * What a member reads for a failed background set: the failure's own reason
 * when it has one (no connection, a known refusal, a refused upload),
 * otherwise the sentence for the step that failed, never a bare "Try again
 * in a moment" (#4262).
 */
export function chatBackgroundErrorCopy(error: unknown): string {
  const marked =
    error !== null && typeof error === "object"
      ? (error as { [STEP]?: ChatBackgroundStep })[STEP]
      : undefined;
  return errorCopy(
    error,
    marked
      ? CHAT_BACKGROUND_FAILURE_COPY[marked]
      : CHAT_BACKGROUND_FAILURE_COPY.save,
  );
}

/** Upload `source.photo` when given; otherwise the caller's own path. */
async function resolvePhotoPath(
  client: ReturnType<typeof useFrappClient>,
  scope: ChatBackgroundPhotoScope,
  source: ChatBackgroundPhotoSource,
): Promise<string> {
  if (source.storagePath) return source.storagePath;
  const photo = source.photo;
  if (!photo) throw new Error("Pick a photo first.");
  const { upload_url, storage_path } = await step(async () => {
    const ticket = await client.POST(PHOTO_URL_ROUTE[scope], {
      body: { filename: photo.filename, content_type: photo.contentType },
    });
    throwUnlessOk(ticket);
    return ticket.data!;
  }, "prepare");
  await putSignedUpload({
    signedUrl: upload_url,
    body: photo.body,
    contentType: photo.contentType,
    describeRejection: () => CHAT_BACKGROUND_FAILURE_COPY.upload,
  });
  return storage_path;
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
      ...source
    }: {
      channelId: string;
      background: ChatBackgroundKey | null;
    } & ChatBackgroundPhotoSource) => {
      const storagePath =
        background === "photo"
          ? await resolvePhotoPath(client, "channel", source)
          : undefined;
      return step(
        async () => {
          const result = await client.PUT(
            "/v1/chat-backgrounds/channels/{id}",
            {
              params: { path: { id: channelId } },
              body: { background, storage_path: storagePath },
            },
          );
          throwUnlessOk(result);
          return result.data!;
        },
        background === "photo" ? "savePhoto" : "save",
      );
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
      ...source
    }: {
      background: ChatBackgroundKey;
    } & ChatBackgroundPhotoSource) => {
      const storagePath =
        background === "photo"
          ? await resolvePhotoPath(client, "default", source)
          : undefined;
      return step(
        async () => {
          const result = await client.PUT("/v1/chat-backgrounds/default", {
            body: { background, storage_path: storagePath },
          });
          throwUnlessOk(result);
          return result.data!;
        },
        background === "photo" ? "savePhoto" : "save",
      );
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
