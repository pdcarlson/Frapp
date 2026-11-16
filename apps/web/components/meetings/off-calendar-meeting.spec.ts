import { describe, expect, it } from "vitest";
import { offCalendarSpan } from "./off-calendar-meeting";

const at = (iso: string) => new Date(iso);
const local = (value: string) => new Date(value);

/** A meeting off the calendar needs only its day (#5219). */
describe("offCalendarSpan", () => {
  const now = local("2026-11-16T19:42:00");

  it("starts a meeting today now, rounded down to five minutes, for an hour", () => {
    const span = offCalendarSpan(
      { name: "", date: "2026-11-16", startTime: "", endTime: "" },
      [],
      now,
    );
    expect(span).toEqual({
      start_time: local("2026-11-16T19:40:00").toISOString(),
      end_time: local("2026-11-16T20:40:00").toISOString(),
    });
  });

  it("starts an earlier day when the last event of that name started", () => {
    const span = offCalendarSpan(
      {
        name: "chapter meeting",
        date: "2026-10-19",
        startTime: "",
        endTime: "",
      },
      [
        {
          name: "Chapter meeting",
          start_time: local("2026-11-08T18:30:00").toISOString(),
        },
        {
          name: "Chapter meeting",
          start_time: local("2026-11-01T20:00:00").toISOString(),
        },
        {
          name: "Exec meeting",
          start_time: local("2026-11-12T09:00:00").toISOString(),
        },
      ],
      now,
    );
    expect("start_time" in span && new Date(span.start_time).getHours()).toBe(
      18,
    );
    expect("start_time" in span && new Date(span.start_time).getMinutes()).toBe(
      30,
    );
  });

  it("falls back to 7 PM for a name the calendar has never had", () => {
    const span = offCalendarSpan(
      { name: "Alumni board", date: "2026-10-19", startTime: "", endTime: "" },
      [],
      now,
    );
    expect("start_time" in span && new Date(span.start_time).getHours()).toBe(
      19,
    );
  });

  it("keeps typed times, and runs past midnight for a late meeting", () => {
    const span = offCalendarSpan(
      { name: "", date: "2026-10-19", startTime: "21:00", endTime: "00:30" },
      [],
      now,
    );
    expect(span).toEqual({
      start_time: local("2026-10-19T21:00:00").toISOString(),
      end_time: local("2026-10-20T00:30:00").toISOString(),
    });
  });

  it("refuses an end before the start, and an end with no start", () => {
    expect(
      offCalendarSpan(
        { name: "", date: "2026-10-19", startTime: "15:00", endTime: "14:00" },
        [],
        now,
      ),
    ).toMatchObject({ field: "time" });
    expect(
      offCalendarSpan(
        { name: "", date: "2026-10-19", startTime: "", endTime: "14:00" },
        [],
        now,
      ),
    ).toMatchObject({ field: "time" });
  });

  it("asks for the day when there is none", () => {
    expect(
      offCalendarSpan(
        { name: "", date: "", startTime: "", endTime: "" },
        [],
        at("2026-11-16T12:00:00Z"),
      ),
    ).toMatchObject({ field: "date" });
  });
});
