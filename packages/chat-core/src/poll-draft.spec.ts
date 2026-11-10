import { describe, expect, it } from "vitest";
import {
  addPollOption,
  checkPollDraft,
  closesAtFor,
  POLL_CLOSE_CHOICES,
  pollCloseSummary,
  DEFAULT_POLL_CLOSE,
  DUPLICATE_OPTION_PROBLEM,
  emptyPollDraft,
  movePollOption,
  pollDraftFromArgs,
  removePollOption,
  setPollOption,
  type PollDraft,
} from "./poll-draft";

function draft(question: string, options: string[]): PollDraft {
  return {
    question,
    options: options.map((text, i) => ({ key: `k${i}`, text })),
    closes: DEFAULT_POLL_CLOSE,
  };
}

const texts = (d: PollDraft) => d.options.map((row) => row.text);

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
    expect(closesAtFor(DEFAULT_POLL_CLOSE, now)?.toISOString()).toBe(
      "2026-11-10T12:00:00.000Z",
    );
  });

  it("offers an hour and a week", () => {
    expect(closesAtFor("1h", now)?.toISOString()).toBe(
      "2026-11-09T13:00:00.000Z",
    );
    expect(closesAtFor("1w", now)?.toISOString()).toBe(
      "2026-11-16T12:00:00.000Z",
    );
  });

  it("sets no deadline for Doesn't close (#3896)", () => {
    expect(closesAtFor("never", now)).toBeNull();
    expect(POLL_CLOSE_CHOICES.at(-1)).toEqual({
      id: "never",
      label: "Doesn't close",
      minutes: null,
    });
    // The default is still a day.
    expect(DEFAULT_POLL_CLOSE).toBe("1d");
  });

  it("says the choice as mobile's More options row reads it", () => {
    expect(pollCloseSummary("1d")).toBe("Closes in 1 day");
    expect(pollCloseSummary("never")).toBe("Doesn't close");
  });
});

describe("pollDraftFromArgs (#3865)", () => {
  const texts = (d: PollDraft) => d.options.map((row) => row.text);

  it("opens an empty draft for a bare /poll", () => {
    const d = pollDraftFromArgs("  ");
    expect(d.question).toBe("");
    expect(texts(d)).toEqual(["", ""]);
  });

  it("reads the question and the options the one-liner would", () => {
    const d = pollDraftFromArgs('"Who drives?" Sam closes=60');
    expect(d.question).toBe("Who drives?");
    expect(texts(d)).toEqual(["Sam", ""]);
    // `closes=60` is the form's "1 hour", not the default day.
    expect(d.closes).toBe("1h");
  });

  it("snaps closes= to the nearest choice the form offers", () => {
    expect(pollDraftFromArgs('"Q" closes=4000').closes).toBe("3d");
    // However long, a typed number of minutes is a deadline: the nearest
    // timed choice, never "Doesn't close" (#3896).
    expect(pollDraftFromArgs('"Q" closes=9999999').closes).toBe("1w");
  });

  it("recovers the options when the last one's closing quote is missing", () => {
    const d = pollDraftFromArgs('"Who drives?" Sam "Alex Smith');
    expect(d.question).toBe("Who drives?");
    expect(texts(d)).toEqual(["Sam", "Alex Smith"]);
  });

  it("keeps every typed option, past the maximum, for the member to trim", () => {
    const d = pollDraftFromArgs('"Q" A B C D E F G H I J K');
    expect(texts(d)).toHaveLength(11);
    expect(checkPollDraft(d)).toEqual({
      ok: false,
      problem: "A poll can have up to 10 options.",
    });
  });

  it("adds rows past the minimum, with keys of their own", () => {
    const d = pollDraftFromArgs('"Q" A B C');
    expect(texts(d)).toEqual(["A", "B", "C"]);
    expect(new Set(d.options.map((row) => row.key)).size).toBe(3);
  });

  it("keeps a question still being typed inside an open quote", () => {
    expect(pollDraftFromArgs('"Who is driving').question).toBe(
      "Who is driving",
    );
  });
});
