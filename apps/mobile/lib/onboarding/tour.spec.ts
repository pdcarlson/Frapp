import { describe, expect, it, vi } from "vitest";
import {
  TOUR_DUE_STORAGE_KEY,
  TOUR_STOPS,
  clearTourDue,
  isTourDue,
  markTourDue,
  onboardingTourFinishedProperties,
  tourCalloutSide,
  tourProgressLabel,
  tourSpot,
  tourStopText,
} from "./tour";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

describe("first-run tour stops", () => {
  it("has three stops, one line each, in the plan's order", () => {
    expect(TOUR_STOPS.map((stop) => stop.key)).toEqual([
      "channels",
      "quickActions",
      "more",
    ]);
    for (const stop of TOUR_STOPS) {
      expect(stop.text).not.toMatch(/\n/);
      expect(stop.text.length).toBeLessThanOrEqual(60);
    }
  });

  it("names the chapter on the first stop", () => {
    expect(tourStopText(TOUR_STOPS[0]!, "Phi Gamma Delta")).toBe(
      "You're in Phi Gamma Delta. Tap a channel to start talking.",
    );
    expect(tourStopText(TOUR_STOPS[0]!, null)).toBe(
      "You're in your chapter. Tap a channel to start talking.",
    );
  });

  it("counts over the stops the member will see", () => {
    expect(tourProgressLabel(0, 3)).toBe("1 of 3");
    expect(tourProgressLabel(1, 2)).toBe("2 of 2");
  });
});

describe("first-run tour, once per member", () => {
  it("is due only for the member s03 marked it for", async () => {
    const storage = memoryStorage();
    expect(await isTourDue("u-1", storage)).toBe(false);

    await markTourDue("u-1", storage);
    expect(storage.setItem).toHaveBeenCalledWith(TOUR_DUE_STORAGE_KEY, "u-1");
    expect(await isTourDue("u-1", storage)).toBe(true);
    expect(await isTourDue("u-2", storage)).toBe(false);

    await clearTourDue(storage);
    expect(await isTourDue("u-1", storage)).toBe(false);
  });

  it("treats a storage failure as not due, and never throws", async () => {
    const broken = {
      getItem: vi.fn().mockRejectedValue(new Error("disk")),
      setItem: vi.fn().mockRejectedValue(new Error("disk")),
      removeItem: vi.fn().mockRejectedValue(new Error("disk")),
    };
    await expect(markTourDue("u-1", broken)).resolves.toBeUndefined();
    await expect(isTourDue("u-1", broken)).resolves.toBe(false);
    await expect(clearTourDue(broken)).resolves.toBeUndefined();
  });
});

describe("first-run tour spot", () => {
  const bounds = { top: 50, bottom: 760, width: 390 };

  it("pads the control and keeps it inside the visible band", () => {
    expect(
      tourSpot({ x: 300, y: 770, width: 62, height: 62 }, bounds),
    ).toBeNull();
    expect(tourSpot({ x: 314, y: 690, width: 62, height: 62 }, bounds)).toEqual(
      { x: 308, y: 684, width: 74, height: 74 },
    );
  });

  it("caps a long list to its first rows", () => {
    const spot = tourSpot(
      { x: 0, y: 200, width: 390, height: 900 },
      bounds,
      220,
    );
    expect(spot).toEqual({ x: 4, y: 194, width: 382, height: 220 });
  });

  it("skips a control that is all but off screen", () => {
    expect(
      tourSpot({ x: 0, y: 755, width: 390, height: 40 }, bounds),
    ).toBeNull();
  });

  it("puts the line under a spot in the top half, over one in the bottom", () => {
    expect(tourCalloutSide({ x: 0, y: 100, width: 10, height: 200 }, 800)).toBe(
      "below",
    );
    expect(tourCalloutSide({ x: 0, y: 700, width: 10, height: 60 }, 800)).toBe(
      "above",
    );
  });
});

describe("onboarding-tour-finished", () => {
  it("is shape only", () => {
    expect(
      onboardingTourFinishedProperties({ skipped: true, stop: 1, stops: 3 }),
    ).toEqual({ outcome: "skipped", stop: 1, stops: 3 });
    expect(
      onboardingTourFinishedProperties({ skipped: false, stop: 3, stops: 3 }),
    ).toEqual({ outcome: "done", stop: 3, stops: 3 });
  });
});
