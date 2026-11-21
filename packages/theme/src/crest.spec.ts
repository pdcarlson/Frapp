import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FRAPP_CREST_PATH, FRAPP_CREST_VIEW_BOX } from "./crest";

const source = readFileSync(
  fileURLToPath(
    new URL(
      "../../brand-assets/assets/signet-emblem-B-glyph.svg",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("the crest path", () => {
  it("is the locked emblem's own geometry", () => {
    const drawn = /<path[^>]*\sd="([^"]+)"/.exec(source)?.[1];
    expect(drawn).toBeDefined();
    expect(FRAPP_CREST_PATH).toBe(drawn?.replace(/\s+/g, " ").trim());
  });

  it("is framed by a box that holds every point of it", () => {
    const [left = 0, top = 0, width = 0, height = 0] =
      FRAPP_CREST_VIEW_BOX.split(" ").map(Number);
    // Every command in the source is absolute (M, C, Z), so the numbers are
    // x, y pairs.
    expect(/[a-z]/.test(FRAPP_CREST_PATH)).toBe(false);
    const numbers = (FRAPP_CREST_PATH.match(/-?\d+(?:\.\d+)?/g) ?? []).map(
      Number,
    );
    expect(numbers.length % 2).toBe(0);
    for (let index = 0; index < numbers.length; index += 2) {
      const x = numbers[index] ?? Number.NaN;
      const y = numbers[index + 1] ?? Number.NaN;
      expect(x).toBeGreaterThanOrEqual(left);
      expect(x).toBeLessThanOrEqual(left + width);
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(top + height);
    }
  });
});
