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
  return {
    question,
    options: options.map((text, i) => ({ key: `k${i}`, text })),
    closes: DEFAULT_POLL_CLOSE,
  };
}

const texts = (d: PollDraft) => d.options.map((row) => row.text);

describe("canCreatePoll (#3701)", () => {
  it("needs polls:create", () => {
    expect(
      canCreatePoll({ permissions: ["polls:create"], pollsGate: "on" }),
    ).toBe(true);
    expect(
      canCreatePoll({ permissions: ["members:view"], pollsGate: "on" }),
    ).toBe(false);
  });

  it("lets a President's * through", () => {
    expect(canCreatePoll({ permissions: ["*"], pollsGate: "on" })).toBe(true);
  });

  it("is off while Polls is off, whatever the role", () => {
    expect(canCreatePoll({ permissions: ["*"], pollsGate: "off" })).toBe(false);
  });

  it("fails closed while Polls is unread or unreadable, as the card's Vote does", () => {
    expect(canCreatePoll({ permissions: ["*"], pollsGate: "loading" })).toBe(
      false,
    );
    expect(canCreatePoll({ permissions: ["*"], pollsGate: "error" })).toBe(
      false,
    );
  });

  it("offers nothing while permissions are still loading", () => {
    expect(canCreatePoll({ permissions: undefined, pollsGate: "on" })).toBe(
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
  it("adds rows up to ten, each with its own key", () => {
    let next = emptyPollDraft();
    for (let i = 0; i < 20; i++) next = addPollOption(next);
    expect(next.options).toHaveLength(10);
    expect(new Set(next.options.map((row) => row.key)).size).toBe(10);
  });

  it("never goes below the two rows a poll needs", () => {
    const start = draft("Q?", ["A", "B"]);
    expect(removePollOption(start, "k0")).toBe(start);
    expect(texts(removePollOption(draft("Q?", ["A", "B", "C"]), "k1"))).toEqual(
      ["A", "C"],
    );
  });

  it("moves a row up or down, key and all, and not off either end", () => {
    const start = draft("Q?", ["A", "B", "C"]);
    const moved = movePollOption(start, "k2", -1);
    expect(texts(moved)).toEqual(["A", "C", "B"]);
    // The row keeps its key, so its field (and focus) moves with the text.
    expect(moved.options[1]).toEqual({ key: "k2", text: "C" });
    expect(texts(movePollOption(start, "k0", 1))).toEqual(["B", "A", "C"]);
    expect(movePollOption(start, "k0", -1)).toBe(start);
    expect(movePollOption(start, "k2", 1)).toBe(start);
  });

  it("sets one row's text", () => {
    expect(texts(setPollOption(draft("Q?", ["A", "B"]), "k1", "Bee"))).toEqual([
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
