"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { useChannels } from "@repo/hooks";
import { askEntityParts, type AskNamedEntity } from "@repo/validation";
import { MENTION_CHIP } from "@/components/chat/chip";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { asArray, cn } from "@/lib/utils";

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
    asArray<{ id: string }>(channels).some((channel) => channel.id === channelId),
  );
}

/**
 * A run of an answer's text with the people and channels it names drawn the
 * way chat draws a mention (#4904): the in-body mention chip
 * (`spec/ui/design-system/components.md` § In-body mention chip), which is
 * how Discord and Slack mark a name inside a sentence. Which names count is
 * the server's call (`askEntityParts`): a name that is not in `entities` is
 * ordinary text.
 *
 * A member is a highlight. A channel is also a link into that channel, when
 * the reader has it; `onFollow` lets a conversation drawn over the chat get
 * out of the way, as it does for a source that is a message.
 */
export function AskEntityText({
  text,
  entities,
  canOpenChannel,
  onFollow,
}: {
  text: string;
  entities: readonly AskNamedEntity[];
  canOpenChannel: (channelId: string) => boolean;
  onFollow?: () => void;
}) {
  return (
    <>
      {askEntityParts(text, entities).map((part, position) => {
        if (part.type === "text") {
          return <Fragment key={position}>{part.text}</Fragment>;
        }
        if (part.type === "member") {
          return (
            <mark key={position} className={MENTION_CHIP}>
              {part.text}
            </mark>
          );
        }
        if (!canOpenChannel(part.id)) {
          return <Fragment key={position}>{part.text}</Fragment>;
        }
        return (
          <Link
            key={position}
            href={chatDeepLink({ channelId: part.id })}
            onClick={onFollow}
            className={cn(
              MENTION_CHIP,
              "underline-offset-2 hover:underline",
              FOCUS_RING_OFFSET,
            )}
          >
            {part.text}
          </Link>
        );
      })}
    </>
  );
}
