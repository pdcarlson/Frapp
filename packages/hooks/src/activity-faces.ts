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

/** How many faces a task for everyone's row shows before "+N" (#5492). */
export const ACTIVITY_FACE_STACK_MAX = 3;

/**
 * Whom a task for everyone went to, as its row stacks them (#5492 on the
 * phone, #5538 on web; Paul, 2026-11-18: "a stack of faces and how many are
 * done"): up to three of the members the read previews (overdue first), then
 * "+N" for the rest, as Slack's and GitHub's avatar stacks count the others.
 * A member the roster no longer holds is left out and counted in `more`. No
 * faces at all draws no stack.
 */
export function activityFaceStack(
  ids: readonly string[],
  total: number,
  faceFor: (userId: string) => ActivityFace | null,
): { faces: { id: string; face: ActivityFace }[]; more: number } {
  const faces: { id: string; face: ActivityFace }[] = [];
  for (const id of ids) {
    if (faces.length === ACTIVITY_FACE_STACK_MAX) break;
    const face = faceFor(id);
    if (face) faces.push({ id, face });
  }
  return { faces, more: faces.length === 0 ? 0 : total - faces.length };
}
