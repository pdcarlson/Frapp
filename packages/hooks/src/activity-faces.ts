import { useCallback } from "react";
import type { MemberAvatarTint } from "./member-avatar-color";
import { useMemberDisplayNames } from "./use-members";

/**
 * A member's face as an Activity row draws it (#4402, item 4): their photo,
 * else their initials on their tint, as chat draws an author. `name` is
 * `null` for a member on the roster who never set one; the row still shows
 * their photo, or "?" on their tint, as chat does.
 */
export interface ActivityFace {
  name: string | null;
  avatarUrl: string | null;
  tint: MemberAvatarTint;
}

/**
 * Resolves a row's `faceId` on the chapter roster chat already reads, so the
 * Activity read carries no avatars. `null` for an id the roster doesn't hold
 * (a member who has left): that row leads with its kind's glyph. One rule for
 * web and the phone.
 */
export function useActivityFaces(): (userId: string) => ActivityFace | null {
  const { byId, nameFor, avatarFor, avatarTintFor } = useMemberDisplayNames();
  return useCallback(
    (userId: string) =>
      byId[userId] !== undefined
        ? {
            name: nameFor(userId),
            avatarUrl: avatarFor(userId),
            tint: avatarTintFor(userId),
          }
        : null,
    [byId, nameFor, avatarFor, avatarTintFor],
  );
}
