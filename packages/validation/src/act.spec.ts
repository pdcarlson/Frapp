import { describe, expect, it } from "vitest";
import {
  actPointsEdits,
  actAttendanceLine,
  actConfirmRefusalLine,
  ACT_ACTIONS,
  ACT_COPY,
  actActionLabel,
  actMissingLine,
  actNoteLine,
  actPointsDoneLine,
  actPointsHeadline,
  actPointsTotalLine,
  actWhenLine,
  actEventPointsInput,
  actEventPointsLine,
  actPointsAction,
  actPointsFromLine,
  actRepeatParts,
  actWhenParts,
} from "./act";
import { proposedRepeatDraft } from "./repeat-draft";

describe("the acting agent's words", () => {
  it("says the size of a points change plainly", () => {
    expect(actPointsHeadline(5, 42)).toBe("Give 5 points to 42 members");
    expect(actPointsHeadline(-10, 1)).toBe("Take 10 points away from 1 member");
    expect(actPointsHeadline(1, 2)).toBe("Give 1 point to 2 members");
    expect(actPointsTotalLine(5, 42)).toBe(
      "210 points in all, in 42 separate changes.",
    );
    expect(actPointsTotalLine(5, 1)).toBe("");
  });

  it("says what was done, and who was left out", () => {
    expect(actPointsDoneLine(5, 42, 0)).toBe("Gave 5 points to 42 members.");
    expect(actPointsDoneLine(-5, 3, 1)).toBe(
      "Took 5 points away from 3 members. 1 member was left out because they are no longer in the chapter.",
    );
  });

  it("writes an event's time out in full", () => {
    expect(
      actWhenLine(
        "2026-11-18T00:00:00.000Z",
        "2026-11-18T01:00:00.000Z",
        "America/New_York",
      ),
    ).toBe("Tuesday, November 17, 7:00 PM to 8:00 PM");
    expect(
      actWhenLine(
        "2026-12-06T02:00:00.000Z",
        "2026-12-06T06:00:00.000Z",
        "America/New_York",
      ),
    ).toBe("Saturday, December 5, 9:00 PM to Sunday, December 6, 1:00 AM");
    expect(actWhenLine("soon", "later")).toBe("");
  });

  it("puts each note in words, and skips one it does not know", () => {
    expect(
      actNoteLine({
        type: "matched_name",
        name: "Jake",
        matched: "Jacob Miller",
      }),
    ).toBe('"Jake" was read as Jacob Miller. Check that is who you meant.');
    expect(
      actNoteLine({ type: "role_members", name: "pledges", count: 1 }),
    ).toBe('"pledges" was read as the role, which 1 member holds.');
    expect(actNoteLine({ type: "self_left_out" })).toBe(ACT_COPY.self_left_out);
    expect(actNoteLine({ type: "something_new" })).toBeNull();
  });

  it("falls back for a value a newer server sends", () => {
    expect(actMissingLine("something_new")).toBe(ACT_COPY.missing.request);
    expect(actMissingLine("amount")).toBe(ACT_COPY.missing.amount);
    expect(actActionLabel("something_new")).toBeNull();
  });

  it("has a label for every action", () => {
    for (const action of ACT_ACTIONS) {
      expect(actActionLabel(action)).toBeTruthy();
    }
  });

  it("says whose attendance a points card was read from", () => {
    expect(
      actAttendanceLine("Chapter Meeting", "2026-11-12T23:00:00.000Z", "UTC"),
    ).toBe(
      "Everyone marked present or late at Chapter Meeting, Thursday, November 12",
    );
    expect(actAttendanceLine(null, null)).toBe("");
  });

  it("has words for each Confirm refusal the API names", () => {
    expect(actConfirmRefusalLine("ai.suggestion.points.partial")).toContain(
      "Confirm again",
    );
    expect(actConfirmRefusalLine("something.else")).toBeNull();
  });
});

