import { PRODUCTION_APP_ORIGIN } from "./invite-token";

/**
 * A message's link (#3723): `https://app.frapp.live/chat?channel=…&message=…`.
 *
 * Copy message link on the phone's long-press sheet copies it, as Discord's
 * and Slack's do. The web's chat panel already opens the shape (it is how a
 * notification or a search hit lands on a message), and the app claims
 * `/chat` (`APP_LINK_PATHS`), so the same address opens the message in the
 * app on a phone that has it, and on the web anywhere else.
 *
 * One home for the shape, because both apps meet on it: the phone mints and
 * reads it, and the web's `chatDeepLink` (`apps/web/lib/chat/chat-links.ts`)
 * builds its in-app `/chat` links from the same parameter names.
 */

/** The path the app claims and the web serves. Listed in `APP_LINK_PATHS`. */
export const CHAT_LINK_PATH = "/chat";
export const CHAT_LINK_CHANNEL_PARAM = "channel";
export const CHAT_LINK_MESSAGE_PARAM = "message";

/** What a message link names. */
export interface MessageLinkTarget {
  channelId: string;
  messageId: string;
}

/** A message's link, on the dashboard origin the caller is built for. */
export function messageLinkUrl(
  origin: string,
  target: MessageLinkTarget,
): string {
  const base = origin.trim().replace(/\/+$/, "");
  return (
    `${base}${CHAT_LINK_PATH}` +
    `?${CHAT_LINK_CHANNEL_PARAM}=${encodeURIComponent(target.channelId)}` +
    `&${CHAT_LINK_MESSAGE_PARAM}=${encodeURIComponent(target.messageId)}`
  );
}

/**
 * The message a link names, or `null` for any other address: a link on
 * `origins` (the build's own dashboard origin, and production's, so a link
 * copied from a production build still opens in-app on any build) to
 * `/chat` with both a channel and a message.
 */
export function parseMessageLink(
  href: string,
  origins: readonly string[] = [PRODUCTION_APP_ORIGIN],
): MessageLinkTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const allowed = origins.map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  });
  if (!allowed.includes(url.origin)) return null;
  if (url.pathname.replace(/\/+$/, "") !== CHAT_LINK_PATH) return null;
  const channelId = url.searchParams.get(CHAT_LINK_CHANNEL_PARAM)?.trim();
  const messageId = url.searchParams.get(CHAT_LINK_MESSAGE_PARAM)?.trim();
  if (!channelId || !messageId) return null;
  return { channelId, messageId };
}
