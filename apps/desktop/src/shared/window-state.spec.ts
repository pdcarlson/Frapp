import { describe, expect, it } from "vitest";
import { DEFAULT_SIZE, MIN_SIZE, parseWindowState, restoreBounds } from "./window-state";

const laptop = { x: 0, y: 0, width: 1440, height: 900 };

describe("parseWindowState", () => {
  it("reads a saved state", () => {
    const raw = JSON.stringify({ bounds: { x: 10, y: 20, width: 1000, height: 700 }, maximized: true });
    expect(parseWindowState(raw)).toEqual({
      bounds: { x: 10, y: 20, width: 1000, height: 700 },
      maximized: true,
    });
  });

  it("treats a missing or damaged file as no state", () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState("{")).toBeNull();
    expect(parseWindowState(JSON.stringify({ bounds: { x: 1 } }))).toBeNull();
  });
});

describe("restoreBounds", () => {
  it("opens at the default size the first time", () => {
    expect(restoreBounds(null, [laptop])).toEqual(DEFAULT_SIZE);
  });

  it("puts the window back where it was when that place is still on screen", () => {
    const saved = { bounds: { x: 100, y: 80, width: 1100, height: 760 }, maximized: false };
    expect(restoreBounds(saved, [laptop])).toEqual({ x: 100, y: 80, width: 1100, height: 760 });
  });

  it("keeps the size but drops the place when its monitor is gone", () => {
    const saved = { bounds: { x: 2000, y: 100, width: 1100, height: 760 }, maximized: false };
    expect(restoreBounds(saved, [laptop])).toEqual({ width: 1100, height: 760 });
  });

  it("never restores smaller than the minimum", () => {
    const saved = { bounds: { x: 0, y: 0, width: 10, height: 10 }, maximized: false };
    expect(restoreBounds(saved, [laptop])).toMatchObject({ width: MIN_SIZE.width, height: MIN_SIZE.height });
  });
});
