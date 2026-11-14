import { describe, expect, it } from "vitest";
import { messageReminderPresetTime } from "./use-message-reminders";

describe("messageReminderPresetTime (#4957)", () => {
  // A Wednesday, mid-afternoon local time.
  const now = new Date(2026, 10, 11, 15, 7);

  it("counts the short presets from now", () => {
    expect(messageReminderPresetTime("20m", now).getTime()).toBe(
      now.getTime() + 20 * 60_000,
    );
    expect(messageReminderPresetTime("1h", now).getTime()).toBe(
      now.getTime() + 60 * 60_000,
    );
    expect(messageReminderPresetTime("3h", now).getTime()).toBe(
      now.getTime() + 180 * 60_000,
    );
  });

  it("lands Tomorrow at 9:00 AM local", () => {
    expect(messageReminderPresetTime("tomorrow", now)).toEqual(
      new Date(2026, 10, 12, 9),
    );
  });

  it("lands Next week on next Monday at 9:00 AM, a full week on from a Monday", () => {
    expect(messageReminderPresetTime("next-week", now)).toEqual(
      new Date(2026, 10, 16, 9),
    );
    expect(
      messageReminderPresetTime("next-week", new Date(2026, 10, 16, 8)),
    ).toEqual(new Date(2026, 10, 23, 9));
    expect(
      messageReminderPresetTime("next-week", new Date(2026, 10, 15, 22)),
    ).toEqual(new Date(2026, 10, 16, 9));
  });
});
