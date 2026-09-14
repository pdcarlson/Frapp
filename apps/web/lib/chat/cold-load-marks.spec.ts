/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLD_LOAD_MARKS,
  markColdLoad,
  markComposerFocusable,
  noteComposerShellFocusable,
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

/**
 * #2176 split one milestone into two, and moved the first one off Tiptap.
 *
 * `1s` budgets "composer focusable <= 400ms" and puts "composer shell" in its
 * 0ms set. `ComposerShell` is what satisfies both; the editor arrives whenever
 * the channel list does. Reporting the editor's arrival under the board's
 * wording measured a network round trip, which is the whole of what #2176
 * changed — so the number has to come from the shell even though the guard that
 * decides whether to emit it at all cannot run until `can_post` is known.
 */
describe("composer milestones (#2176)", () => {
  beforeEach(() => {
    resetColdLoadMarksForTest();
    window.performance.clearMarks?.();
    window.performance.clearMeasures?.();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const startTimeOf = (name: string) =>
    window.performance.getEntriesByName(name, "mark")[0]?.startTime;

  it("timestamps the shell, not the editor that emits the mark", () => {
    /*
      The load-bearing case. If this reported the emission time instead, the
      channel round trip would be back inside the number and the mark would
      measure what it measured before #2176 under a name that now claims
      otherwise.
    */
    const now = vi.spyOn(window.performance, "now");

    now.mockReturnValue(80);
    noteComposerShellFocusable();
    now.mockReturnValue(1400);
    expect(markComposerFocusable()).toBe(true);

    expect(startTimeOf(COLD_LOAD_MARKS.composerFocusable)).toBe(80);
  });

  it("carries that same timestamp to Sentry, not the span's own arithmetic", () => {
    // `detail.msFromTimeOrigin` is the authoritative value — the file's long
    // note on `_addMeasureSpans` says why the span duration is not.
    const now = vi.spyOn(window.performance, "now");
    now.mockReturnValue(80);
    noteComposerShellFocusable();
    now.mockReturnValue(1400);
    markComposerFocusable();

    const measure = window.performance.getEntriesByName(
      COLD_LOAD_MARKS.composerFocusable,
      "measure",
    )[0] as PerformanceMeasure | undefined;
    expect(
      (measure?.detail as { msFromTimeOrigin?: number } | null)
        ?.msFromTimeOrigin,
    ).toBe(80);
  });

  it("keeps only the first shell timestamp, so a remount cannot push it later", () => {
    const now = vi.spyOn(window.performance, "now");

    now.mockReturnValue(80);
    noteComposerShellFocusable();
    now.mockReturnValue(900);
    noteComposerShellFocusable();
    markComposerFocusable();

    expect(startTimeOf(COLD_LOAD_MARKS.composerFocusable)).toBe(80);
  });

  it("falls back to the emission time when no shell ever mounted", () => {
    // Not a hypothetical: a client-side navigation into `/chat` from another
    // route can land with the channel list already cached, so `<Composer>` can
    // mount without a shell having preceded it.
    vi.spyOn(window.performance, "now").mockReturnValue(1400);

    expect(markComposerFocusable()).toBe(true);
    expect(startTimeOf(COLD_LOAD_MARKS.composerFocusable)).toBeGreaterThan(0);
  });

  it("keeps the editor's own milestone independent of the shell's", () => {
    // Two milestones, not one renamed: `composer-editor-ready` is the only
    // signal that would still notice the chat chunk getting slower.
    noteComposerShellFocusable();
    expect(markComposerFocusable()).toBe(true);

    expect(markColdLoad(COLD_LOAD_MARKS.composerEditorReady)).toBe(true);
    expect(
      window.performance.getEntriesByName(
        COLD_LOAD_MARKS.composerEditorReady,
        "measure",
      ),
    ).toHaveLength(1);
  });

  it("records the back-dated milestone only once per document", () => {
    noteComposerShellFocusable();

    expect(markComposerFocusable()).toBe(true);
    expect(markComposerFocusable()).toBe(false);
    expect(
      window.performance.getEntriesByName(
        COLD_LOAD_MARKS.composerFocusable,
        "mark",
      ),
    ).toHaveLength(1);
  });

  it("never throws when the Performance API is unavailable", () => {
    const performanceRef = window.performance;
    // @ts-expect-error — deliberately removing the API the guard exists for.
    delete window.performance;
    try {
      expect(() => noteComposerShellFocusable()).not.toThrow();
      expect(markComposerFocusable()).toBe(false);
    } finally {
      window.performance = performanceRef;
    }
  });
});
