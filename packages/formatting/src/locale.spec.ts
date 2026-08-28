import { describe, expect, it } from "vitest";
import { formatClock, formatLocaleDate, formatLocaleDateTime } from "./locale";

describe("formatLocaleDateTime", () => {
  it("returns an em dash for missing or unparseable values", () => {
    expect(formatLocaleDateTime(undefined)).toBe("—");
    expect(formatLocaleDateTime(null)).toBe("—");
    expect(formatLocaleDateTime("")).toBe("—");
    expect(formatLocaleDateTime(123)).toBe("—");
    expect(formatLocaleDateTime("not-a-date")).toBe("—");
  });

  it("matches toLocaleString for a parseable instant", () => {
    const value = "2026-08-16T17:09:00.000Z";
    expect(formatLocaleDateTime(value)).toBe(new Date(value).toLocaleString());
  });
});

describe("formatLocaleDate", () => {
  it("returns an em dash for missing or unparseable values", () => {
    expect(formatLocaleDate(undefined)).toBe("—");
    expect(formatLocaleDate("")).toBe("—");
    expect(formatLocaleDate("nope")).toBe("—");
  });

  it("matches toLocaleDateString for a parseable instant", () => {
    const value = "2026-08-16T17:09:00.000Z";
    expect(formatLocaleDate(value)).toBe(new Date(value).toLocaleDateString());
  });
});

describe("formatClock", () => {
  it("returns an empty string for missing or unparseable values", () => {
    expect(formatClock(undefined)).toBe("");
    expect(formatClock(null)).toBe("");
    expect(formatClock("")).toBe("");
    expect(formatClock("later")).toBe("");
  });

  it("includes hour, minute, month, and day options", () => {
    const value = new Date(2026, 7, 16, 17, 9).toISOString();
    const rendered = formatClock(value);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toBe(
      new Date(value).toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      }),
    );
  });
});
