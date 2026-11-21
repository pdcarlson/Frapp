import { describe, expect, it } from "vitest";
import { CLOSES_AT_CASES, closesAtHasPassed } from "@repo/formatting";
import { canCloseCard, foldOptionLabel, isCardClosed } from "./card-closing";
import { formDeadlineLine } from "./forms";
import { checkPollDraft, DUPLICATE_OPTION_PROBLEM } from "./poll-draft";
import { pollCardEyebrow } from "./polls";
import { signupDeadlineLine } from "./signups";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const row = {
  sender_id: "u1",
  _status: "confirmed",
  is_deleted: false,
} as const;

/**
 * The shared deadline cases (#5242): `CLOSES_AT_CASES` from `@repo/formatting`
 * also runs through hooks' Activity rows, so a chat card agrees with the
 * shared boundary on every case, and the guard below keeps `isCardClosed`
 * calling the shared rule rather than a copy of it.
 */
describe("isCardClosed shares the deadline rule (#5242)", () => {
  it.each(CLOSES_AT_CASES)("%s", (_label, closesAt, now, passed) => {
    expect(closesAtHasPassed(closesAt, now)).toBe(passed);
    expect(isCardClosed({ closes_at: closesAt, closed_at: null }, now)).toBe(
      passed,
    );
  });
});

describe("the deadline rule has one owner (#5242)", () => {
  it("isCardClosed calls closesAtHasPassed, with no comparison of its own", () => {
    // The function's own (transpiled) source, so this needs no file access.
    const body = isCardClosed.toString();
    // Transpiled, the call reads `(0, import.closesAtHasPassed)(…)`.
    expect(body).toMatch(/closesAtHasPassed\)?\(/);
    expect(body).not.toMatch(/getTime\(\)\s*(<=|<|>=|>)/);
    expect(body).not.toContain("parseInstant(");
  });
});

describe("isCardClosed (#4696)", () => {
  it("is closed at its end time itself, as the API's isCardClosed and isPollClosed are", () => {
    const due = { closes_at: "2026-11-12T12:00:00.000Z" };
    expect(isCardClosed(due, NOW)).toBe(true);
    expect(isCardClosed(due, NOW - 1)).toBe(false);
  });

  it("is closed once closed early, and never by a missing or unreadable end time", () => {
    expect(isCardClosed({ closed_at: "2026-11-12T11:00:00.000Z" }, 0)).toBe(
      true,
    );
    expect(isCardClosed({}, NOW)).toBe(false);
    expect(isCardClosed({ closes_at: null }, NOW)).toBe(false);
    expect(isCardClosed({ closes_at: "soon" }, NOW)).toBe(false);
  });

  it("is the rule every card kind reads, at the boundary", () => {
    // A kind that drifted from the shared rule would read the boundary
    // differently here.
    const due = { closes_at: "2026-11-12T12:00:00.000Z" };
    const poll = { question: "Q", options: [], ...due };
    expect(pollCardEyebrow(poll, NOW)).toBe("Poll · Closed");
    expect(pollCardEyebrow(poll, NOW - 1)).toBe("Poll");
    const form = { title: "T", questions: [], ...due };
    expect(formDeadlineLine(form, NOW)).toBe("Closed");
    expect(formDeadlineLine(form, NOW - 1)).not.toBe("Closed");
    const signup = { title: "T", slots: [], ...due };
    expect(signupDeadlineLine(signup, NOW)).toBeNull();
    expect(signupDeadlineLine(signup, NOW - 1)).not.toBeNull();
  });
});

describe("canCloseCard", () => {
  it("offers Close to the creator or a channels:manage holder on an open, confirmed card", () => {
    const open = { closes_at: "2026-11-13T12:00:00.000Z" };
    expect(canCloseCard(row, open, "u1", NOW, false)).toBe(true);
    expect(canCloseCard(row, open, "u2", NOW, false)).toBe(false);
    expect(canCloseCard(row, open, "u2", NOW, true)).toBe(true);
    expect(canCloseCard(row, open, null, NOW, true)).toBe(false);
    expect(canCloseCard(row, { closed_at: "x" }, "u1", NOW, false)).toBe(false);
    expect(
      canCloseCard(
        row,
        { closes_at: "2026-11-12T12:00:00.000Z" },
        "u1",
        NOW,
        false,
      ),
    ).toBe(false);
    expect(
      canCloseCard({ ...row, _status: "pending" }, open, "u1", NOW, false),
    ).toBe(false);
    expect(
      canCloseCard({ ...row, is_deleted: true }, open, "u1", NOW, false),
    ).toBe(false);
  });
});

describe("foldOptionLabel", () => {
  it("folds case and runs of whitespace", () => {
    expect(foldOptionLabel("Friday  Night")).toBe("friday night");
    expect(foldOptionLabel("a\t b")).toBe("a b");
  });

  it("is the fold the poll draft compares by", () => {
    expect(
      checkPollDraft({
        question: "Q",
        options: [
          { key: "1", text: "Friday  Night" },
          { key: "2", text: "friday night" },
        ],
      } as Parameters<typeof checkPollDraft>[0]),
    ).toEqual({ ok: false, problem: DUPLICATE_OPTION_PROBLEM });
  });
});
