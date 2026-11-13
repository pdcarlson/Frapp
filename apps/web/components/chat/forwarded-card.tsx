"use client";

import {
  FORWARDED_LABEL,
  FORWARDED_ORIGINAL_DELETED,
  forwardedAttachmentLabel,
} from "@repo/chat-core/forwarded";
import type { ForwardedFrom } from "@repo/chat-core/types";
import { formatRelativeDayTime } from "@repo/formatting";
import { resolveAuthorLabel, useChannels } from "@repo/hooks";
import { isDirectChannel } from "@repo/validation";
import { cn } from "@/lib/utils";
import { MessageGifImage } from "./message-gif";
import { MessageMarkdown } from "./renderers/message-markdown";

/** A forward's copy marks no `@` token: its mentions pinged nobody here. */
const NO_CHIPS = () => false;

export interface ForwardedCardProps {
  forwarded: ForwardedFrom;
  /**
   * The placeholder for a copy the viewer's block list hides
   * (`hiddenForwardedText` in `@repo/chat-core/blocks`). When set, nothing the
   * original's author wrote is drawn: no name, text, GIF or file count.
   */
  hidden: string | null;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  className?: string;
}

/**
 * The name of the channel the original lives in, only when the viewer's own
 * channel list holds it and it is a channel rather than a conversation. The
 * copy never carries a name, so a private channel's name can't reach someone
 * outside it (#4864).
 */
function useSourceChannelName(channelId: string | null): string | null {
  const { data } = useChannels();
  if (!channelId || !Array.isArray(data)) return null;
  const channel = (
    data as ReadonlyArray<{ id?: string; name?: string; type?: string }>
  ).find((row) => row.id === channelId);
  if (!channel?.name || isDirectChannel({ type: channel.type ?? "" })) {
    return null;
  }
  return channel.name;
}

/**
 * A forwarded message's card (#4864): "Forwarded", then the original's
 * author, when it was sent and (where the viewer can see it) its channel,
 * then its text through the body's own markdown renderer, its GIF, and how
 * many files it carried. The files stay with the original, so the card
 * counts them rather than offering them.
 *
 * The same `--popover` block a reply's quote draws (`QuotedMessage`), with a
 * left rule, so it reads as someone else's words carried into this row.
 */
export function ForwardedCard({
  forwarded,
  hidden,
  nameFor,
  viewerId,
  className,
}: ForwardedCardProps) {
  const channelName = useSourceChannelName(
    hidden ? null : forwarded.channel_id,
  );
  const placeholder = forwarded.deleted ? FORWARDED_ORIGINAL_DELETED : hidden;
  const author = resolveAuthorLabel(forwarded, nameFor, viewerId);
  const when = formatRelativeDayTime(forwarded.created_at);
  const files = forwardedAttachmentLabel(forwarded.attachment_count);
  const text = forwarded.content.trim().length > 0 ? forwarded.content : null;

  return (
    <div
      data-slot="forwarded-card"
      className={cn(
        "mt-1 min-w-0 max-w-full rounded-xs border-l-2 border-border bg-popover px-3 py-1.5",
        className,
      )}
    >
      <div className="text-caption font-semibold text-muted-foreground">
        {FORWARDED_LABEL}
      </div>
      {placeholder !== null ? (
        <div
          data-slot="forwarded-placeholder"
          className="text-caption italic text-muted-foreground"
        >
          {placeholder}
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 leading-5">
            <span className="min-w-0 truncate text-label text-foreground">
              {author}
            </span>
            {when ? (
              <time
                dateTime={forwarded.created_at}
                className="shrink-0 text-caption text-muted-foreground"
              >
                {when}
              </time>
            ) : null}
            {channelName ? (
              <span className="min-w-0 truncate text-caption text-muted-foreground">
                · in #{channelName}
              </span>
            ) : null}
          </div>
          {text ? (
            <div
              data-slot="forwarded-body"
              className="whitespace-pre-wrap break-words text-base leading-[25px] text-foreground"
            >
              <MessageMarkdown content={text} chips={NO_CHIPS} />
            </div>
          ) : null}
          {forwarded.gif ? <MessageGifImage gif={forwarded.gif} /> : null}
          {files ? (
            <div className="mt-0.5 text-caption text-muted-foreground">
              {files}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
