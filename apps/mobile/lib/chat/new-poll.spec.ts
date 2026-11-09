import { describe, expect, it } from "vitest";
import {
  addPollOption,
  canCreatePoll,
  checkPollDraft,
  closesAtFor,
  DEFAULT_POLL_CLOSE,
  DUPLICATE_OPTION_PROBLEM,
  emptyPollDraft,
  movePollOption,
  removePollOption,
  setPollOption,
  type PollDraft,
} from "./new-poll";

function draft(question: string, options: string[]): PollDraft {
  return { question, options, closes: DEFAULT_POLL_CLOSE };
}

describe("canCreatePoll (#3701)", () => {
  it("needs polls:create", () => {
    expect(
      canCreatePoll({ permissions: ["polls:create"], enabledModules: {} }),
    ).toBe(true);
    expect(
      canCreatePoll({ permissions: ["members:view"], enabledModules: {} }),
    ).toBe(false);
  });

  it("lets a President's * through", () => {
    expect(canCreatePoll({ permissions: ["*"], enabledModules: {} })).toBe(
      true,
    );
  });

  it("is off while Polls is off, whatever the role", () => {
    expect(
      canCreatePoll({ permissions: ["*"], enabledModules: { polls: false } }),
    ).toBe(false);
  });

  it("offers nothing while permissions are still loading", () => {
    expect(canCreatePoll({ permissions: undefined, enabledModules: {} })).toBe(
      false,
    );
  });
});

describe("checkPollDraft (#3701)", () => {
  it("starts unfinished, with nothing to complain about", () => {
    expect(checkPollDraft(emptyPollDraft())).toEqual({
      ok: false,
      problem: null,
    });
  });

  it("posts the trimmed question and filled rows, in order", () => {
    expect(
      checkPollDraft(draft("  Who's driving?  ", [" Me ", "", "Not me"])),
    ).toEqual({ ok: true, question: "Who's driving?", options: ["Me", "Not me"] });
  });

  it("needs a question", () => {
    expect(checkPollDraft(draft("   ", ["A", "B"]))).toEqual({
      ok: false,
      problem: null,
    });
  });

  it("needs two filled options", () => {
    expect(checkPollDraft(draft("Q?", ["A", "  "]))).toEqual({
      ok: false,
      problem: null,
    });
  });

  it("refuses two options that differ only in case or spacing", () => {
    expect(checkPollDraft(draft("Q?", ["Friday night", "friday  NIGHT"]))).toEqual(
      { ok: false, problem: DUPLICATE_OPTION_PROBLEM },
    );
  });

  it("refuses more than ten options", () => {
    const options = Array.from({ length: 11 }, (_, i) => `Option ${i}`);
    expect(checkPollDraft(draft("Q?", options)).ok).toBe(false);
  });
});

describe("editing the option rows (#3701)", () => {
  it("adds rows up to ten", () => {
    let next = emptyPollDraft();
    for (let i = 0; i < 20; i++) next = addPollOption(next);
    expect(next.options).toHaveLength(10);
  });

  it("never goes below the two rows a poll needs", () => {
    const start = draft("Q?", ["A", "B"]);
    expect(removePollOption(start, 0)).toBe(start);
    expect(removePollOption(draft("Q?", ["A", "B", "C"]), 1).options).toEqual([
      "A",
      "C",
    ]);
  });

  it("moves a row up or down, and not off either end", () => {
    const start = draft("Q?", ["A", "B", "C"]);
    expect(movePollOption(start, 2, -1).options).toEqual(["A", "C", "B"]);
    expect(movePollOption(start, 0, 1).options).toEqual(["B", "A", "C"]);
    expect(movePollOption(start, 0, -1)).toBe(start);
    expect(movePollOption(start, 2, 1)).toBe(start);
  });

  it("sets one row's text", () => {
    expect(setPollOption(draft("Q?", ["A", "B"]), 1, "Bee").options).toEqual([
      "A",
      "Bee",
    ]);
  });
});

describe("closesAtFor (#3701)", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("closes a day out by default, as /poll does", () => {
    expect(closesAtFor(DEFAULT_POLL_CLOSE, now).toISOString()).toBe(
      "2026-11-10T12:00:00.000Z",
    );
  });

  it("offers an hour and a week", () => {
    expect(closesAtFor("1h", now).toISOString()).toBe(
      "2026-11-09T13:00:00.000Z",
    );
    expect(closesAtFor("1w", now).toISOString()).toBe(
      "2026-11-16T12:00:00.000Z",
    );
  });
});
