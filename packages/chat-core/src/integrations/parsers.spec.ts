import { POINTS_REASON_MAX_LENGTH } from "@repo/validation";
import { describe, expect, it } from "vitest";
import {
  parseAnnounceArgs,
  parseEventArgs,
  parseHoursArgs,
  parsePointsArgs,
  parsePollArgs,
  parseRushArgs,
  parseTaskArgs,
  tokenizeQuotedArgs,
} from "./parsers";

describe("tokenizeQuotedArgs", () => {
  it("splits on whitespace", () => {
    expect(tokenizeQuotedArgs("a b c")).toEqual(["a", "b", "c"]);
  });

  it("respects quoted spans", () => {
    expect(tokenizeQuotedArgs('"foo bar" baz')).toEqual(["foo bar", "baz"]);
  });

  it("returns null on an unterminated quote", () => {
    expect(tokenizeQuotedArgs('"foo')).toBeNull();
  });

  it("collapses runs of whitespace", () => {
    expect(tokenizeQuotedArgs("  a   b   ")).toEqual(["a", "b"]);
  });
});

describe("parsePollArgs", () => {
  it("parses question + two options", () => {
    const r = parsePollArgs('"Best night?" Mon Tue');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.question).toBe("Best night?");
    expect(r.value.options).toEqual(["Mon", "Tue"]);
  });

  it("rejects fewer than two options", () => {
    const r = parsePollArgs('"Just one?" Yes');
    expect(r.ok).toBe(false);
  });

  it("rejects an empty question", () => {
    const r = parsePollArgs('"" Mon Tue');
    expect(r.ok).toBe(false);
  });

  it("rejects more than ten options", () => {
    const r = parsePollArgs(
      '"Pick" a b c d e f g h i j k',
    );
    expect(r.ok).toBe(false);
  });

  it("dedups options case-insensitively while preserving first casing", () => {
    const r = parsePollArgs('"Q?" Mon mon Tue');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.options).toEqual(["Mon", "Tue"]);
  });

  it("accepts a custom close window via closes=<minutes>", () => {
    const r = parsePollArgs('"Q?" Mon Tue closes=60');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.closesInMinutes).toBe(60);
  });

  it("falls back to the default close window on a non-finite value", () => {
    const r = parsePollArgs('"Q?" Mon Tue closes=abc');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.closesInMinutes).toBe(60 * 24);
  });

  it("returns an error on an unterminated quote (no silent drop)", () => {
    const r = parsePollArgs('"Q? Mon Tue');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/quote/i);
  });
});

describe("parseAnnounceArgs", () => {
  it("accepts a non-empty message", () => {
    const r = parseAnnounceArgs("Big meeting tonight");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.message).toBe("Big meeting tonight");
  });

  it("rejects an empty message", () => {
    const r = parseAnnounceArgs("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects an overlong message", () => {
    const r = parseAnnounceArgs("x".repeat(4001));
    expect(r.ok).toBe(false);
  });
});

describe("parsePointsArgs", () => {
  it("parses a grant into a positive MANUAL adjustment", () => {
    const r = parsePointsArgs("grant @alice 5 for great work");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      action: "grant",
      memberToken: "alice",
      amount: 5,
      reason: "great work",
      category: "MANUAL",
    });
  });

  it("parses a deduct into a FINE (sign applied downstream)", () => {
    const r = parsePointsArgs("deduct @bob 3 for late dues");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toBe("deduct");
    expect(r.value.category).toBe("FINE");
    expect(r.value.amount).toBe(3);
    expect(r.value.reason).toBe("late dues");
  });

  it("is case-insensitive on the action", () => {
    const r = parsePointsArgs("GRANT @alice 2 for x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toBe("grant");
  });

  it("keeps a multi-word reason", () => {
    const r = parsePointsArgs("grant @alice 1 for showing up early again");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reason).toBe("showing up early again");
  });

  it("rejects an unknown action", () => {
    const r = parsePointsArgs("award @alice 5 for x");
    expect(r.ok).toBe(false);
  });

  it("rejects a missing @member token", () => {
    const r = parsePointsArgs("grant alice 5 for x");
    expect(r.ok).toBe(false);
  });

  it("rejects an empty @ token", () => {
    const r = parsePointsArgs("grant @ 5 for x");
    expect(r.ok).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    expect(parsePointsArgs("grant @alice 0 for x").ok).toBe(false);
    expect(parsePointsArgs("grant @alice -2 for x").ok).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    expect(parsePointsArgs("grant @alice 2.5 for x").ok).toBe(false);
    expect(parsePointsArgs("grant @alice abc for x").ok).toBe(false);
  });

  it("rejects a missing 'for' keyword", () => {
    const r = parsePointsArgs("grant @alice 5 great work");
    expect(r.ok).toBe(false);
  });

  it("rejects an empty reason", () => {
    const r = parsePointsArgs("grant @alice 5 for");
    expect(r.ok).toBe(false);
  });

  it("returns an error on an unterminated quote", () => {
    const r = parsePointsArgs('grant @alice 5 for "great work');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/quote/i);
  });
});

