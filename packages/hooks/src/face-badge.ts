/**
 * The measurements of the badge on a member's face (#4476,
 * `spec/ui/design-system/iconography.md` §6.2.5b), shared so web's and the
 * phone's `FaceWithBadge` draw one recipe: a disc half the face's diameter,
 * the glyph inside at three fifths of the disc. Units are the platform's (px
 * on web, pt on the phone).
 */
export function faceBadgeSize(faceSize: number): number {
  return Math.round(faceSize / 2);
}

export function faceBadgeGlyphSize(faceSize: number): number {
  return Math.round((faceBadgeSize(faceSize) * 3) / 5);
}

/** How far the disc sits past the face's lower right corner. */
export const FACE_BADGE_OFFSET = 4;
