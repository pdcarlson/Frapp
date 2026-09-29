import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  MIN_PINCH_SCALE,
  UNZOOMED,
  fittedSize,
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

describe("fittedSize", () => {
  it("letterboxes the image inside the stage, as resizeMode contain draws it", () => {
    // A 4:3 landscape photo on a portrait stage fits to the stage's width.
    expect(fittedSize({ width: 4000, height: 3000 }, STAGE)).toEqual({
      width: 400,
      height: 300,
    });
    // A tall screenshot fits to the stage's height.
    expect(fittedSize({ width: 400, height: 2000 }, STAGE)).toEqual({
      width: 160,
      height: 800,
    });
  });

  it("stands in the stage until the image reports its size", () => {
    expect(fittedSize({ width: 0, height: 0 }, STAGE)).toEqual(STAGE);
  });
});

describe("settle", () => {
  it("springs a shrunk image back to fitted and centred", () => {
    expect(settle({ scale: 0.8, x: 12, y: -9 }, STAGE, STAGE)).toEqual(
      UNZOOMED,
    );
  });

  it("pulls a zoomed image's edges back to the stage", () => {
    // An image filling the stage overhangs it by half its size on each side
    // at 2x, so it can move at most 200 across and 400 down.
    expect(settle({ scale: 2, x: 999, y: -999 }, STAGE, STAGE)).toEqual({
      scale: 2,
      x: 200,
      y: -400,
    });
  });

  it("bounds a letterboxed image by the image, not the stage", () => {
    // A 4:3 photo is drawn 400x300 on the 400x800 stage. At 4x it is 1200
    // tall, so it can move 200 either way before an edge leaves the stage's.
    // Bounding it by the stage (1200 either way) let it be dragged off into
    // empty space and left there.
    const content = fittedSize({ width: 4000, height: 3000 }, STAGE);
    const settled = settle({ scale: 4, x: 0, y: 975 }, STAGE, content);
    expect(settled.y).toBe(200);
    // The image's top edge, relative to the stage's centre, is still at or
    // above the stage's top edge.
    expect(settled.y - (4 * content.height) / 2).toBeLessThanOrEqual(
      -STAGE.height / 2,
    );
  });

  it("centres an axis where the zoomed image is still smaller than the stage", () => {
    // The same photo at 2x is 600 tall on an 800 stage: nothing to pan to.
    const content = fittedSize({ width: 4000, height: 3000 }, STAGE);
    expect(settle({ scale: 2, x: 0, y: 150 }, STAGE, content).y).toBe(0);
  });

  it("leaves a zoomed image that is already inside the stage alone", () => {
    const state = { scale: 2, x: 50, y: -60 };
    expect(settle(state, STAGE, STAGE)).toEqual(state);
  });
});

describe("toggleZoom", () => {
  it("zooms a fitted image into the tapped point", () => {
    const zoomed = toggleZoom(UNZOOMED, 40, 80, STAGE, STAGE);
    expect(zoomed.scale).toBe(DOUBLE_TAP_SCALE);
    expect(project(zoomed, 40, 80)).toEqual({ x: 40, y: 80 });
  });

  it("keeps a tap near the edge from zooming into empty space", () => {
    const zoomed = toggleZoom(UNZOOMED, 200, 400, STAGE, STAGE);
    const maxX = ((DOUBLE_TAP_SCALE - 1) * STAGE.width) / 2;
    const maxY = ((DOUBLE_TAP_SCALE - 1) * STAGE.height) / 2;
    expect(Math.abs(zoomed.x)).toBeLessThanOrEqual(maxX);
    expect(Math.abs(zoomed.y)).toBeLessThanOrEqual(maxY);
  });

  it("fits a zoomed image", () => {
    expect(toggleZoom({ scale: 3, x: 10, y: 10 }, 0, 0, STAGE, STAGE)).toEqual(
      UNZOOMED,
    );
  });
});
