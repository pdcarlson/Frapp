"use client";

import type { PresenceStatus } from "@repo/hooks/presence-status";
import { presenceStatusKind } from "@/lib/realtime/presence-status";

/**
 * The presence dot pinned to a member's avatar: Online, Idle, Do Not Disturb,
 * Invisible (the viewer's own, only) or Offline.
 *
 * `status: null` renders nothing — the honest answer before presence has
 * resolved and while the socket is suppressed. Offline is a claim about *that
 * member*, so it must never be shown as a stand-in for "we don't know yet".
 * Taking `null` here rather than at each call site keeps that rule in one place
 * instead of repeating a ternary at every avatar.
 *
 * The ring matches the surface behind it so the dot reads as its own token
 * rather than merging into the avatar's edge. That surface is `--background`:
 * the greenfield lane deleted the `<Card>` this avatar used to sit inside, so
 * the rows now sit directly on the page. The board draws the same fixed ring
 * against its own column fill (`4a`, `border:2px solid #1A1A1A` on a `#1A1A1A`
 * aside) rather than varying it per row state, so a hovered or selected row
 * keeps the resting ring here too — the dot is 10px and the tint under it moves
 * by one ladder step, which is the trade the board already makes.
 *
 * **The dot is always decorative, and the caller always carries the status.**
 * It used to be either, switched by a `decorative` prop: a dot in a
 * non-interactive container named itself (`role="img"`, so a screen reader
 * announced "Online"), and a dot inside an interactive ancestor did not,
 * because an `img`-role descendant contributes to the *button's* accessible
 * name — the table row and the card tile would have been named "Online Jane
 * Doe President 12 pts…" and would have silently renamed themselves whenever
 * presence changed.
 *
 * The greenfield Directory lane deleted both of those surfaces. The one caller
 * left is a row that **is** a button, so the self-naming branch had no call
 * site and no test, exercised by nothing at all. Kept, it would be a second
 * accessibility contract for this component that nothing upholds and nothing
 * checks. So the prop is gone and what remains is the rule: **whatever renders
 * this dot owns announcing the status.** Git history holds the labelled variant
 * if a non-interactive container ever needs one.
 */
export function AvatarPresenceDot({ status }: { status: PresenceStatus | null }) {
  if (!status) return null;
  return (
    <span
      aria-hidden="true"
      data-presence={status}
      className={`absolute bottom-0 right-0 ring-2 ring-background ${DOT_SHAPE} ${presenceStatusKind(status)}`}
    >
      <DndBar status={status} />
    </span>
  );
}

/**
 * The same dot standing alone, for a menu row that names a status (the
 * account menu's Status submenu, #3845): no avatar under it, so no ring.
 */
export function PresenceGlyph({ status }: { status: PresenceStatus }) {
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center">
      <span
        aria-hidden="true"
        data-presence={status}
        className={`${DOT_SHAPE} ${presenceStatusKind(status)}`}
      >
        <DndBar status={status} />
      </span>
    </span>
  );
}

const DOT_SHAPE =
  "inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full";

/**
 * Do Not Disturb's bar (#3845): a dark dash across the red fill, so DND
 * differs from Online by shape and not by hue alone. 6 by 2 on the 10px dot,
 * the proportion Discord and Slack draw. `--destructive-foreground` is the
 * dark text step paired with `--destructive`.
 */
function DndBar({ status }: { status: PresenceStatus }) {
  if (status !== "dnd") return null;
  return (
    <span className="block h-0.5 w-1.5 rounded-full bg-destructive-foreground" />
  );
}

/**
 * A member's custom status line (#3845): one muted line under their name,
 * truncated to the row. Renders nothing without one, so a row without a line
 * keeps its height.
 */
export function CustomStatusLine({
  line,
  className,
}: {
  line: string | null;
  className?: string;
}) {
  if (!line) return null;
  return (
    <span
      data-custom-status=""
      className={`block min-w-0 truncate text-caption text-muted-foreground ${className ?? ""}`}
    >
      {line}
    </span>
  );
}
