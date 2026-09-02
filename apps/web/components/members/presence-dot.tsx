"use client";

import {
  presenceLabel,
  type PresenceStatus,
} from "@/lib/realtime/presence-status";

/**
 * The Online / Idle / Offline dot shown beside a member.
 *
 * Colour is not the only carrier. The dot has an accessible name
 * (`presenceLabel`) so a screen reader announces "Online" rather than nothing,
 * and Idle is a hollow ring while Online is filled — so the two remain
 * distinguishable without colour vision, which colour alone would not give
 * (`success` and `warning` are a green/amber pair).
 *
 * Rendered from semantic tokens (`bg-success`, `bg-warning`,
 * `bg-muted-foreground`) rather than literal palette steps, so it follows the
 * chapter theme like every other surface.
 */

const DOT_CLASS: Record<PresenceStatus, string> = {
  online: "bg-success",
  // Hollow: same hue as the token, but a ring rather than a fill, so Online and
  // Idle differ in shape as well as colour.
  idle: "border-2 border-warning bg-transparent",
  offline: "bg-muted-foreground/40",
};

export function PresenceDot({
  status,
  className = "",
}: {
  status: PresenceStatus;
  className?: string;
}) {
  const label = presenceLabel(status);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-presence={status}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[status]} ${className}`}
    />
  );
}

/**
 * The dot pinned to the bottom-right of an avatar.
 *
 * The ring matches the surface behind it so the dot reads as a separate token
 * rather than merging into the avatar edge, which is the usual failure when a
 * status dot overlaps a photo.
 */
export function AvatarPresenceDot({ status }: { status: PresenceStatus }) {
  return (
    <PresenceDot
      status={status}
      className="absolute bottom-0 right-0 ring-2 ring-card"
    />
  );
}
