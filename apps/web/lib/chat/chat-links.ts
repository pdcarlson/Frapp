import {
  CHAT_LINK_CHANNEL_PARAM,
  CHAT_LINK_MESSAGE_PARAM,
} from "@repo/validation";

/**
 * The web chat deep-link contract: `/chat?channel=<id>&message=<id>`.
 *
 * Three call sites build links into `/chat` — the notification drawer, the
 * command-palette search results, and `ChatPage`'s own param reader — and
 * they only work if they agree on the query-param names. This is the one
 * place that spelling lives, so a rename is a one-file change instead of a
 * silent three-way drift.
 */
// The names a message's link (`@repo/validation`'s `message-link.ts`, #3723)
// carries too, so a link copied on the phone lands here.
export const CHAT_CHANNEL_PARAM = CHAT_LINK_CHANNEL_PARAM;
export const CHAT_MESSAGE_PARAM = CHAT_LINK_MESSAGE_PARAM;
/**
 * Which list the chat panel opens on (#3774): `channels` or `direct`. The
 * nav's Direct messages row links to `/chat?view=direct` below the
 * side-by-side width. A link that names a channel needs no view: the panel
 * follows the channel's kind, so a notification for a DM opens on Direct
 * messages without knowing it is one.
 */
export const CHAT_VIEW_PARAM = "view";

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
