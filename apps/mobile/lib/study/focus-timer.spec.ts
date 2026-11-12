import { describe, expect, it } from "vitest";
import {
  breakMinutesFor,
  focusTimerCopy,
  readFocusTimer,
} from "./focus-timer";

const MIN = 60_000;

describe("breakMinutesFor", () => {
  it("is five minutes, or a minute under the grace window", () => {
    expect(breakMinutesFor(10)).toBe(5);
    // The default 5-minute grace: a 4-minute break, so coming back when it
    // ends is always inside the window.
    expect(breakMinutesFor(5)).toBe(4);
    expect(breakMinutesFor(2)).toBe(1);
    expect(breakMinutesFor(1)).toBe(1);
  });
});

describe("readFocusTimer", () => {
  const start = Date.parse("2026-11-12T12:00:00Z");

  it("counts down 25 minutes of focus", () => {
    expect(readFocusTimer(start, start, 4)).toEqual({
      phase: "focus",
      secondsLeft: 25 * 60,
      round: 1,
    });
    expect(readFocusTimer(start, start + 6 * MIN + 18_000, 4)).toEqual({
      phase: "focus",
      secondsLeft: 18 * 60 + 42,
      round: 1,
    });
  });

  it("then the break, then the next round", () => {
    expect(readFocusTimer(start, start + 25 * MIN, 4)).toEqual({
      phase: "break",
      secondsLeft: 4 * 60,
      round: 1,
    });
    expect(readFocusTimer(start, start + 29 * MIN, 4)).toEqual({
      phase: "focus",
      secondsLeft: 25 * 60,
      round: 2,
    });
  });

  it("never reads before it started", () => {
    expect(readFocusTimer(start, start - 900, 4).secondsLeft).toBe(25 * 60);
  });
});

describe("focusTimerCopy", () => {
  it("names the phase and what's left", () => {
    expect(
      focusTimerCopy({ phase: "focus", secondsLeft: 18 * 60 + 42, round: 1 }),
    ).toBe("Focus · 18:42 left");
    expect(focusTimerCopy({ phase: "break", secondsLeft: 190, round: 1 })).toBe(
      "Break · 3:10 left",
    );
  });
});
