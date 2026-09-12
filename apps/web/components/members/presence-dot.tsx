"use client";

import {
  presenceStatusKind,
  type PresenceStatus,
} from "@/lib/realtime/presence-status";

/**
 * The Online / Idle / Offline dot pinned to a member's avatar.
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
      className={`absolute bottom-0 right-0 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background ${presenceStatusKind(status)}`}
    />
  );
}
