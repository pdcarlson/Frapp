import { describe, expect, it } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { cubicBezierPoints } from "./motion-easing";

describe("cubicBezierPoints", () => {
  it("reads the exit curve's control points off the token", () => {
    expect(cubicBezierPoints("cubic-bezier(0.4, 0, 1, 1)")).toEqual([
      0.4, 0, 1, 1,
    ]);
  });

  it("parses every curve on the motion scale", () => {
    for (const curve of Object.values(signetDarkTokens.motion.easing)) {
      expect(cubicBezierPoints(curve)).toHaveLength(4);
    }
  });

  it("refuses anything that isn't a cubic-bezier", () => {
    expect(() => cubicBezierPoints("ease-in")).toThrow();
  });
});
