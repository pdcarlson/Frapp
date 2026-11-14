import { describe, expect, it } from "vitest";
import { scheduledLine, scheduleRefusal } from "./schedule-send";

const base = {
  text: "Chapter at 8",
  photos: [] as { status: "uploading" | "ready" | "failed" }[],
  asksFrapp: false,
  writeBlocked: null,
};
const ready = { status: "ready" as const };
const uploading = { status: "uploading" as const };
const failed = { status: "failed" as const };

describe("scheduleRefusal", () => {
  it("takes plain text", () => {
    expect(scheduleRefusal(base)).toBeNull();
  });

  it("takes uploaded photos, with or without text (#4971)", () => {
    expect(scheduleRefusal({ ...base, photos: [ready, ready] })).toBeNull();
    expect(scheduleRefusal({ ...base, text: "", photos: [ready] })).toBeNull();
  });

  it("refuses a photo not uploaded yet, or one that failed, keeping the draft", () => {
    expect(scheduleRefusal({ ...base, photos: [ready, uploading] })).toMatch(
      /^Wait for your photos/,
    );
    expect(scheduleRefusal({ ...base, photos: [failed, uploading] })).toMatch(
      /^A photo didn't upload/,
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
      scheduleRefusal({
        ...base,
        photos: [uploading],
        writeBlocked: "You're offline.",
      }),
    ).toMatch(/^Wait for your photos/);
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
