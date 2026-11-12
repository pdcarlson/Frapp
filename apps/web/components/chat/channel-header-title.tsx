import { ChannelMark, type ChannelStartChannel } from "./channel-start";

/**
 * The left of the thread's 48px channel header: the channel's mark, its name
 * and, when it has one, "• description" after it on the same line, the
 * description muted and cut off (owner's reference, 2026-11-05).
 *
 * Every item is centered on the row, never baseline-aligned
 * ([foundations.md](../../../../spec/ui/design-system/foundations.md) §7,
 * Aligning a row). The row used to be `items-baseline`, and the heading is a
 * flex box whose first item is the mark. When that mark is an icon (the lock
 * on private and role-gated channels, DMs, the audit channel), the browser has
 * no text baseline to read from it, so it takes the icon's bottom edge as the
 * heading's baseline and lines the description's baseline up with that. The
 * description dropped about 4px below the name on every one of those channels,
 * while `#` channels, whose mark is type, looked right (Paul, 2026-11-06).
 */
export function ChannelHeaderTitle({
  channel,
  name,
  description,
  placeholder = "Pick a channel",
}: {
  channel: Pick<ChannelStartChannel, "name" | "type"> | null;
  /** The title a member recognises: a DM's resolved name, not its stored id. */
  name: string;
  description: string | null;
  /** The title with nothing open: Direct messages asks for a conversation (#3774). */
  placeholder?: string;
}) {
  return (
    <div
      data-slot="channel-header-title"
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      {/*
        `h2`, under the top bar's `<h1>Chat</h1>` (`top-bar.tsx`). It was the
        route's `h1` while no title sat above it (#2141 to 2026-11-05). Styling
        is explicit, so the tag is visually free.

        `min-w-0`, and deliberately NOT `shrink-0`: the `truncate` on the name
        only bites if this flex item is allowed to shrink below its content.
        With `shrink-0` a long channel name simply overflows and paints under
        the `⋯` trigger beside it.

        `text-label` at its own weight (14/600), no `font-bold`: the same
        type as the open channel's row in the list beside it, never more
        (#3824, Paul 2026-11-09: the title read bigger than the channel names,
        and the issue sets the bar at "smaller than or equal"). Mobile's
        header steps up one role (title 18 over 16px rows) because it is the
        whole screen's title; on web the top bar's "Chat" holds that place.
      */}
      <h2 className="flex min-w-0 items-center gap-2 text-label text-foreground">
        {channel ? (
          <>
            <ChannelMark
              channel={channel}
              className="h-4 w-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{name}</span>
          </>
        ) : (
          placeholder
        )}
      </h2>
      {/* The dot is decoration: the name is the heading and the description its own paragraph. */}
      {description ? (
        <>
          <span
            aria-hidden="true"
            className="shrink-0 text-caption text-muted-foreground"
          >
            •
          </span>
          <p className="min-w-0 truncate text-caption text-muted-foreground">
            {description}
          </p>
        </>
      ) : null}
    </div>
  );
}
