import type { ThreadRow } from "@repo/chat-core/blocks";
import { replyPreviewText } from "@repo/chat-core/reply-preview";
import { resolveAuthorLabel } from "@repo/hooks";

/** The header's first line while there is no parent to name. */
export const THREAD_HEADER_FALLBACK_TITLE = "Thread";

export interface ThreadHeaderLines {
  /** The first line: the parent's words, or "Thread". */
  title: string;
  /** The second line: "Author · #channel", or the channel alone. */
  subtitle: string;
}

/**
 * What an open thread's header says on the phone (#4297, slice 5; option B
 * of the proposal, picked 2026-11-12): the parent's words, as Discord names a
 * thread by its first message, over who wrote it and where. The words are the
 * ones a quote of the parent shows (`replyPreviewText`): its text on one line,
 * a card's body, or "Attachment" for files alone. A parent with nothing to show by name, still
 * loading, deleted, or from someone the viewer blocked (drawn as a tombstone
 * or held), keeps "Thread" over the channel, and never names the blocked
 * member.
 */
export function threadHeaderLines({
  root,
  viewerId,
  nameFor,
  channelTitle,
}: {
  /** The parent as the screen draws it, after the block list. */
  root: ThreadRow | null;
  viewerId: string | null;
  nameFor: (userId: string) => string | null;
  channelTitle: string;
}): ThreadHeaderLines {
  if (!root || root.visibility !== "visible" || root.message.is_deleted) {
    return { title: THREAD_HEADER_FALLBACK_TITLE, subtitle: channelTitle };
  }
  const message = root.message;
  return {
    title: replyPreviewText(message),
    subtitle: `${resolveAuthorLabel(message, nameFor, viewerId)} · ${channelTitle}`,
  };
}
