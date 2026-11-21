import { Alert } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { isOpenableHref } from "@repo/chat-core/links";
import { parseChatLink } from "@repo/validation";
import { webAppOrigin } from "@/lib/onboarding/chapter-wizard/invite-link";
import { openHref } from "@/lib/href";
import { currentPathname } from "@/lib/current-pathname";

/** The alert a link that would not open shows. */
export const LINK_OPEN_FAILED_TITLE = "Couldn't open that link";
export const LINK_OPEN_FAILED_BODY =
  "Check the address in the message, or copy it into your browser.";

/**
 * Opens a link a member tapped in a message (#2775).
 *
 * A web page opens in the in-app browser, the same way an attachment does, so
 * the member comes back to the thread with one swipe. A `mailto:` goes to the
 * OS, which hands it to the mail app. The href is re-checked here even though
 * `MessageMarkdown` only draws openable ones as links, because this is the call
 * that hands a member-typed string to the OS. A failure gets an alert: a tap that does
 * nothing reads as a dead link.
 *
 * With `chatLinksInApp`, a chat link (Copy message link's, or the web's
 * channel Copy link, #3723) opens its channel, on its message, here in the
 * app rather than the web chat in a browser sheet: Discord and Slack open
 * their message links in place too. Only a message body passes it: a
 * proof-link chip sits in a sheet, over which a pushed screen would open out
 * of sight, so its links keep the browser its label promises. Through
 * `openHref`, so a link tapped in an open channel replaces it rather than
 * stacking a second. Only this build's own dashboard origin
 * (`webAppOrigin`): on a staging build a production link names a channel the
 * staging API doesn't have, so it stays a web page.
 */
export async function openMessageLink(
  href: string,
  options: { chatLinksInApp?: boolean } = {},
): Promise<void> {
  if (!isOpenableHref(href)) return;
  const chat = options.chatLinksInApp
    ? parseChatLink(href, [webAppOrigin()])
    : null;
  if (chat) {
    openHref(
      router,
      {
        pathname: "/chat-thread",
        params: chat.messageId
          ? { channelId: chat.channelId, focusMessageId: chat.messageId }
          : { channelId: chat.channelId },
      },
      currentPathname(),
    );
    return;
  }
  try {
    if (href.toLowerCase().startsWith("mailto:")) {
      await Linking.openURL(href);
    } else {
      await WebBrowser.openBrowserAsync(href);
    }
  } catch {
    Alert.alert(LINK_OPEN_FAILED_TITLE, LINK_OPEN_FAILED_BODY);
  }
}
