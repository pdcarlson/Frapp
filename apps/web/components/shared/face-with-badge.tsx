"use client";

import type { CSSProperties, ReactNode } from "react";
import type { MemberAvatarTint } from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";

/**
 * The badge's measurements, one recipe for every face that wears one
 * (`iconography.md` §6.2.5b, #4476): a disc half the face's size, the glyph
 * inside at three fifths of the disc, its edge 4px past the face's lower
 * corner, with a 1px `--border` hairline. The hairline, not a ring cut in the
 * ground's colour, so the disc reads on every ground a face sits on (the
 * page, a card, the notifications popover, a hovered row) without a halo.
 */
export function faceBadgeSize(faceSize: number): number {
  return Math.round(faceSize / 2);
}

export function faceBadgeGlyphSize(faceSize: number): number {
  return Math.round((faceBadgeSize(faceSize) * 3) / 5);
}

/** The neutral disc: the first surface step with the glyph muted. */
export const FACE_BADGE_NEUTRAL = "bg-surface-1 text-muted-foreground";

/**
 * A member's face (their photo, else their initials on their own tint) with a
 * small badge on its lower corner naming the kind of thing it leads, as
 * Slack's and Teams' Activity draw the actor. Shared by the notifications
 * popover and the Activity page (#4476); each keeps its own face size.
 *
 * Decoration: the row around it says the kind and the person in words.
 */
export function FaceWithBadge({
  size,
  avatarUrl,
  name,
  tint,
  badge,
  tone = FACE_BADGE_NEUTRAL,
  className,
  badgeProps,
  ...rest
}: {
  /** The face's diameter in px; the badge is sized from it. */
  size: number;
  avatarUrl: string | null | undefined;
  /** Whose face: read for the initials. */
  name: string | null | undefined;
  tint?: MemberAvatarTint | null;
  /**
   * The badge's content: a short mark ("@", "#") or a glyph, which the disc
   * sizes (`faceBadgeGlyphSize`) and colours (`currentColor`) itself.
   */
  badge: ReactNode;
  /** The disc's fill and ink, as classes; neutral unless the kind has a hue. */
  tone?: string;
  className?: string;
  /** Data attributes for the badge (a test id, the kind it names). */
  badgeProps?: Record<`data-${string}`, string>;
} & Record<`data-${string}`, string | undefined>) {
  const badgeSize = faceBadgeSize(size);
  const face: CSSProperties = { width: size, height: size };
  return (
    <span
      aria-hidden="true"
      className={cn("relative shrink-0", className)}
      style={face}
      {...rest}
    >
      <Avatar style={face}>
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback tint={tint}>{initials(name)}</AvatarFallback>
      </Avatar>
      <span
        {...badgeProps}
        className={cn(
          "absolute -bottom-1 -right-1 grid place-items-center rounded-full border border-border text-caption font-bold leading-none [&>svg]:size-[var(--face-badge-glyph)]",
          tone,
        )}
        style={
          {
            width: badgeSize,
            height: badgeSize,
            "--face-badge-glyph": `${faceBadgeGlyphSize(size)}px`,
          } as CSSProperties
        }
      >
        {badge}
      </span>
    </span>
  );
}
