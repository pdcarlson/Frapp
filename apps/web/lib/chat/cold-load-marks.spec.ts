/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLD_LOAD_MARKS,
  markColdLoad,
  resetColdLoadMarksForTest,
} from "./cold-load-marks";

describe("cold-load marks (#2145)", () => {
  beforeEach(() => {
    resetColdLoadMarksForTest();
    window.performance.clearMarks?.();
    window.performance.clearMeasures?.();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a mark and a measure from the time origin", () => {
    // The `measure` is the half that carries a number: a bare mark is a
    // timestamp, and `1s` budgets a duration from navigation start.
    expect(markColdLoad(COLD_LOAD_MARKS.channelReadable)).toBe(true);

    expect(
      window.performance.getEntriesByName(
        COLD_LOAD_MARKS.channelReadable,
        "mark",
      ),
    ).toHaveLength(1);
    expect(
      window.performance.getEntriesByName(
        COLD_LOAD_MARKS.channelReadable,
        "measure",
      ),
    ).toHaveLength(1);
  });

  it("records each milestone only once per document", () => {
    // These are COLD-load budgets. A channel switch ten minutes in also makes a
    // timeline readable, and averaging those warm interactions in would drag the
    // metric to a number that flatters the load it exists to measure.
    expect(markColdLoad(COLD_LOAD_MARKS.channelReadable)).toBe(true);
    expect(markColdLoad(COLD_LOAD_MARKS.channelReadable)).toBe(false);
    expect(markColdLoad(COLD_LOAD_MARKS.channelReadable)).toBe(false);

    expect(
      window.performance.getEntriesByName(
        COLD_LOAD_MARKS.channelReadable,
        "mark",
      ),
    ).toHaveLength(1);
  });

  it("keeps the two milestones independent", () => {
    markColdLoad(COLD_LOAD_MARKS.channelReadable);

    expect(markColdLoad(COLD_LOAD_MARKS.composerFocusable)).toBe(true);
  });

  it("never throws when the Performance API is unavailable", () => {
    // Older Safari lacks it and privacy tooling removes it outright. A
    // placeholder measurement is not worth a blank screen.
    vi.spyOn(window.performance, "mark").mockImplementation(() => {
      throw new Error("blocked by privacy settings");
    });

    expect(() => markColdLoad(COLD_LOAD_MARKS.composerFocusable)).not.toThrow();
    expect(markColdLoad(COLD_LOAD_MARKS.composerFocusable)).toBe(false);
  });
});
