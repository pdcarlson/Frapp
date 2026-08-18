import { describe, expect, it } from "vitest";
import {
  dayDelta,
  formatDoneSubtitle,
  formatDueSubtitle,
  formatPointsChip,
  isDueUrgent,
} from "./format";

/**
 * Local-time constructors, not ISO strings with a zone: every label here comes
 * from `toLocaleDateString`, which reads the runtime's zone, so pinning an
 * offset would make these pass or fail on where CI runs. Same reasoning as
 * `lib/events/format.spec.ts`.
 */
function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

// 2026-08-17 is a Monday.
const NOW = at(2026, 8, 17);

describe("formatDueSubtitle", () => {
  it("counts overdue days, singular and plural", () => {
    expect(formatDueSubtitle("2026-08-14", NOW)).toBe("Overdue by 3 days");
    expect(formatDueSubtitle("2026-08-16", NOW)).toBe("Overdue by 1 day");
  });

  it("names today and tomorrow", () => {
    expect(formatDueSubtitle("2026-08-17", NOW)).toBe("Due today");
    expect(formatDueSubtitle("2026-08-18", NOW)).toBe("Due tomorrow");
  });

  it("uses a weekday inside the week and a date beyond it", () => {
    expect(formatDueSubtitle("2026-08-23", NOW)).toBe("Due Sunday");
    // Exactly 7 days out is where the weekday name stops being unambiguous.
    expect(formatDueSubtitle("2026-08-24", NOW)).toBe("Due Aug 24");
  });

  it("parses a bare date at UTC noon, so it never slips a day", () => {
    // 11pm local on the 17th is already the 18th in UTC.
    expect(formatDueSubtitle("2026-08-17", at(2026, 8, 17, 23))).toBe(
      "Due today",
    );
  });

  it("returns null rather than rendering an unreadable date", () => {
    expect(formatDueSubtitle(null, NOW)).toBeNull();
    expect(formatDueSubtitle("not-a-date", NOW)).toBeNull();
    expect(formatDueSubtitle("", NOW)).toBeNull();
  });
});

describe("isDueUrgent", () => {
  it("covers today, tomorrow and anything past", () => {
    expect(isDueUrgent("2026-08-17", NOW)).toBe(true);
    expect(isDueUrgent("2026-08-18", NOW)).toBe(true);
    expect(isDueUrgent("2026-08-10", NOW)).toBe(true);
  });

  it("leaves anything further out calm", () => {
    expect(isDueUrgent("2026-08-19", NOW)).toBe(false);
  });
});

describe("formatDoneSubtitle", () => {
  const iso = (date: Date) => date.toISOString();

  it("names the recent past", () => {
    expect(formatDoneSubtitle(iso(at(2026, 8, 17, 9)), NOW)).toBe("Done today");
    expect(formatDoneSubtitle(iso(at(2026, 8, 16)), NOW)).toBe("Done yesterday");
    expect(formatDoneSubtitle(iso(at(2026, 8, 11)), NOW)).toBe("Done Tuesday");
  });

  it("falls back to a date beyond a week", () => {
    expect(formatDoneSubtitle(iso(at(2026, 7, 28)), NOW)).toBe("Done Jul 28");
  });

  it("still says Done when the timestamp is missing or unreadable", () => {
    expect(formatDoneSubtitle(null, NOW)).toBe("Done");
    expect(formatDoneSubtitle("nonsense", NOW)).toBe("Done");
  });
});

describe("formatPointsChip", () => {
  it("draws no chip for a task carrying no reward", () => {
    expect(formatPointsChip(null, false)).toBeNull();
    expect(formatPointsChip(0, false)).toBeNull();
  });

  it("offers points in gold before the ledger moves", () => {
    expect(formatPointsChip(5, false)).toEqual({ tone: "offered", label: "+5" });
  });

  it("marks an award only once points_awarded is true", () => {
    expect(formatPointsChip(15, true)).toEqual({
      tone: "awarded",
      label: "+15 ✓",
    });
  });

  it("keeps a completed-but-unconfirmed task on the gold chip", () => {
    // The officer's confirm is what moves the ledger; the green check would
    // claim an award that has not happened.
    expect(formatPointsChip(15, false)).toEqual({
      tone: "offered",
      label: "+15",
    });
  });
});

describe("dayDelta", () => {
  it("counts calendar days, not elapsed hours", () => {
    expect(dayDelta(at(2026, 8, 17, 23), at(2026, 8, 18, 1))).toBe(1);
    expect(dayDelta(at(2026, 8, 17, 1), at(2026, 8, 17, 23))).toBe(0);
  });
});
