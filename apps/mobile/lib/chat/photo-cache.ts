import { Image } from "expo-image";

/**
 * The disk-cache key of a chat photo (2026-11-07, step 3 of the photo work:
 * `spec/behavior/chat/README.md` § Photo previews).
 *
 * Chat files sit in a private bucket and are drawn from signed URLs, which
 * change on every fetch of a message's attachments. An image cache keyed by
 * URL therefore never hits: every scroll back up, and every reopen of a
 * channel, downloaded each photo again. The attachment's id names one stored
 * file that never changes (an edit or a re-send is a new row), so it is the
 * key, with which copy is meant, since a photo can have two.
 *
 * Keyed per attachment rather than per storage path on purpose: the path is
 * not on the wire, and two messages naming one object download it twice at
 * worst.
 */
export type ChatPhotoCopy = "preview" | "original";

export function chatPhotoCacheKey(
  attachmentId: string,
  copy: ChatPhotoCopy,
): string {
  return `chat-photo:${attachmentId}:${copy}`;
}

/**
 * Drop every cached chat photo, on disk and in memory, when the member signs
 * out or the account on the phone changes (`clearProductQueryCache`).
 *
 * A cached photo is a copy of a private chapter's chat sitting on the phone,
 * outside the app's session: the next account to sign in on a shared phone
 * must not be able to draw it, and nothing else would ever evict it.
 * expo-image holds only chat photos in this app, so its whole cache goes.
 * Best effort: a failed clear is not worth failing a sign-out over.
 */
export function forgetCachedChatPhotos(): void {
  void Promise.resolve()
    .then(() => Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]))
    .catch(() => undefined);
}
