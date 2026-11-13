import { describe, expect, it } from "vitest";
import {
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
} from "./act";

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
