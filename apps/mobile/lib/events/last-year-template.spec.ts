import { describe, expect, it } from "vitest";
import { lastYearTemplate } from "./last-year-template";
import type { EventDetail } from "./select";

/**
 * The New event form as "This time last year" opens it (#3930): last year's
 * event on the same weekday this year, never a date already gone, never a
 * series.
 */
const FORMAL: EventDetail = {
  id: "evt-1",
  name: "Winter Formal 2025",
  location: "Hilton ballroom",
  // A Saturday evening, three hours long.
  start_time: "2025-11-22T23:00:00.000Z",
  end_time: "2025-11-23T02:00:00.000Z",
  point_value: 10,
  check_in_opens_minutes: 10,
  attendance: {
    is_mandatory: true,
    others_invited: true,
    required_role_ids: ["role-1"],
    optional_role_ids: [],
    excluded_role_ids: [],
  },
  description: "Black tie.",
  notes: null,
  check_in_zone_name: null,
  event_type_id: "type-1",
  created_by: null,
  hasCheckInZone: false,
  recurrence_rule: "WEEKLY",
  parent_event_id: null,
};
const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("lastYearTemplate", () => {
  it("moves the event 52 weeks on, the same weekday and length, with this year in its name", () => {
    const draft = lastYearTemplate(FORMAL, new Date("2026-11-12T12:00:00Z"));
    expect(draft.name).toBe("Winter Formal 2026");
    expect(draft.start!.getDay()).toBe(new Date(FORMAL.start_time).getDay());
    expect(draft.start!.getTime()).toBeGreaterThan(
      new Date("2026-11-12T12:00:00Z").getTime(),
    );
    expect(draft.end!.getTime() - draft.start!.getTime()).toBe(
      3 * 60 * 60 * 1000,
    );
    expect(draft.location).toBe("Hilton ballroom");
    expect(draft.eventTypeId).toBe("type-1");
  });

  it("is a one-time event even when last year's was a series", () => {
    expect(
      lastYearTemplate(FORMAL, new Date("2026-11-12T12:00:00Z")).repeat.preset,
    ).toBe("NONE");
  });

  it("never opens on a day already gone: it moves on a week at a time, the end with it", () => {
    // Opened two weeks late.
    const now = new Date("2026-11-30T12:00:00Z");
    const draft = lastYearTemplate(FORMAL, now);
    expect(draft.start!.getTime()).toBeGreaterThan(now.getTime());
    expect(draft.start!.getTime() - now.getTime()).toBeLessThan(WEEK);
    expect(draft.start!.getDay()).toBe(new Date(FORMAL.start_time).getDay());
    expect(draft.end!.getTime() - draft.start!.getTime()).toBe(
      3 * 60 * 60 * 1000,
    );
  });

  it("leaves the times unpicked when last year's start can't be read", () => {
    const draft = lastYearTemplate(
      { ...FORMAL, start_time: "not a date" },
      new Date("2026-11-12T12:00:00Z"),
    );
    expect(draft.start).toBeNull();
    expect(draft.end).toBeNull();
    expect(draft.name).toBe("Winter Formal 2025");
  });

  it("keeps the length of an event a week or longer, however far the start moved", () => {
    const retreat = {
      ...FORMAL,
      // Nine days.
      start_time: "2025-11-03T15:00:00.000Z",
      end_time: "2025-11-12T15:00:00.000Z",
    };
    const draft = lastYearTemplate(retreat, new Date("2026-11-12T12:00:00Z"));
    expect(draft.end!.getTime() - draft.start!.getTime()).toBe(
      9 * 24 * 60 * 60 * 1000,
    );

    const week = { ...retreat, end_time: "2025-11-10T15:00:00.000Z" };
    const weekDraft = lastYearTemplate(week, new Date("2026-11-12T12:00:00Z"));
    expect(weekDraft.end!.getTime() - weekDraft.start!.getTime()).toBe(WEEK);
  });
});
