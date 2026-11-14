import { describe, expect, it } from "vitest";
import {
  activityRecapCard,
  recapDismissalKey,
  recapDismissed,
  recapInSeason,
  recapWeek,
  weekRange,
  withRecapDismissal,
  type ActivityRecap,
} from "./activity-recap";

// Local dates, so the range reads the same in any time zone the tests run in.
const START = new Date(2026, 10, 8);
const END = new Date(2026, 10, 15);
// Monday of the week after: the card's season.
const MONDAY = new Date(2026, 10, 16, 9);

const recap = (overrides: Partial<ActivityRecap>): ActivityRecap => ({
  start: START.toISOString(),
  end: END.toISOString(),
  events_attended: 3,
  tasks_done: 1,
  points: 40,
  service_minutes: 90,
  study_minutes: 270,
  unavailable: [],
  ...overrides,
});

describe("activityRecapCard", () => {
  it("draws a figure per part, in order, with the week's range", () => {
    const card = activityRecapCard(recap({}), MONDAY);
    expect(card?.range).toBe("Nov 8 – Nov 14");
    expect(card?.dismissKey).toBe(END.toISOString());
    expect(card?.figures).toEqual([
      {
        id: "events",
        figure: "3",
        label: "events",
        spokenLabel: "3 events attended",
      },
      {
        id: "tasks",
        figure: "1",
        label: "task done",
        spokenLabel: "1 task done",
      },
      {
        id: "points",
        figure: "+40",
        label: "points",
        spokenLabel: "40 points earned",
      },
      {
        id: "service",
        figure: "1h 30m",
        label: "service",
        spokenLabel: "1h 30m of service",
      },
      {
        id: "study",
        figure: "4h 30m",
        label: "studied",
        spokenLabel: "4h 30m studied",
      },
    ]);
  });

  it("leaves out a part that is off, unread or zero", () => {
    const card = activityRecapCard(
      recap({
        events_attended: null,
        tasks_done: 0,
        service_minutes: null,
        study_minutes: 0,
        unavailable: ["service"],
      }),
      MONDAY,
    );
    expect(card?.figures.map((figure) => figure.id)).toEqual(["points"]);
  });

  it("says a net loss of points as a loss", () => {
    const card = activityRecapCard(
      recap({
        events_attended: 0,
        tasks_done: 0,
        points: -5,
        service_minutes: 0,
        study_minutes: 0,
      }),
      MONDAY,
    );
    expect(card?.figures[0]).toMatchObject({
      figure: "-5",
      spokenLabel: "5 points lost",
    });
  });

  it("is no card after Tuesday, whatever was read", () => {
    expect(activityRecapCard(recap({}), new Date(2026, 10, 18, 9))).toBeNull();
  });

  it("is no card when there is nothing to recap", () => {
    expect(
      activityRecapCard(
        recap({
          events_attended: 0,
          tasks_done: null,
          points: 0,
          service_minutes: null,
          study_minutes: null,
        }),
        MONDAY,
      ),
    ).toBeNull();
  });
});

describe("weekRange", () => {
  it("names the week's first and last day", () => {
    expect(weekRange(START, END)).toBe("Nov 8 – Nov 14");
    expect(weekRange(new Date(2026, 10, 29), new Date(2026, 11, 6))).toBe(
      "Nov 29 – Dec 5",
    );
  });
});

describe("recapWeek", () => {
  it("counts last Sunday on the calendar, so a clock change can't shift it", () => {
    const week = recapWeek(MONDAY);
    expect(week).toEqual({
      week_start: END.toISOString(),
      last_week_start: START.toISOString(),
      first_day: "2026-11-08",
    });
    // Local midnights, whatever the zone the tests run in.
    const start = new Date(week.last_week_start);
    expect([start.getHours(), start.getMinutes(), start.getDay()]).toEqual([
      0, 0, 0,
    ]);
  });
});

describe("recap dismissals", () => {
  const card = activityRecapCard(recap({}), MONDAY)!;

  it("keeps one chapter's dismissal from hiding another's, or next week's", () => {
    const a = recapDismissalKey("chapter-a", card);
    const stored = withRecapDismissal("", a);
    expect(recapDismissed(stored, a)).toBe(true);
    expect(recapDismissed(stored, recapDismissalKey("chapter-b", card))).toBe(
      false,
    );
    const nextWeek = activityRecapCard(
      recap({ end: new Date(2026, 10, 22).toISOString() }),
      MONDAY,
    )!;
    expect(
      recapDismissed(stored, recapDismissalKey("chapter-a", nextWeek)),
    ).toBe(false);
    expect(recapDismissed(null, a)).toBe(false);
  });

  it("keeps the newest few, once each", () => {
    let stored = "";
    for (let index = 0; index < 12; index += 1) {
      stored = withRecapDismissal(stored, `chapter-${index}@w`);
    }
    stored = withRecapDismissal(stored, "chapter-11@w");
    const keys = stored.split(" ");
    expect(keys).toHaveLength(8);
    expect(keys.at(-1)).toBe("chapter-11@w");
    expect(recapDismissed(stored, "chapter-0@w")).toBe(false);
  });
});

describe("recapInSeason", () => {
  it("is Sunday to Tuesday", () => {
    expect(recapInSeason(new Date(2026, 10, 15, 9))).toBe(true);
    expect(recapInSeason(new Date(2026, 10, 17, 23))).toBe(true);
    expect(recapInSeason(new Date(2026, 10, 18, 0))).toBe(false);
    expect(recapInSeason(new Date(2026, 10, 21))).toBe(false);
  });
});
