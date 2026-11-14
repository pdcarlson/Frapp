import { describe, expect, it } from "vitest";
import {
  activityRecapCard,
  recapInSeason,
  weekRange,
  type ActivityRecap,
} from "./activity-recap";

// Local dates, so the range reads the same in any time zone the tests run in.
const START = new Date(2026, 10, 8);
const END = new Date(2026, 10, 15);

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
    const card = activityRecapCard(recap({}));
    expect(card?.range).toBe("Nov 8 – 14");
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
    );
    expect(card?.figures[0]).toMatchObject({
      figure: "-5",
      spokenLabel: "5 points lost",
    });
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
      ),
    ).toBeNull();
  });
});

describe("weekRange", () => {
  it("names the month once inside a month and twice across one", () => {
    expect(weekRange(START, END)).toBe("Nov 8 – 14");
    expect(weekRange(new Date(2026, 9, 25), new Date(2026, 10, 1))).toBe(
      "Oct 25 – 31",
    );
    expect(weekRange(new Date(2026, 10, 29), new Date(2026, 11, 6))).toBe(
      "Nov 29 – Dec 5",
    );
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
