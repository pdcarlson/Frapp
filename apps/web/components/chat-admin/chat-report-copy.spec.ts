import { describe, it, expect } from "vitest";
import { formatLocaleDate } from "@repo/formatting";
import { CHAT_REPORT_TABS, reportAge } from "./chat-report-copy";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

describe("reportAge", () => {
  it("reads the first minute as just now", () => {
    expect(reportAge(ago(59_000), NOW)).toBe("just now");
  });

  it("reads a clock skewed into the future as just now, never as 'in 2 minutes'", () => {
    expect(reportAge(ago(-2 * MINUTE), NOW)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(reportAge(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
    expect(reportAge(ago(3 * 60 * MINUTE), NOW)).toBe("3 hours ago");
    expect(reportAge(ago(24 * 60 * MINUTE), NOW)).toBe("yesterday");
    expect(reportAge(ago(4 * 24 * 60 * MINUTE), NOW)).toBe("4 days ago");
  });

  it("falls back to a date past thirty days", () => {
    const old = ago(45 * 24 * 60 * MINUTE);
    expect(reportAge(old, NOW)).toBe(formatLocaleDate(old));
  });

  it("renders nothing for an unparseable timestamp rather than 'NaN minutes ago'", () => {
    expect(reportAge("not a date", NOW)).toBe("");
  });
});

describe("CHAT_REPORT_TABS", () => {
  it("covers every report status exactly once, open first", () => {
    expect(CHAT_REPORT_TABS.map((tab) => tab.status)).toEqual([
      "open",
      "reviewed",
      "actioned",
      "dismissed",
    ]);
  });
});
