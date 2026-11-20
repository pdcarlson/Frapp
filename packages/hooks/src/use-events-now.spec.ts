import { describe, expect, it } from "vitest";
import {
  eventNowPill,
  eventNowState,
  eventsOnNow,
  withoutEvents,
  type EventNow,
} from "./use-events-now";

// Recruitment Meetings, 9:25 to 10:25 PM local on 2026-11-19 (#5777).
const start = new Date(2026, 10, 19, 21, 25).toISOString();
const end = new Date(2026, 10, 19, 22, 25).toISOString();
const at = (hour: number, minute: number) =>
  new Date(2026, 10, 19, hour, minute);

const row = (overrides: Partial<EventNow> = {}): EventNow =>
  ({
    id: "recruitment",
    name: "Recruitment Meetings",
    location: null,
    start_time: start,
    end_time: end,
    attendance: "optional",
    point_value: 10,
    check_in_opens_minutes: 10,
    check_in_open: true,
    check_in_needs_location: false,
    check_in_needs_code: false,
    checked_in: true,
    checked_in_at: null,
    created_by: null,
    progress: null,
    created_at: start,
    unread: false,
    snoozed_until: null,
    ...overrides,
  }) as EventNow;

describe("eventsOnNow", () => {
  it("keeps a row while it is on and drops it at the end", () => {
    expect(eventsOnNow([row()], at(22, 7).getTime())).toHaveLength(1);
    expect(eventsOnNow([row()], at(22, 25).getTime())).toEqual([]);
    expect(eventsOnNow(undefined, at(22, 7).getTime())).toEqual([]);
  });
});

describe("eventNowState", () => {
  it("says checked in, else that check-in is open, else nothing", () => {
    expect(eventNowState(row())).toBe("Checked in");
    expect(
      eventNowState(
        row({ checked_in_at: new Date(2026, 10, 19, 21, 24).toISOString() }),
      ),
    ).toMatch(/^Checked in 9:24/);
    expect(eventNowState(row({ checked_in: false }))).toBe("Check-in is open");
    expect(
      eventNowState(row({ checked_in: null, check_in_open: false })),
    ).toBeNull();
  });
});

describe("eventNowPill", () => {
  it("is live while on, ended for the rest of the day, then gone", () => {
    expect(eventNowPill(row(), at(22, 7))).toEqual({
      live: true,
      label: expect.stringMatching(/^Now · until 10:25/),
    });
    expect(eventNowPill(row(), at(22, 59))).toEqual({
      live: false,
      label: expect.stringMatching(/^Ended 10:25/),
    });
    expect(eventNowPill(row(), new Date(2026, 10, 20, 9, 0))).toBeNull();
    expect(eventNowPill(row(), at(20, 0))).toBeNull();
  });
});

describe("withoutEvents", () => {
  it("leaves the Now card's events out of Coming up only", () => {
    const activity = {
      coming_up: [row(), row({ id: "chapter" })],
      week: { done: 1 },
    } as unknown as Parameters<typeof withoutEvents>[0];

    const left = withoutEvents(activity, ["recruitment"]);

    expect(left.coming_up.map((event) => event.id)).toEqual(["chapter"]);
    expect(left.week).toBe(activity.week);
    expect(withoutEvents(activity, [])).toBe(activity);
  });
});