describe("a proposal's Edit and repeat (#5117)", () => {
  const WEEKLY =
    "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=13;TZID=America/New_York";

  it("writes a series out, with the year only when it runs into the next", () => {
    expect(actRepeatParts(WEEKLY, "2026-11-15T23:48:00.000Z")).toEqual({
      line: "Every Sunday until February 7, 2027",
      count: "13 times",
    });
    expect(
      actRepeatParts(
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=3;TZID=America/New_York",
        "2026-09-02T23:00:00.000Z",
      ),
    ).toEqual({
      line: "Every other Wednesday until September 30",
      count: "3 times",
    });
    expect(actRepeatParts(null, "2026-11-15T23:48:00.000Z")).toBeNull();
    expect(actRepeatParts("WEEKLY", "2026-11-15T23:48:00.000Z")).toBeNull();
  });

  it("reads a points card's fields into only what changed", () => {
    const proposed = { amount: 5, reason: "Came to chapter" };
    expect(actPointsEdits(proposed, "5", "Came to chapter")).toEqual({
      ok: true,
      edits: {},
    });
    expect(actPointsEdits(proposed, " -1,000 ", "Skipped chapter ")).toEqual({
      ok: true,
      edits: { amount: -1000, reason: "Skipped chapter" },
    });
    for (const typed of ["0", "2.5", "", "five", "100001"]) {
      expect(actPointsEdits(proposed, typed, "x")).toMatchObject({
        ok: false,
        field: "amount",
      });
    }
    expect(actPointsEdits(proposed, "5", "  ")).toMatchObject({
      ok: false,
      field: "reason",
    });
  });

  it("opens a proposed series in the form following its first meeting", () => {
    const draft = proposedRepeatDraft(WEEKLY);
    expect(draft).toMatchObject({
      preset: "WEEKLY",
      byDay: null,
      countInput: "13",
      timeZone: "America/New_York",
      source: null,
      pristine: false,
    });
    expect(proposedRepeatDraft(null).preset).toBe("NONE");
  });
});

describe("the redesigned card's lines (#5148)", () => {
  const WEEKLY =
    "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=13;TZID=America/New_York";

  it("names the action on the button", () => {
    expect(actPointsAction(5)).toBe("Give 5 points");
    expect(actPointsAction(-1)).toBe("Take away 1 point");
  });

  it("says points plainly, and per time for a series", () => {
    expect(actEventPointsLine(10, false)).toBe("10 points");
    expect(actEventPointsLine(10, true)).toBe("10 points each time");
    expect(actEventPointsLine(0, true)).toBe("No points");
  });

  it("says where copied points came from", () => {
    expect(actPointsFromLine({ kind: "type", name: "Chapter meeting" })).toBe(
      "From your Chapter meeting event type",
    );
    expect(actPointsFromLine({ kind: "event", name: "Study hours" })).toBe(
      "Same as your last Study hours",
    );
    expect(actPointsFromLine(null)).toBe("");
  });

  it("reads typed points as a whole number from 0", () => {
    expect(actEventPointsInput(" 10 ")).toEqual({ ok: true, value: 10 });
    expect(actEventPointsInput("0")).toEqual({ ok: true, value: 0 });
    for (const bad of ["", "-5", "2.5", "ten"]) {
      expect(actEventPointsInput(bad)).toEqual({
        ok: false,
        error: ACT_COPY.bad_event_points,
      });
    }
  });

  it("splits a time into the date tile and one short range", () => {
    const parts = actWhenParts(
      "2026-11-15T23:48:00.000Z",
      "2026-11-16T00:48:00.000Z",
      "America/New_York",
    );
    expect(parts?.weekday).toBe("SUN");
    expect(parts?.day).toBe("15");
    expect(parts?.date).toBe("Sunday, November 15");
    expect(parts?.times.replace(/\s/g, " ")).toBe("6:48 to 7:48 PM");
    expect(actWhenParts("not a date", "", "America/New_York")).toBeNull();
  });

  it("splits a series into its pattern and its count", () => {
    expect(actRepeatParts(WEEKLY, "2026-11-15T23:48:00.000Z")).toEqual({
      line: "Every Sunday until February 7, 2027",
      count: "13 times",
    });
    expect(actRepeatParts(null, "2026-11-15T23:48:00.000Z")).toBeNull();
  });
});
