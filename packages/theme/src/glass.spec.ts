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
});
