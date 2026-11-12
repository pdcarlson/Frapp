import { describe, expect, it } from "vitest";
import {
  activityStandingRows,
  localWeekStart,
  type ActivityStanding,
} from "./activity-standing";

const standing = (overrides: Partial<ActivityStanding>): ActivityStanding => ({
  points: { total: 42, rank: 5, ranked: 58 },
  required_events: { required: 8, attended: 6, excused: 1 },
  service: { approved_minutes: 270, pending_minutes: 90 },
  study: { minutes: 125, week_start: "2026-11-08T05:00:00.000Z" },
  unavailable: [],
  ...overrides,
});

describe("activityStandingRows", () => {
  it("draws every part in order, with a meter only on required events", () => {
    const rows = activityStandingRows(standing({}));
    expect(
      rows.map((row) => [row.label, row.value, row.detail, row.progress]),
    ).toEqual([
      ["Points", "42", "#5 of 58", null],
      ["Required events", "6 of 8", "1 excused", 0.75],
      ["Service hours", "4h 30m", "1h 30m pending", null],
      ["Study hours", "2h 5m", "This week", null],
    ]);
    expect(rows[1]?.spokenLabel).toBe(
      "Attended 6 of 8 required events this semester, 1 excused",
    );
  });

  it("leaves out a part the chapter has off", () => {
    const rows = activityStandingRows(
      standing({ points: null, service: null, study: null }),
    );
    expect(rows.map((row) => row.id)).toEqual(["required_events"]);
  });

  it("keeps a part that couldn't load, with no number", () => {
    const rows = activityStandingRows(
      standing({ service: null, unavailable: ["service"] }),
    );
    expect(rows.find((row) => row.id === "service")).toMatchObject({
      value: null,
      detail: "Couldn't load",
      progress: null,
    });
  });

  it("says None yet, with no meter, before any required event", () => {
    const row = activityStandingRows(
      standing({ required_events: { required: 0, attended: 0, excused: 0 } }),
    )[1];
    expect(row).toMatchObject({
      value: "None yet",
      detail: null,
      progress: null,
    });
  });

  it("names no place for a member off the board, and no pending line at zero", () => {
    const rows = activityStandingRows(
      standing({
        points: { total: 0, rank: null, ranked: 12 },
        service: { approved_minutes: 0, pending_minutes: 0 },
      }),
    );
    expect(rows[0]?.detail).toBeNull();
    expect(rows[2]?.detail).toBeNull();
  });
});

describe("localWeekStart", () => {
  it("is the last Sunday at local midnight", () => {
    // Thursday 12 November 2026, mid-afternoon local time.
    const start = localWeekStart(new Date(2026, 10, 12, 15, 30));
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([
      2026, 10, 8,
    ]);
    expect(start.getHours()).toBe(0);
  });

  it("is today on a Sunday", () => {
    expect(localWeekStart(new Date(2026, 10, 8, 9)).getDate()).toBe(8);
  });
});
