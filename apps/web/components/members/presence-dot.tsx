"use client";

import {
  presenceLabel,
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
 * rather than merging into the avatar's edge.
 *
 * **Accessibility is split by context.** A dot inside a non-interactive
 * container names itself, so a screen reader announces "Online". A dot inside
 * an interactive ancestor must not: an `img`-role descendant contributes to the
 * *button's* accessible name, so the card view's button would be named
 * "Online Jane Doe President 12 pts…" and would silently rename itself as
 * presence changed. There the dot is marked decorative and the caller carries
 * the status in the button's own `aria-label`, where it is deliberate and in a
 * fixed position.
 */
export function AvatarPresenceDot({
  status,
  decorative = false,
}: {
  status: PresenceStatus | null;
  decorative?: boolean;
}) {
  if (!status) return null;
  const label = presenceLabel(status);
  const shared = `absolute bottom-0 right-0 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-card ${presenceStatusKind(status)}`;

  if (decorative) {
    return <span aria-hidden="true" data-presence={status} className={shared} />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-presence={status}
      className={shared}
    />
  );
}
