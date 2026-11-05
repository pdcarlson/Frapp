"use client";

import Link from "next/link";
import {
  ADD_CHANNEL_DESCRIPTION_LABEL,
  EDIT_CHANNEL_LABEL,
  channelStartCopy,
  type ChannelStartType,
} from "@repo/hooks/channel-start";
import { isDirectChannel } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AuditGlyph, DirectMessageGlyph, LockGlyph } from "./chat-glyphs";

/** What the channel mark and the channel start read from a channel. */
export interface ChannelStartChannel {
  id: string;
  name: string;
  type: ChannelStartType;
  description?: string | null;
}

/**
 * Leading mark for a channel: in the header, and large in the channel start.
 *
 * A plain channel takes a **text `#`**, not a glyph: `canvas-screens.dc.html`
 * s04/s05 draw the sigil as type (17px / 700), and the reference wins over a
 * tidier all-icons row. Everything the reference does not draw (audit, direct,
 * private) takes its duotone intent glyph (`iconography.md` §2).
 */
export function ChannelMark({
  channel,
  className,
  hashClassName = "font-bold text-muted-foreground",
}: {
  channel: Pick<ChannelStartChannel, "name" | "type"> | null;
  className?: string;
  /** The `#` is type, so it is sized by font rather than by `className`. */
  hashClassName?: string;
}) {
  if (channel?.name === "chapter-audit")
    return <AuditGlyph className={className} />;
  if (channel && isDirectChannel(channel))
    return <DirectMessageGlyph className={className} />;
  if (channel?.type === "PRIVATE" || channel?.type === "ROLE_GATED")
    return <LockGlyph className={className} />;
  return (
    <span aria-hidden="true" className={hashClassName}>
      #
    </span>
  );
}

/**
 * The start of a channel's history (`writing.md` § Chat (dashboard), Channel start).
 *
 * Not an empty state. An empty channel draws this just above the composer,
 * where its first message will land, and a channel with history draws it
 * above the oldest message once the member has scrolled back that far. Copy
 * lives in `@repo/hooks/channel-start` so mobile says the same thing.
 *
 * `canEdit` is the viewer's `channels:manage`. It adds a shortcut into Chat
 * admin with this channel open, labelled for what is missing: a channel
 * without a description says "Add a description". Direct messages have no
 * admin page, so they never get one.
 */
export function ChannelStart({
  channel,
  displayName,
  canEdit = false,
  className,
}: {
  channel: ChannelStartChannel;
  /** The channel's name as the header shows it; a DM's is the other member. */
  displayName: string;
  canEdit?: boolean;
  className?: string;
}) {
  const copy = channelStartCopy({
    type: channel.type,
    name: displayName,
    description: channel.description,
  });
  const isDirect = isDirectChannel(channel);

  return (
    <section
      aria-label={copy.title}
      className={cn(
        "flex flex-col items-start gap-3 px-4 pb-4 pt-8",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-subtle text-accent-text"
      >
        <ChannelMark
          channel={channel}
          className="h-8 w-8"
          hashClassName="text-display font-bold leading-none"
        />
      </div>
      {/* `h3`: under the channel name's `h2` in the header, which sits under
          the top bar's `h1`. */}
      <h3 className="text-2xl font-bold text-foreground">{copy.title}</h3>
      <div className="flex max-w-prose flex-col gap-1 text-sm text-muted-foreground">
        <p>{copy.startLine}</p>
        {copy.description ? (
          <p className="text-foreground">{copy.description}</p>
        ) : null}
      </div>
      {canEdit && !isDirect ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/chat-admin?channel=${encodeURIComponent(channel.id)}`}>
            {copy.description
              ? EDIT_CHANNEL_LABEL
              : ADD_CHANNEL_DESCRIPTION_LABEL}
          </Link>
        </Button>
      ) : null}
    </section>
  );
}
