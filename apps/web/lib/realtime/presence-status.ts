/**
 * How web paints a presence status. The status rules themselves (the Idle
 * threshold, reading a peer's entry, the labels) are shared with the phone and
 * live in `@repo/hooks/presence-status` (#3917); only the Tailwind classes
 * are web's.
 */

import type { PresenceStatus } from "@repo/hooks/presence-status";

/**
 * The dot treatment for a status — the colour decision, in a named mapper
 * rather than inline in JSX.
 *
 * This repo keeps one mapper per domain status vocabulary (`geofence-status.ts`,
 * `settings-status.ts`, and friends) because the shared invariant is that **no
 * domain status is ever painted in the chapter accent** — #1202 found five that
 * were, and the ones that had no mapper were the ones nobody could check.
 * Presence is a vocabulary like the rest, so its colours live here where
 * `presence-status.spec.ts` can assert the invariant over every arm.
 *
 * Idle is a ring rather than a fill, so Online and Idle differ in **shape** as
 * well as colour — `--success` and `--warning` are a green/amber pair, which is
 * the classic pair colour-vision deficiency collapses. The ring's interior is
 * `bg-card`, not `bg-transparent`: the dot sits on an avatar, and a transparent
 * interior lets the photo show through, so an amber-ish photo would make Idle
 * read as a filled dot — losing the shape distinction exactly when the colour
 * one is also weakest.
 *
 * DND (#3845) is a `--destructive` fill with a dark bar across it, which
 * `AvatarPresenceDot` draws as a child, so it differs from Online by shape as
 * well (red/green is the other pair colour-vision deficiency collapses).
 * Invisible is a grey ring, the Idle recipe in `--muted-foreground`, so it
 * reads apart from Offline's faint grey fill, and only the member themselves
 * ever sees it.
 */
export function presenceStatusKind(status: PresenceStatus): string {
  if (status === "online") return "bg-success";
  if (status === "idle") return "border-2 border-warning bg-card";
  if (status === "dnd") return "bg-destructive";
  if (status === "invisible") return "border-2 border-muted-foreground bg-card";
  return "bg-muted-foreground/40";
}
