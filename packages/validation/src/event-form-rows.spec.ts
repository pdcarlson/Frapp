import { describe, expect, it } from "vitest";
import {
  EVENT_FORM_ROWS,
  EVENT_FORM_ROW_LABELS,
  describeCheckIn,
  describeEventTypeSets,
  type EventFormRow,
} from "./event-form-rows";

describe("the event form's rows (#5561)", () => {
  it("names every row, in the order both apps draw them", () => {
    // Notes takes its name from the meetings module (#4934), so each app
    // names it; it sits after Description.
    expect(EVENT_FORM_ROWS.indexOf("notes")).toBe(
      EVENT_FORM_ROWS.indexOf("description") + 1,
    );
    expect(
      EVENT_FORM_ROWS.filter(
        (row): row is Exclude<EventFormRow, "notes"> => row !== "notes",
      ).map(
        (row) => EVENT_FORM_ROW_LABELS[row],
      ),
    ).toEqual([
      "Type",
      "When",
      "Repeat",
      "Location",
      "Who's coming",
      "Points",
      "Description",
      "Check-in",
    ]);
  });
});

describe("describeEventTypeSets", () => {
  it("says the points and whether the type makes everyone required", () => {
    expect(describeEventTypeSets({ point_value: 10, is_mandatory: true })).toBe(
      "10 points · Required",
    );
    expect(describeEventTypeSets({ point_value: 1, is_mandatory: false })).toBe(
      "1 point",
    );
    expect(describeEventTypeSets({ point_value: 0, is_mandatory: false })).toBe(
      "No points",
    );
  });
});

describe("describeCheckIn", () => {
  it("says when check-in opens, and that a zone is drawn", () => {
    expect(describeCheckIn(10)).toBe("Opens 10 minutes early");
    expect(describeCheckIn(1)).toBe("Opens 1 minute early");
    expect(describeCheckIn(0, true)).toBe("Opens at the start · In a zone");
  });

  it("asks for a fix when the field holds what it refuses", () => {
    expect(describeCheckIn(null)).toBe("Opening time needs a fix");
  });
});
