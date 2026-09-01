/**
 * The web chat deep-link contract: `/chat?channel=<id>&message=<id>`.
 *
 * Three call sites build links into `/chat` — the notification drawer, the
 * command-palette search results, and `ChatPage`'s own param reader — and
 * they only work if they agree on the query-param names. This is the one
 * place that spelling lives, so a rename is a one-file change instead of a
 * silent three-way drift.
 */
export const CHAT_CHANNEL_PARAM = "channel";
export const CHAT_MESSAGE_PARAM = "message";

export interface ChatLinkTarget {
  channelId?: string | null;
  messageId?: string | null;
}

/**
 * Builds a `/chat` URL carrying whichever of `channelId` / `messageId` are
 * present. Neither is required — `chatDeepLink()` is a bare `/chat`, matching
 * every existing caller that has no target to carry.
 */
export function chatDeepLink(target: ChatLinkTarget = {}): string {
  const params = new URLSearchParams();
  if (target.channelId) params.set(CHAT_CHANNEL_PARAM, target.channelId);
  if (target.messageId) params.set(CHAT_MESSAGE_PARAM, target.messageId);
  const query = params.toString();
  return query ? `/chat?${query}` : "/chat";
}
