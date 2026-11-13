import { describe, expect, it } from "vitest";
import {
  activityStandingGauges,
  activityStandingRows,
  localWeekStart,
  type ActivityStanding,
} from "./activity-standing";

const standing = (overrides: Partial<ActivityStanding>): ActivityStanding => ({
  points: { total: 42, rank: 5, ranked: 58, goal: null },
  required_events: { required: 8, attended: 6, excused: 1 },
  service: { approved_minutes: 270, pending_minutes: 90, goal_minutes: null },
  study: {
    minutes: 125,
    week_start: "2026-11-08T05:00:00.000Z",
    goal_minutes: null,
  },
  unavailable: [],
  ...overrides,
});

describe("activityStandingRows", () => {
  it("measures points and hours against the member's goals", () => {
    const rows = activityStandingRows(
      standing({
        points: { total: 42, rank: 5, ranked: 58, goal: 60 },
        service: {
          approved_minutes: 270,
          pending_minutes: 0,
          goal_minutes: 600,
        },
        study: {
          minutes: 500,
          week_start: "2026-11-08T05:00:00.000Z",
          goal_minutes: 360,
        },
      }),
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.points).toMatchObject({
      value: "42 of 60",
      detail: "#5 of 58",
      progress: 0.7,
      spokenLabel: "42 of 60 points this semester, ranked 5 of 58",
    });
    expect(byId.service).toMatchObject({
      value: "4h 30m of 10h",
      progress: 0.45,
      spokenLabel: "4h 30m of 10h of service approved this semester",
    });
    // Past the goal, the bar stays full and the count says by how much.
    expect(byId.study).toMatchObject({
      value: "8h 20m of 6h",
      progress: 1,
    });
  });

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

  it("draws no goal from an older API that sends no goal fields", () => {
    const rows = activityStandingRows({
      points: { total: 42, rank: 5, ranked: 58 },
      required_events: { required: 8, attended: 6, excused: 1 },
      service: { approved_minutes: 270, pending_minutes: 90 },
      study: { minutes: 125, week_start: "2026-11-08T05:00:00.000Z" },
      unavailable: [],
    } as unknown as ActivityStanding);
    expect(rows.map((row) => [row.id, row.value, row.progress])).toEqual([
      ["points", "42", null],
      ["required_events", "6 of 8", 0.75],
      ["service", "4h 30m", null],
      ["study", "2h 5m", null],
    ]);
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
        points: { total: 0, rank: null, ranked: 12, goal: null },
        service: {
          approved_minutes: 0,
          pending_minutes: 0,
          goal_minutes: null,
        },
      }),
    );
    expect(rows[0]?.detail).toBeNull();
    expect(rows[2]?.detail).toBeNull();
  });
});

describe("activityStandingGauges (#4766)", () => {
  it("splits each number from its target, under a one-word label", () => {
    const gauges = activityStandingGauges(
      standing({
        points: { total: 45, rank: 3, ranked: 23, goal: 150 },
        service: {
          approved_minutes: 240,
          pending_minutes: 0,
          goal_minutes: 600,
        },
      }),
    );
    expect(
      gauges.map((gauge) => [
        gauge.shortLabel,
        gauge.figure,
        gauge.target,
        gauge.progress,
      ]),
    ).toEqual([
      ["Points", "45", "of 150", 0.3],
      ["Events", "6", "of 8", 0.75],
      ["Service", "4h", "of 10h", 0.4],
      // No goal: the number stands alone, with no ring.
      ["Study", "2h 5m", null, null],
    ]);
  });

  it("leaves out a zero with nothing to aim at, and keeps a zero with a goal", () => {
    const gauges = activityStandingGauges(
      standing({
        points: { total: 0, rank: null, ranked: 23, goal: null },
        required_events: { required: 0, attended: 0, excused: 0 },
        service: { approved_minutes: 0, pending_minutes: 0, goal_minutes: 600 },
        study: {
          minutes: 0,
          week_start: "2026-11-08T05:00:00.000Z",
          goal_minutes: null,
        },
      }),
    );
    expect(gauges.map((gauge) => gauge.id)).toEqual(["service"]);
    expect(gauges[0]).toMatchObject({ figure: "0m", progress: 0 });
  });

  it("keeps hours still pending, and a part that couldn't be read", () => {
    const gauges = activityStandingGauges(
      standing({
        points: null,
        required_events: { required: 0, attended: 0, excused: 0 },
        service: {
          approved_minutes: 0,
          pending_minutes: 90,
          goal_minutes: null,
        },
        study: null,
        unavailable: ["points"],
      } as unknown as Partial<ActivityStanding>),
    );
    expect(
      gauges.map((gauge) => [gauge.id, gauge.figure, gauge.detail]),
    ).toEqual([
      ["points", null, "Couldn't load"],
      ["service", "0m", "1h 30m pending"],
    ]);
  });

  it("is empty for a new member in a chapter with no goals", () => {
    expect(
      activityStandingGauges(
        standing({
          points: { total: 0, rank: null, ranked: 0, goal: null },
          required_events: { required: 0, attended: 0, excused: 0 },
          service: {
            approved_minutes: 0,
            pending_minutes: 0,
            goal_minutes: null,
          },
          study: {
            minutes: 0,
            week_start: "2026-11-08T05:00:00.000Z",
            goal_minutes: null,
          },
        }),
      ),
    ).toEqual([]);
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
