"use client";

import { type MouseEvent, type ReactNode } from "react";
import { useChannels } from "@repo/hooks";
import { asArray } from "@/lib/utils";

/**
 * Which channels in an answer this reader can open: the ones in their own
 * channel list. A channel they cannot open is drawn as the plain words it
 * was written as, so an answer never offers a link that leads nowhere.
 * Drawn only around an answer that names a channel, so no other answer
 * reads the list.
 */
export function AskChannelOpens({
  children,
}: {
  children: (canOpenChannel: (channelId: string) => boolean) => ReactNode;
}) {
  const channels = useChannels().data;
  return children((channelId) =>
    asArray<{ id: string }>(channels).some(
      (channel) => channel.id === channelId,
    ),
  );
}

/**
 * Runs on a click that follows the link here. A click that opens it in a new
 * tab or window leaves this page, and so the conversation, as it was.
 */
export function onPlainClick(run: (() => void) | undefined) {
  if (!run) return undefined;
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    run();
  };
}
