import { describe, it, expect } from "vitest";
import {
  parsePollArgs,
  parseAnnounceArgs,
  tokenizeQuotedArgs,
} from "@repo/chat-integrations";

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
