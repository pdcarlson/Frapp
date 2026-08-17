import { describe, expect, it } from "vitest";
import {
  formatDuration,
  parseDurationInput,
  selectServiceEntryRows,
  summarizeServiceEntries,
  todayIsoDate,
} from "./service-hours";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    description: "Food bank shift",
    status: "APPROVED",
    duration_minutes: 150,
    date: "2026-08-12",
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("renders hours and minutes the way a member writes them", () => {
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("never renders a negative duration", () => {
    expect(formatDuration(-30)).toBe("0m");
  });
});

describe("selectServiceEntryRows", () => {
  it("narrows an entry into a drawable row", () => {
    const [row] = selectServiceEntryRows([entry()]);
    expect(row?.id).toBe("s-1");
    expect(row?.status).toBe("APPROVED");
    expect(row?.durationMinutes).toBe(150);
    expect(row?.meta).toContain("2h 30m");
  });

  it("sorts newest first", () => {
    const rows = selectServiceEntryRows([
      entry({ id: "old", date: "2026-07-01" }),
      entry({ id: "new", date: "2026-08-20" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
  });

  // A `YYYY-MM-DD` parses as UTC midnight, which renders as the previous day
  // anywhere west of Greenwich — an entry dated the 12th must not show as the
  // 11th, so the selector parses at noon.
  it("renders the calendar date the member submitted, not the day before", () => {
    const [row] = selectServiceEntryRows([entry({ date: "2026-08-12" })]);
    expect(row?.meta).toContain("Aug 12");
  });

  it("drops a row whose status is not one the API defines", () => {
    expect(
      selectServiceEntryRows([
        entry({ id: "bogus", status: "ARCHIVED" }),
        entry({ id: "fine" }),
      ]).map((row) => row.id),
    ).toEqual(["fine"]);
  });

  it("falls back for a missing description rather than rendering blank", () => {
    const [row] = selectServiceEntryRows([entry({ description: "" })]);
    expect(row?.description).toBe("Service entry");
  });

  it("returns an empty list for an absent payload", () => {
    expect(selectServiceEntryRows(undefined)).toEqual([]);
  });
});

describe("summarizeServiceEntries", () => {
  // Approved only, matching `get_service_leaderboard` — pending time is not yet
  // credited, so counting it would overstate what the member has banked.
  it("banks approved time and counts pending separately", () => {
    const summary = summarizeServiceEntries(
      selectServiceEntryRows([
        entry({ id: "a", status: "APPROVED", duration_minutes: 150 }),
        entry({ id: "b", status: "APPROVED", duration_minutes: 960 }),
        entry({ id: "c", status: "PENDING", duration_minutes: 600 }),
        entry({ id: "d", status: "REJECTED", duration_minutes: 600 }),
      ]),
    );

    expect(summary.approvedMinutes).toBe(1110);
    expect(summary.approvedHours).toBe("18.5");
    expect(summary.pendingCount).toBe(1);
  });

  it("reads zero for a member with no entries", () => {
    expect(summarizeServiceEntries([])).toEqual({
      approvedMinutes: 0,
      approvedHours: "0",
      pendingCount: 0,
    });
  });
});

describe("parseDurationInput", () => {
  // Both forms because members write both — "1:30" and "1.5" are the same shift,
  // and rejecting one would be a validation error over nothing.
  it("accepts clock and decimal forms alike", () => {
    expect(parseDurationInput("1:30")).toBe(90);
    expect(parseDurationInput("1.5")).toBe(90);
    expect(parseDurationInput("2")).toBe(120);
    expect(parseDurationInput("0:45")).toBe(45);
    expect(parseDurationInput(" 3 ")).toBe(180);
  });

  it("accepts a bare decimal point, which a numeric keypad invites", () => {
    expect(parseDurationInput(".5")).toBe(30);
  });

  it("rejects anything that is not a duration", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("an hour")).toBeNull();
    expect(parseDurationInput("1:60")).toBeNull();
    expect(parseDurationInput("-1")).toBeNull();
  });

  // A bare number reads as hours, so "45" — a plausible way to mean 45 minutes
  // — would otherwise log 45 hours against a member with no way to correct it.
  it("rejects a shift longer than a day", () => {
    expect(parseDurationInput("45")).toBeNull();
    expect(parseDurationInput("25:00")).toBeNull();
    expect(parseDurationInput("24")).toBe(1440);
    expect(parseDurationInput("23:59")).toBe(1439);
  });

  // A zero-minute entry is not a submission — the sheet should stay blocked
  // rather than POST something the reviewer has to reject.
  it("rejects zero", () => {
    expect(parseDurationInput("0")).toBeNull();
    expect(parseDurationInput("0:00")).toBeNull();
  });
});

describe("todayIsoDate", () => {
  // The device's own calendar day, not UTC's: a member logging at 8pm Eastern
  // must not have their entry dated tomorrow.
  it("formats the local calendar day", () => {
    const local = new Date(2026, 7, 12, 20, 30);
    expect(todayIsoDate(local)).toBe("2026-08-12");
  });

  it("zero-pads single-digit months and days", () => {
    expect(todayIsoDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});