describe("parseTaskArgs", () => {
  it("parses a quoted title, assignee, date, and points", () => {
    const r = parseTaskArgs('"Clean the house" @alice 2026-06-15 10');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      title: "Clean the house",
      assigneeToken: "alice",
      dueDate: "2026-06-15",
      pointReward: 10,
    });
  });

  it("treats points as optional (null when omitted)", () => {
    const r = parseTaskArgs('"Ship 10b" @bob 2026-07-01');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pointReward).toBeNull();
  });

  it("rejects an empty title", () => {
    const r = parseTaskArgs('"" @alice 2026-06-15');
    expect(r.ok).toBe(false);
  });

  it("rejects a missing @assignee token", () => {
    const r = parseTaskArgs('"Task" alice 2026-06-15');
    expect(r.ok).toBe(false);
  });

  it("rejects an empty @ token", () => {
    const r = parseTaskArgs('"Task" @ 2026-06-15');
    expect(r.ok).toBe(false);
  });

  it("requires a due date", () => {
    const r = parseTaskArgs('"Task" @alice');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/due date/i);
  });

  it("rejects a malformed date", () => {
    expect(parseTaskArgs('"Task" @alice 06/15/2026').ok).toBe(false);
    expect(parseTaskArgs('"Task" @alice 2026-6-15').ok).toBe(false);
  });

  it("rejects an impossible calendar date", () => {
    expect(parseTaskArgs('"Task" @alice 2026-02-30').ok).toBe(false);
    expect(parseTaskArgs('"Task" @alice 2026-13-01').ok).toBe(false);
  });

  it("rejects a negative or non-integer point reward", () => {
    expect(parseTaskArgs('"Task" @alice 2026-06-15 -5').ok).toBe(false);
    expect(parseTaskArgs('"Task" @alice 2026-06-15 2.5').ok).toBe(false);
    expect(parseTaskArgs('"Task" @alice 2026-06-15 abc').ok).toBe(false);
  });

  it("returns an error on an unterminated quote", () => {
    const r = parseTaskArgs('"Task @alice 2026-06-15');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/quote/i);
  });
});

describe("parseEventArgs", () => {
  it("parses name, date, time range, location, and points", () => {
    const r = parseEventArgs(
      '"Spring Formal" 2026-06-12 20:00-22:00 Chapter House points=15',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: "Spring Formal",
      date: "2026-06-12",
      startTime: "20:00",
      endTime: "22:00",
      location: "Chapter House",
      pointValue: 15,
    });
  });

  it("treats location and points as optional", () => {
    const r = parseEventArgs('"Meeting" 2026-06-12 18:00-19:00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.location).toBeNull();
    expect(r.value.pointValue).toBeNull();
  });

  it("accepts points= anywhere in the tail and joins the rest as location", () => {
    const r = parseEventArgs('"Mixer" 2026-06-12 20:00-22:00 points=5 The Quad');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pointValue).toBe(5);
    expect(r.value.location).toBe("The Quad");
  });

  it("accepts a single-digit hour", () => {
    const r = parseEventArgs('"Breakfast" 2026-06-12 8:00-9:30');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startTime).toBe("8:00");
    expect(r.value.endTime).toBe("9:30");
  });

  it("rejects an empty name", () => {
    expect(parseEventArgs('"" 2026-06-12 20:00-22:00').ok).toBe(false);
  });

  it("rejects a missing or malformed date", () => {
    expect(parseEventArgs('"E" 20:00-22:00').ok).toBe(false);
    expect(parseEventArgs('"E" 06/12/2026 20:00-22:00').ok).toBe(false);
    expect(parseEventArgs('"E" 2026-02-30 20:00-22:00').ok).toBe(false);
  });

  it("rejects a missing or malformed time range", () => {
    expect(parseEventArgs('"E" 2026-06-12').ok).toBe(false);
    expect(parseEventArgs('"E" 2026-06-12 2000-2200').ok).toBe(false);
    expect(parseEventArgs('"E" 2026-06-12 25:00-26:00').ok).toBe(false);
  });

  it("rejects an end at or before the start", () => {
    expect(parseEventArgs('"E" 2026-06-12 22:00-20:00').ok).toBe(false);
    expect(parseEventArgs('"E" 2026-06-12 20:00-20:00').ok).toBe(false);
  });

  it("rejects a negative or non-integer points value", () => {
    expect(parseEventArgs('"E" 2026-06-12 20:00-22:00 points=-1').ok).toBe(
      false,
    );
    expect(parseEventArgs('"E" 2026-06-12 20:00-22:00 points=2.5').ok).toBe(
      false,
    );
    expect(parseEventArgs('"E" 2026-06-12 20:00-22:00 points=abc').ok).toBe(
      false,
    );
  });

  it("returns an error on an unterminated quote", () => {
    const r = parseEventArgs('"Formal 2026-06-12 20:00-22:00');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/quote/i);
  });
});


