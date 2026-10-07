import { POINTS_REASON_MAX_LENGTH } from "@repo/validation";
import { describe, expect, it } from "vitest";
import { parseHoursArgs, parsePointsArgs, parseRushArgs } from "./parsers";

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
