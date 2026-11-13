import { Alert } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { isOpenableHref } from "@repo/chat-core/links";
import { PRODUCTION_APP_ORIGIN, parseMessageLink } from "@repo/validation";
import { webAppOrigin } from "@/lib/onboarding/chapter-wizard/invite-link";

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
 * A message's own link (Copy message link, #3723) opens that message here in
 * the app, on this build's dashboard origin or production's, rather than the
 * web chat in a browser sheet: Discord and Slack open their message links in
 * place too.
 */
export async function openMessageLink(href: string): Promise<void> {
  if (!isOpenableHref(href)) return;
  const message = parseMessageLink(href, [
    webAppOrigin(),
    PRODUCTION_APP_ORIGIN,
  ]);
  if (message) {
    router.push({
      pathname: "/chat-thread",
      params: {
        channelId: message.channelId,
        focusMessageId: message.messageId,
      },
    });
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
