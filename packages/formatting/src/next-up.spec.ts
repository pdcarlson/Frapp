import { describe, expect, it } from "vitest";
import { nextUpLine } from "./next-up";

const NOW = new Date("2026-11-04T12:00:00-08:00").getTime();

describe("nextUpLine", () => {
  it("names the soonest event that hasn't started", () => {
    const line = nextUpLine(
      [
        { name: "Formal", start_time: "2026-11-20T19:00:00-08:00" },
        { name: "Chapter meeting", start_time: "2026-11-04T17:00:00-08:00" },
        { name: "Past", start_time: "2026-11-03T17:00:00-08:00" },
      ],
      NOW,
    );
    // `\s` before PM: ICU prints a narrow no-break space there on some builds.
    expect(line).toMatch(
      /^Nothing on your plate\. Next up: Chapter meeting, Today · 5:00\sPM\.$/,
    );
  });

  it("stops at the first sentence with nothing ahead or no events read", () => {
    expect(nextUpLine([], NOW)).toBe("Nothing on your plate.");
    expect(nextUpLine(undefined, NOW)).toBe("Nothing on your plate.");
    expect(
      nextUpLine([{ name: "  ", start_time: "2026-11-05T17:00:00-08:00" }], NOW),
    ).toBe("Nothing on your plate.");
  });
});
