import { describe, expect, it } from "vitest";
import {
  parseBareDateLocalMidnight,
  parseBareDateUtcNoon,
  parseInstantOrBareUtcNoon,
} from "./bare-date";

describe("parseBareDateUtcNoon", () => {
  it("parses YYYY-MM-DD at 12:00 UTC", () => {
    const date = parseBareDateUtcNoon("2026-08-12");
    expect(date).not.toBeNull();
    expect(date?.getUTCDate()).toBe(12);
    expect(date?.getUTCHours()).toBe(12);
  });

  it("returns null for a full timestamp", () => {
    expect(parseBareDateUtcNoon("2026-08-12T19:02:00.000Z")).toBeNull();
  });
});

describe("parseBareDateLocalMidnight", () => {
  it("parses YYYY-MM-DD at local midnight", () => {
    const date = parseBareDateLocalMidnight("2026-08-12");
    expect(date).not.toBeNull();
    expect(date?.getDate()).toBe(12);
    expect(date?.getHours()).toBe(0);
    expect(date?.getMinutes()).toBe(0);
  });

  it("returns null for a full timestamp", () => {
    expect(parseBareDateLocalMidnight("2026-08-12T19:02:00.000Z")).toBeNull();
  });
});

describe("parseInstantOrBareUtcNoon", () => {
  it("uses UTC noon for a bare date", () => {
    const date = parseInstantOrBareUtcNoon("2026-08-12");
    expect(date?.getUTCHours()).toBe(12);
  });

  it("passes a full timestamp through", () => {
    const value = "2026-08-12T19:02:00.000Z";
    expect(parseInstantOrBareUtcNoon(value)?.toISOString()).toBe(value);
  });

  it("returns null for garbage", () => {
    expect(parseInstantOrBareUtcNoon("later")).toBeNull();
  });
});
