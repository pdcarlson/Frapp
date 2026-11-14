import { describe, expect, it } from "vitest";
import { scheduledLine, scheduleRefusal, withDay } from "./schedule-send";

const base = {
  text: "Chapter at 8",
  photos: 0,
  replying: false,
  asksFrapp: false,
  writeBlocked: null,
};

describe("scheduleRefusal", () => {
  it("takes plain text", () => {
    expect(scheduleRefusal(base)).toBeNull();
  });

  it("refuses what it would drop on the way, keeping the draft", () => {
    expect(scheduleRefusal({ ...base, photos: 1 })).toMatch(/^Photos can't/);
    expect(scheduleRefusal({ ...base, replying: true })).toMatch(
      /^Replies can't/,
    );
    expect(scheduleRefusal({ ...base, asksFrapp: true })).toBe(
      "A question for Frapp can't be scheduled.",
    );
  });

  it("refuses an empty draft, a sticker placeholder included", () => {
    expect(scheduleRefusal({ ...base, text: "  " })).toBe(
      "Type a message to schedule.",
    );
    expect(scheduleRefusal({ ...base, text: "￼" })).toBe(
      "Type a message to schedule.",
    );
  });

  it("says offline last, since scheduling has no outbox", () => {
    expect(scheduleRefusal({ ...base, writeBlocked: "You're offline." })).toBe(
      "You're offline.",
    );
    expect(
      scheduleRefusal({ ...base, photos: 2, writeBlocked: "You're offline." }),
    ).toMatch(/^Photos/);
  });
});

describe("withDay", () => {
  it("puts one date's clock on another's day", () => {
    const at = withDay(
      new Date(2026, 10, 20, 1, 2, 3),
      new Date(2026, 0, 1, 8, 30, 45),
    );
    expect(at).toEqual(new Date(2026, 10, 20, 8, 30, 0, 0));
  });
});

describe("scheduledLine", () => {
  const now = new Date(2026, 10, 14, 20, 0);

  it("says nothing with nothing scheduled", () => {
    expect(scheduledLine([], now)).toBeNull();
  });

  it("counts them and names the soonest", () => {
    const line = scheduledLine(
      [
        { status: "pending", send_at: new Date(2026, 10, 18, 9).toISOString() },
        { status: "pending", send_at: new Date(2026, 10, 15, 9).toISOString() },
      ],
      now,
    );
    expect(line?.failed).toBe(0);
    expect(line?.label).toMatch(/^2 scheduled messages · next tomorrow at 9/);
  });

  it("counts a failed one without naming its passed time", () => {
    const line = scheduledLine(
      [{ status: "failed", send_at: new Date(2026, 10, 14, 9).toISOString() }],
      now,
    );
    expect(line).toEqual({ label: "1 scheduled message", failed: 1 });
  });
});
