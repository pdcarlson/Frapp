import { describe, expect, it } from "vitest";
import {
  categoryTiles,
  importTotals,
  type CategoryProgress,
} from "./category-progress";

const line = (
  category: string | null,
  channels: number,
  threads: number,
  done: number,
  failed = 0,
): CategoryProgress => ({ category, channels, threads, done, failed });

describe("categoryTiles", () => {
  it("draws one tile per category, a channel and its threads counted together", () => {
    expect(
      categoryTiles([line(null, 2, 0, 2), line("Committees", 11, 28, 8, 1)]),
    ).toEqual([
      {
        key: "none",
        name: "No category",
        done: 2,
        total: 2,
        failed: 0,
        finished: true,
      },
      expect.objectContaining({
        name: "Committees",
        done: 8,
        total: 39,
        failed: 1,
        finished: false,
      }),
    ]);
  });

  it("leaves out a category with nothing being imported", () => {
    expect(categoryTiles([line("Skipped", 0, 0, 0)])).toEqual([]);
  });

  it("sums what is past the cap into one last tile", () => {
    const lines = Array.from({ length: 11 }, (_, index) =>
      line(`C${index}`, 1, 1, index < 9 ? 2 : 0),
    );
    const tiles = categoryTiles(lines, 8);
    expect(tiles).toHaveLength(8);
    expect(tiles.map((tile) => tile.name).slice(0, 7)).toEqual([
      "C0",
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
    ]);
    // C7 and C8 are done, C9 and C10 aren't.
    expect(tiles[7]).toEqual({
      key: "more",
      name: "+ 4 more",
      done: 4,
      total: 8,
      failed: 0,
      finished: false,
    });
  });

  it("draws every tile when they fit exactly", () => {
    const lines = Array.from({ length: 8 }, (_, index) =>
      line(`C${index}`, 1, 0, 0),
    );
    expect(categoryTiles(lines, 8).map((tile) => tile.name)).not.toContain(
      "+ 1 more",
    );
  });
});

describe("importTotals", () => {
  it("counts channels and threads apart", () => {
    // Staging's import, 2026-09-30: its Notifications category, and the
    // other ten summed into one line.
    expect(
      importTotals([
        line("Notifications", 3, 630, 633),
        line("Other", 75, 438, 0),
      ]),
    ).toEqual({ channels: 78, threads: 1068 });
  });
});
