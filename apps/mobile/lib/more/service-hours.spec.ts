import { describe, expect, it } from "vitest";
import { formatMinutesRounded } from "@repo/formatting";
import {
  DURATION_STEP_MINUTES,
  MAX_DURATION_MINUTES,
  selectServiceEntryRows,
  serviceDatePresets,
  stepDuration,
  summarizeServiceEntries,
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

describe("formatMinutesRounded", () => {
  it("renders hours and minutes the way a member writes them", () => {
    expect(formatMinutesRounded(150)).toBe("2h 30m");
    expect(formatMinutesRounded(120)).toBe("2h");
    expect(formatMinutesRounded(45)).toBe("45m");
    expect(formatMinutesRounded(0)).toBe("0m");
  });

  it("never renders a negative duration", () => {
    expect(formatMinutesRounded(-30)).toBe("0m");
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

describe("stepDuration", () => {
  it("steps in half hours", () => {
    expect(stepDuration(60, 1)).toBe(90);
    expect(stepDuration(90, -1)).toBe(60);
  });

  // A zero-minute entry is not a submission, and a single shift longer than a
  // day is a slip of the thumb, not a shift.
  it("stops at half an hour and at a day", () => {
    expect(stepDuration(DURATION_STEP_MINUTES, -1)).toBe(DURATION_STEP_MINUTES);
    expect(stepDuration(MAX_DURATION_MINUTES, 1)).toBe(MAX_DURATION_MINUTES);
  });
});

describe("serviceDatePresets", () => {
  // Thursday 2026-11-05, mid-afternoon local time.
  const now = new Date(2026, 10, 5, 15, 30);

  it("offers today, yesterday and the two days before, newest first", () => {
    expect(serviceDatePresets(now)).toEqual([
      { daysAgo: 0, label: "Today", date: "2026-11-05" },
      { daysAgo: 1, label: "Yesterday", date: "2026-11-04" },
      {
        daysAgo: 2,
        label: new Date(2026, 10, 3).toLocaleDateString(undefined, {
          weekday: "short",
        }),
        date: "2026-11-03",
      },
      {
        daysAgo: 3,
        label: new Date(2026, 10, 2).toLocaleDateString(undefined, {
          weekday: "short",
        }),
        date: "2026-11-02",
      },
    ]);
  });

  it("crosses a month boundary by calendar day", () => {
    const dates = serviceDatePresets(new Date(2026, 2, 1, 0, 5)).map(
      (preset) => preset.date,
    );
    expect(dates).toEqual([
      "2026-03-01",
      "2026-02-28",
      "2026-02-27",
      "2026-02-26",
    ]);
  });
});
