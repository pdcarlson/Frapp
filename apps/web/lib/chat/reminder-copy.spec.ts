import { describe, expect, it } from "vitest";
import { reminderSetDescription } from "./reminder-copy";

describe("reminderSetDescription (#4957)", () => {
  const now = new Date(2026, 10, 14, 15, 0); // Saturday

  it("says today and tomorrow in lower case, mid-sentence", () => {
    expect(reminderSetDescription(new Date(2026, 10, 15, 9, 0), now)).toMatch(
      /^I'll remind you tomorrow at 9:00\sAM\.$/,
    );
    expect(reminderSetDescription(new Date(2026, 10, 14, 16, 20), now)).toMatch(
      /^I'll remind you today at 4:20\sPM\.$/,
    );
  });

  it("keeps a weekday's capital", () => {
    expect(reminderSetDescription(new Date(2026, 10, 16, 9, 0), now)).toMatch(
      /^I'll remind you Monday at 9:00\sAM\.$/,
    );
  });
});
