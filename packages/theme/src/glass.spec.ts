import { describe, expect, it } from "vitest";
import { glassFill, signetGlass } from "./glass";
import { signetDarkTokens } from "./signet";

describe("glass", () => {
  it("fills from the ladder's nav step, not a hex of its own", () => {
    const fill = glassFill(
      signetDarkTokens.color.surface.surface1,
      signetGlass.fillAlpha,
    );
    expect(fill).toMatch(/^rgba\(\d+,\d+,\d+,0\.56\)$/);
  });

  it("keeps the unblurred fill near-solid and above the blurred one", () => {
    expect(signetGlass.unblurredFillAlpha).toBeGreaterThan(
      signetGlass.fillAlpha,
    );
    expect(signetGlass.unblurredFillAlpha).toBeGreaterThanOrEqual(0.9);
  });

  // #1640: the phone's `tint()` is this function, and a chapter accent read
  // from a `jsonb` palette can be anything.
  it.each([
    ["", "transparent"],
    ["not-a-color", "transparent"],
    ["#12345", "transparent"],
    // An 8-digit value is rejected, never truncated to its first six digits.
    ["#FF907F80", "transparent"],
    ["#fff", "rgba(255,255,255,0.5)"],
    ["#FF907F", "rgba(255,144,127,0.5)"],
    [" #ff907f ", "rgba(255,144,127,0.5)"],
  ])("fills %j as %s", (input, expected) => {
    expect(glassFill(input, 0.5)).toBe(expected);
  });
});
