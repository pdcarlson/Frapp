import { describe, expect, it } from "vitest";
import { suggestTaskOwner } from "./task-suggestion-guess";

const members = [
  { user_id: "u-jake", display_name: "Jake Ross" },
  { user_id: "u-jake2", display_name: "Jake Moore" },
  { user_id: "u-sam", display_name: "sam lee" },
  { user_id: "u-mark", display_name: "Mark Diaz" },
  { user_id: "u-grant", display_name: "Grant Hall" },
];

describe("suggestTaskOwner", () => {
  it("names the one member a line names by first name, whatever case the roster uses", () => {
    expect(suggestTaskOwner("Sam to book the bus", members)).toBe("u-sam");
    expect(suggestTaskOwner("Ask Sam's roommate for the key", members)).toBe(
      "u-sam",
    );
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

  it("reads a verb that opens the line as a verb, not a name", () => {
    expect(
      suggestTaskOwner("Mark the formal on the calendar", members),
    ).toBeNull();
    expect(suggestTaskOwner("Grant access to the drive", members)).toBeNull();
    expect(suggestTaskOwner("Mark will reserve the hall", members)).toBe(
      "u-mark",
    );
    expect(
      suggestTaskOwner("Reserve the hall. Mark to confirm.", members),
    ).toBe("u-mark");
  });
});
