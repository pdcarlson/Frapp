import { describe, expect, it } from "vitest";
import { placeTextItems, textOutsideBoxes } from "./text-layer";

/** A letter page's flip from PDF space (origin bottom-left) to top-left. */
const flip = (x: number, y: number) => [x, 792 - y];

describe("text layer", () => {
  it("places horizontal text in viewport space with its baseline", () => {
    const [placed] = placeTextItems(
      [{ str: "Jane Doe", transform: [12, 0, 0, 12, 120, 720], width: 50, height: 12 }],
      flip,
      0,
    );
    expect(placed!.upright).toEqual({ x: 120, baseline: 72, size: 12, width: 50 });
    expect(placed!.rect.x).toBe(120);
    expect(placed!.rect.width).toBe(50);
    // Spans above the baseline (smaller y) and a little below it.
    expect(placed!.rect.y).toBeLessThan(72 - 12);
    expect(placed!.rect.y + placed!.rect.height).toBeGreaterThan(72);
  });

  it("drops a word that only grazes a box, whole", () => {
    const placed = placeTextItems(
      [
        { str: "Jane Doe", transform: [12, 0, 0, 12, 120, 720], width: 50, height: 12 },
        { str: "Question 1", transform: [12, 0, 0, 12, 72, 600], width: 60, height: 12 },
      ],
      flip,
      0,
    );
    // The box covers only the last few points of "Jane Doe".
    const kept = textOutsideBoxes(placed, [{ x: 165, y: 55, width: 40, height: 25 }]);
    expect(kept.map((t) => t.str)).toEqual(["Question 1"]);
  });

  it("filters rotated text by its bounds but doesn't redraw it", () => {
    const [vertical] = placeTextItems(
      [{ str: "RIN 661234567", transform: [0, 12, -12, 0, 40, 400], width: 90, height: 12 }],
      flip,
      0,
    );
    expect(vertical!.upright).toBeUndefined();
    // Runs up the page from y=400 to 490 in PDF space: 302 to 392 on screen.
    const covering = { x: 20, y: 300, width: 30, height: 100 };
    expect(textOutsideBoxes([vertical!], [covering])).toEqual([]);
  });

  it("never redraws text on a rotated page", () => {
    const [item] = placeTextItems(
      [{ str: "Name", transform: [12, 0, 0, 12, 72, 720], width: 30, height: 12 }],
      flip,
      90,
    );
    expect(item!.upright).toBeUndefined();
  });

  it("skips blank items", () => {
    expect(
      placeTextItems(
        [{ str: "  ", transform: [12, 0, 0, 12, 72, 720], width: 6, height: 12 }],
        flip,
        0,
      ),
    ).toEqual([]);
  });
});
