import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { memberAvatarTint } from "@repo/hooks";
import {
  FACE_BADGE_NEUTRAL,
  FaceWithBadge,
} from "@/components/shared/face-with-badge";

/**
 * #4476: the one face-with-a-kind-badge the notifications popover and the
 * Activity page share, so both draw the badge from one recipe.
 */
describe("FaceWithBadge", () => {
  it("sizes the badge from the face: half of it, glyph at three fifths", () => {
    const { container } = render(
      <FaceWithBadge
        size={36}
        avatarUrl={null}
        name="Olive Officer"
        badge={<svg />}
        data-testid="face"
        badgeProps={{ "data-testid": "badge" }}
      />,
    );
    const face = container.querySelector<HTMLElement>("[data-testid=face]")!;
    const badge = container.querySelector<HTMLElement>("[data-testid=badge]")!;
    expect(face).toHaveAttribute("aria-hidden", "true");
    expect(face.style.width).toBe("36px");
    expect(badge.style.width).toBe("18px");
    expect(badge.style.getPropertyValue("--face-badge-glyph")).toBe("11px");
    // The class that hands that size to the glyph: callers pass a bare
    // `<svg>`, which without it draws at the browser's default size.
    expect(badge).toHaveClass("[&>svg]:size-[var(--face-badge-glyph)]");
    // The hairline recipe, 4px past the corner, neutral by default.
    expect(badge).toHaveClass(
      "border",
      "border-border",
      ...FACE_BADGE_NEUTRAL.split(" "),
    );
    expect([badge.style.right, badge.style.bottom]).toEqual(["-4px", "-4px"]);
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("draws a mark in a given tone, and the member's initials", () => {
    const { container } = render(
      <FaceWithBadge
        size={40}
        avatarUrl={null}
        name="Olive Officer"
        tint={memberAvatarTint("#8FA8FF")}
        tone="bg-success text-success-foreground"
        badge="+"
        badgeProps={{ "data-kind-badge": "join" }}
      />,
    );
    const badge = container.querySelector("[data-kind-badge=join]")!;
    expect(badge).toHaveTextContent("+");
    expect(badge).toHaveClass("bg-success");
    expect(badge).not.toHaveClass("bg-surface-1");
    expect(container).toHaveTextContent("OO");
  });
});