describe("parsePointsArgs reason cap", () => {
  it("imports POINTS_REASON_MAX_LENGTH from @repo/validation at the 500-char pin", () => {
    // Drift detector: if the shared constant moves, this pin fails until the
    // parser spec (and the API DTO that shares it) are updated together.
    expect(POINTS_REASON_MAX_LENGTH).toBe(500);
  });

  it("accepts a reason of exactly POINTS_REASON_MAX_LENGTH and rejects one more", () => {
    const atCap = parsePointsArgs(
      `grant @alice 5 for ${"x".repeat(POINTS_REASON_MAX_LENGTH)}`,
    );
    expect(atCap.ok).toBe(true);

    const over = parsePointsArgs(
      `grant @alice 5 for ${"x".repeat(POINTS_REASON_MAX_LENGTH + 1)}`,
    );
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error).toContain(String(POINTS_REASON_MAX_LENGTH));
  });
});

describe("parseHoursArgs", () => {
  it("parses 2h as 120 minutes", () => {
    const parsed = parseHoursArgs("log 2h Community cleanup");
    expect(parsed).toEqual({
      ok: true,
      value: { durationMinutes: 120, description: "Community cleanup" },
    });
  });

  it("parses 2.5h as 150 minutes", () => {
    const parsed = parseHoursArgs("log 2.5h Park cleanup");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.durationMinutes).toBe(150);
  });

  it("parses 90m and 90min as minutes", () => {
    expect(parseHoursArgs("log 90m Tutoring")).toEqual({
      ok: true,
      value: { durationMinutes: 90, description: "Tutoring" },
    });
    expect(parseHoursArgs("log 90min Tutoring")).toEqual({
      ok: true,
      value: { durationMinutes: 90, description: "Tutoring" },
    });
  });

  it("treats a bare number as hours", () => {
    const parsed = parseHoursArgs("log 2 Habitat for Humanity");
    expect(parsed).toEqual({
      ok: true,
      value: { durationMinutes: 120, description: "Habitat for Humanity" },
    });
  });

  it("joins a quoted description", () => {
    const parsed = parseHoursArgs('log 2h "Park cleanup downtown"');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.description).toBe("Park cleanup downtown");
  });

  it("rejects an unknown action including review", () => {
    const parsed = parseHoursArgs("review pending");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/Unknown \/hours action/i);
    expect(parsed.error).toMatch(/Usage: \/hours log/);
  });

  it("rejects a missing description", () => {
    const parsed = parseHoursArgs("log 2h");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/description/i);
  });

  it("rejects zero and non-positive durations", () => {
    expect(parseHoursArgs("log 0h cleanup").ok).toBe(false);
    expect(parseHoursArgs("log 0 cleanup").ok).toBe(false);
    expect(parseHoursArgs("log -2h cleanup").ok).toBe(false);
  });

  it("rejects an unterminated quote", () => {
    const parsed = parseHoursArgs('log 2h "still open');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/Unterminated quote/);
  });

  it("rejects a description over 2000 characters", () => {
    const parsed = parseHoursArgs(`log 1h ${"x".repeat(2001)}`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("2000");
  });

  it("rejects a duration above the service-entry ceiling", () => {
    const parsed = parseHoursArgs("log 100001m Cleanup");
    expect(parsed.ok).toBe(false);
  });
});

describe("parseRushArgs", () => {
  it("parses add with an @name spanning spaces", () => {
    expect(parseRushArgs("add @Jane Doe")).toEqual({
      ok: true,
      value: { action: "add", displayName: "Jane Doe" },
    });
  });

  it("parses a quoted add name", () => {
    expect(parseRushArgs('add "Jane Doe"')).toEqual({
      ok: true,
      value: { action: "add", displayName: "Jane Doe" },
    });
  });

  it("parses vote with a UUID", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseRushArgs(`vote ${id}`)).toEqual({
      ok: true,
      value: { action: "vote", candidateId: id },
    });
  });

  it("parses vote with a name token", () => {
    expect(parseRushArgs("vote @Jane")).toEqual({
      ok: true,
      value: { action: "vote", candidateToken: "Jane" },
    });
  });

  it("parses bid with a name", () => {
    expect(parseRushArgs("bid @Jane Doe")).toEqual({
      ok: true,
      value: { action: "bid", candidateToken: "Jane Doe" },
    });
  });

  it("rejects a missing add name", () => {
    const parsed = parseRushArgs("add");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/candidate name/i);
  });

  it("rejects an unknown action without hardcoding /rush", () => {
    const parsed = parseRushArgs("review pending");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/Unknown action/i);
    expect(parsed.error).not.toMatch(/\/rush/i);
  });
});
