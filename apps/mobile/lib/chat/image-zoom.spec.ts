import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  MIN_PINCH_SCALE,
  UNZOOMED,
  settle,
  toggleZoom,
  zoomAbout,
} from "./image-zoom";

/**
 * The chat image viewer's pinch-to-zoom (#2874). The gestures themselves need
 * a device, which the sandbox can't run, so this pins the arithmetic they
 * drive: a pinch zooms into the fingers, the zoom stays in range, and the image
 * comes to rest inside the stage.
 */
const STAGE = { width: 400, height: 800 };

/** Where a point of the image, given relative to its centre, lands on screen. */
function project(
  state: { scale: number; x: number; y: number },
  px: number,
  py: number,
) {
  return { x: state.x + state.scale * px, y: state.y + state.scale * py };
}

describe("zoomAbout", () => {
  it("keeps the point under the fingers where it is", () => {
    const zoomed = zoomAbout(UNZOOMED, 2, 100, -50);
    // The image point under (100, -50) at 1x is (100, -50).
    expect(project(zoomed, 100, -50)).toEqual({ x: 100, y: -50 });
    expect(zoomed.scale).toBe(2);
  });

  it("holds the focal point across a pinch that is already zoomed and panned", () => {
    const start = { scale: 2, x: -40, y: 30 };
    // The image point under the focal point before the pinch...
    const focal = { x: 60, y: 120 };
    const imagePoint = {
      x: (focal.x - start.x) / start.scale,
      y: (focal.y - start.y) / start.scale,
    };

    const zoomed = zoomAbout(start, 1.5, focal.x, focal.y);
    // ...is still under it after.
    const landed = project(zoomed, imagePoint.x, imagePoint.y);
    expect(landed.x).toBeCloseTo(focal.x);
    expect(landed.y).toBeCloseTo(focal.y);
  });

  it("stops at the closest zoom and at the pinch's give below fitted", () => {
    expect(zoomAbout(UNZOOMED, 50, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAbout(UNZOOMED, 0.01, 0, 0).scale).toBe(MIN_PINCH_SCALE);
  });
});

describe("settle", () => {
  it("springs a shrunk image back to fitted and centred", () => {
    expect(
      settle({ scale: 0.8, x: 12, y: -9 }, STAGE.width, STAGE.height),
    ).toEqual(UNZOOMED);
  });

  it("pulls a zoomed image's edges back to the stage", () => {
    // At 2x the image overhangs the stage by half its size on each side, so
    // it can move at most 200 across and 400 down before an edge shows.
    expect(
      settle({ scale: 2, x: 999, y: -999 }, STAGE.width, STAGE.height),
    ).toEqual({
      scale: 2,
      x: 200,
      y: -400,
    });
  });

  it("leaves a zoomed image that is already inside the stage alone", () => {
    const state = { scale: 2, x: 50, y: -60 };
    expect(settle(state, STAGE.width, STAGE.height)).toEqual(state);
  });
});

describe("toggleZoom", () => {
  it("zooms a fitted image into the tapped point", () => {
    const zoomed = toggleZoom(UNZOOMED, 40, 80, STAGE.width, STAGE.height);
    expect(zoomed.scale).toBe(DOUBLE_TAP_SCALE);
    expect(project(zoomed, 40, 80)).toEqual({ x: 40, y: 80 });
  });

  it("keeps a tap near the edge from zooming into empty space", () => {
    const zoomed = toggleZoom(UNZOOMED, 200, 400, STAGE.width, STAGE.height);
    const maxX = ((DOUBLE_TAP_SCALE - 1) * STAGE.width) / 2;
    const maxY = ((DOUBLE_TAP_SCALE - 1) * STAGE.height) / 2;
    expect(Math.abs(zoomed.x)).toBeLessThanOrEqual(maxX);
    expect(Math.abs(zoomed.y)).toBeLessThanOrEqual(maxY);
  });

  it("fits a zoomed image", () => {
    expect(
      toggleZoom({ scale: 3, x: 10, y: 10 }, 0, 0, STAGE.width, STAGE.height),
    ).toEqual(UNZOOMED);
  });
});
