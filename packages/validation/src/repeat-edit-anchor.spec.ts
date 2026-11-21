import { describe, expect, it, vi } from "vitest";

// The device's zone, pinned: `repeatEditAnchor` steps a legacy token on it.
vi.mock("./time-zone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./time-zone")>()),
  localTimeZone: () => "America/New_York",
}));

const { repeatEditAnchor } = await import("./repeat-draft");

describe("repeatEditAnchor on a legacy series", () => {
  // #4505: Thu 2027-02-25, 7 PM in New York; DST starts Sun 2027-03-14. The
  // API now makes a token's meetings on the saving officer's wall clock, so
  // the next meeting after the change is 7 PM EDT (23:00Z), not 00:00Z.
  it("reads the next meeting on the device's wall clock", () => {
    const anchor = repeatEditAnchor({
      headStart: new Date("2027-02-26T00:00:00Z"),
      headRule: "WEEKLY",
      shiftMs: 0,
      now: new Date("2027-03-15T12:00:00Z"),
    });
    expect(anchor.toISOString()).toBe("2027-03-18T23:00:00.000Z");
  });
});

// #4746: a series stepped in UTC (made before #4505, or by an officer with no
// zone on file) and edited after a DST change. Its rows are what the API
// splits from, so the anchor reads them rather than the pattern.
describe("repeatEditAnchor on a UTC-stepped legacy series", () => {
  // Thu 2027-02-25, 11:30 PM EST (04:30Z Fri). Stepped in UTC, the meeting
  // after DST starts is 04:30Z Fri 2027-03-19: 12:30 AM Friday in New York,
  // where the device's clock predicts 11:30 PM Thursday (03:30Z).
  const series = {
    headStart: new Date("2027-02-26T04:30:00Z"),
    headRule: "WEEKLY",
    shiftMs: 0,
    now: new Date("2027-03-15T12:00:00Z"),
  };
  const realNext = new Date("2027-03-19T04:30:00Z");

  it("anchors on the series' real next meeting", () => {
    expect(repeatEditAnchor({ ...series, nextStart: realNext })).toEqual(
      realNext,
    );
  });

  it("moves the real next meeting by the save's shift", () => {
    const hour = 60 * 60 * 1000;
    expect(
      repeatEditAnchor({ ...series, shiftMs: hour, nextStart: realNext }),
    ).toEqual(new Date(realNext.getTime() + hour));
  });

  it("predicts from the pattern without the rows", () => {
    expect(repeatEditAnchor(series).toISOString()).toBe(
      "2027-03-19T03:30:00.000Z",
    );
    expect(repeatEditAnchor({ ...series, nextStart: null }).toISOString()).toBe(
      "2027-03-19T03:30:00.000Z",
    );
  });

  it("ignores the rows while the head is still to come", () => {
    expect(
      repeatEditAnchor({
        ...series,
        now: new Date("2027-02-20T00:00:00Z"),
        nextStart: realNext,
      }),
    ).toEqual(series.headStart);
  });
});
