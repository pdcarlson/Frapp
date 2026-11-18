import { describe, expect, it } from "vitest";
import { suggestTaskDue, suggestTaskOwner } from "./task-suggestion-guess";

const members = [
  { user_id: "u-jake", display_name: "Jake Ross" },
  { user_id: "u-jake2", display_name: "Jake Moore" },
  { user_id: "u-sam", display_name: "Sam Lee" },
  { user_id: "u-mark", display_name: "Mark Diaz" },
];

describe("suggestTaskOwner", () => {
  it("names the one member a line names by first name", () => {
    expect(suggestTaskOwner("Sam to book the bus", members)).toBe("u-sam");
  });

  it("leaves a first name two members share to the officer, unless the full name settles it", () => {
    expect(suggestTaskOwner("Jake to call the caterer", members)).toBeNull();
    expect(suggestTaskOwner("Jake Moore to call the caterer", members)).toBe(
      "u-jake2",
    );
  });

  it("names nobody when the line names two members, or only a lowercase word", () => {
    expect(suggestTaskOwner("Sam and Mark to sweep", members)).toBeNull();
    expect(
      suggestTaskOwner("mark the date on the calendar", members),
    ).toBeNull();
    expect(suggestTaskOwner("Order shirts", members)).toBeNull();
  });
});

describe("suggestTaskDue", () => {
  it("is a week after the meeting", () => {
    expect(
      suggestTaskDue("2026-11-09T19:00:00", new Date("2026-11-10T12:00:00")),
    ).toBe("2026-11-16");
  });

  it("is nothing for minutes old enough that the day has gone by, or with no meeting day", () => {
    expect(
      suggestTaskDue("2026-10-01T19:00:00", new Date("2026-11-10T12:00:00")),
    ).toBeNull();
    expect(suggestTaskDue(null)).toBeNull();
  });
});
