import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CHAT_LINK_CHANNEL_PARAM,
  CHAT_LINK_MESSAGE_PARAM,
} from "@repo/validation";

/**
 * A message's link (#3723): `app.frapp.live/chat?channel=…&message=…`, the
 * address Copy message link copies. The app claims `/chat`
 * (`APP_LINK_PATHS`), so on a phone with the app the link lands here, and
 * this route hands it to the channel's thread, opened on the message
 * (`focusMessageId`), the way an Activity row opens one. It draws nothing of
 * its own.
 *
 * `replace`, not `push`, so going back from the thread doesn't stop on this
 * empty route. A link without both ids is not a message's link: it goes to
 * Chat home, as a `/chat` link on the web opens chat with nothing selected.
 */
export default function ChatLinkRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    [CHAT_LINK_CHANNEL_PARAM]?: string | string[];
    [CHAT_LINK_MESSAGE_PARAM]?: string | string[];
  }>();
  const channelId = firstParam(params[CHAT_LINK_CHANNEL_PARAM]);
  const messageId = firstParam(params[CHAT_LINK_MESSAGE_PARAM]);

  useEffect(() => {
    if (channelId && messageId) {
      router.replace({
        pathname: "/chat-thread",
        params: { channelId, focusMessageId: messageId },
      });
    } else if (channelId) {
      router.replace({ pathname: "/chat-thread", params: { channelId } });
    } else {
      router.dismissTo("/");
    }
  }, [channelId, messageId, router]);

  return null;
}

/** A route param's one value: a repeated query key arrives as an array. */
function firstParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
