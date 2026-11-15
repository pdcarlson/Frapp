import { describe, expect, it } from "vitest";
import { recapFigures } from "./recap-figures";

const none = {
  events_attended: 0,
  tasks_done: 0,
  points: 0,
  service_minutes: 0,
  study_minutes: 0,
};

describe("recapFigures", () => {
  it("words each part, leaving out what is off or zero", () => {
    expect(
      recapFigures({
        events_attended: 3,
        tasks_done: 1,
        points: 15,
        service_minutes: 240,
        study_minutes: 90,
      }).map((figure) => figure.spokenLabel),
    ).toEqual([
      "3 events attended",
      "1 task done",
      "15 points earned",
      "4h of service",
      "1h 30m studied",
    ]);
    expect(
      recapFigures({ ...none, events_attended: null, points: -1 }),
    ).toEqual([
      {
        id: "points",
        figure: "-1",
        label: "point",
        spokenLabel: "1 point lost",
      },
    ]);
  });

  it("has nothing for a week with nothing in it", () => {
    expect(recapFigures(none)).toEqual([]);
  });
});
