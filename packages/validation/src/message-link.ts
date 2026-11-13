import { PRODUCTION_APP_ORIGIN } from "./invite-token";

/**
 * A message's link (#3723): `https://app.frapp.live/chat?channel=…&message=…`.
 *
 * Copy message link on the phone's long-press sheet copies it, as Discord's
 * and Slack's do. The web's chat panel opens the shape (it is how a
 * notification or a search hit lands on a message), and the phone opens one
 * tapped inside a message in place (`apps/mobile/lib/chat/open-link.ts`) and
 * has a `/chat` route for it. The app doesn't claim `/chat` as a universal
 * link yet: iOS reads claimed paths from the web, and installed builds
 * without that route would open such a link on Chat home (#4869).
 *
 * The parameter names live here: the phone mints and reads the link, and the
 * web's `chatDeepLink` (`apps/web/lib/chat/chat-links.ts`), which builds the
 * dashboard's own relative `/chat` links, reads its names from here too.
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

/** What a `/chat` link names: a channel, and a message in it when it has one. */
export interface ChatLinkTarget {
  channelId: string;
  messageId: string | null;
}

/**
 * The channel, and message, a `/chat` link names, or `null` for any other
 * address: a link on one of `origins` (the caller's dashboard origin) to
 * `/chat` with a channel. A channel-only link is the web's channel Copy link.
 */
export function parseChatLink(
  href: string,
  origins: readonly string[] = [PRODUCTION_APP_ORIGIN],
): ChatLinkTarget | null {
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
  if (!channelId) return null;
  return { channelId, messageId: messageId || null };
}
