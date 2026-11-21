import { describe, expect, it } from "vitest";
import {
  FACE_BADGE_OFFSET,
  faceBadgeGlyphSize,
  faceBadgeSize,
} from "./face-badge";

/** #4476: the one badge recipe both clients' `FaceWithBadge` read. */
describe("face badge recipe", () => {
  it("is half the face, with the glyph at three fifths of the disc", () => {
    // Notifications' 36 face and Activity's 40 (iconography.md §6.2.5b).
    expect([faceBadgeSize(36), faceBadgeGlyphSize(36)]).toEqual([18, 11]);
    expect([faceBadgeSize(40), faceBadgeGlyphSize(40)]).toEqual([20, 12]);
  });

  it("sits 4 past the corner, clear of a 36 face's initials", () => {
    expect(FACE_BADGE_OFFSET).toBe(4);
  });
});
