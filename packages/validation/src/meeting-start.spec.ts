import { describe, expect, it } from "vitest";
import {
  likelyMeeting,
  looksLikeHearing,
  meetingInTheRoom,
  meetingStartingNow,
} from "./meeting-start";

const NOW = Date.parse("2026-11-17T19:20:00");

function event(
  id: string,
  name: string,
  start: string,
  end: string | null = null,
) {
  return {
    id,
    name,
    start_time: new Date(start).toISOString(),
    end_time: end ? new Date(end).toISOString() : null,
  };
}

describe("meetingInTheRoom", () => {
  it("picks the meeting whose check-in window is open", () => {
    const chapter = event(
      "a",
      "Chapter Meeting",
      "2026-11-17T19:00:00",
      "2026-11-17T21:00:00",
    );
    expect(meetingInTheRoom([chapter], new Set(), NOW)).toBe(chapter);
  });

  it("counts a meeting that started within the hour, end or not", () => {
    const started = event(
      "a",
      "Exec",
      "2026-11-17T18:30:00",
      "2026-11-17T19:00:00",
    );
    expect(meetingInTheRoom([started], new Set(), NOW)).toBe(started);
  });

  it("does not guess an older meeting, or one well ahead", () => {
    const yesterday = event(
      "a",
      "Chapter Meeting",
      "2026-11-16T19:00:00",
      "2026-11-16T21:00:00",
    );
    const tomorrow = event(
      "b",
      "Chapter Meeting",
      "2026-11-18T19:00:00",
      "2026-11-18T21:00:00",
    );
    expect(meetingInTheRoom([yesterday, tomorrow], new Set(), NOW)).toBeNull();
  });

  it("never picks a hearing or an event someone else's minutes hold", () => {
    const hearing = event(
      "a",
      "Standards hearing",
      "2026-11-17T19:00:00",
      "2026-11-17T21:00:00",
    );
    const taken = event(
      "b",
      "Chapter Meeting",
      "2026-11-17T19:00:00",
      "2026-11-17T21:00:00",
    );
    expect(meetingInTheRoom([hearing, taken], new Set(["b"]), NOW)).toBeNull();
  });

  it("takes the one that started first when two are on", () => {
    const later = event(
      "a",
      "Committee",
      "2026-11-17T19:10:00",
      "2026-11-17T20:00:00",
    );
    const first = event(
      "b",
      "Chapter",
      "2026-11-17T19:00:00",
      "2026-11-17T21:00:00",
    );
    expect(meetingInTheRoom([later, first], new Set(), NOW)).toBe(first);
  });
});

describe("likelyMeeting", () => {
  it("falls back to the newest started meeting without minutes", () => {
    const old = event(
      "a",
      "Chapter",
      "2026-11-09T19:00:00",
      "2026-11-09T21:00:00",
    );
    const newer = event(
      "b",
      "Chapter",
      "2026-11-16T19:00:00",
      "2026-11-16T21:00:00",
    );
    expect(likelyMeeting([old, newer], new Set(), NOW)).toBe(newer);
    expect(likelyMeeting([old, newer], new Set(["b"]), NOW)).toBe(old);
  });
});

describe("looksLikeHearing", () => {
  it("reads the names a hearing goes by", () => {
    expect(looksLikeHearing("Standards Board")).toBe(true);
    expect(looksLikeHearing("J-Board hearing")).toBe(true);
    expect(looksLikeHearing("Chapter Meeting")).toBe(false);
    expect(looksLikeHearing("Standardized testing study")).toBe(false);
  });
});

describe("meetingStartingNow", () => {
  it("starts on the five minutes before now and runs an hour", () => {
    const span = meetingStartingNow(new Date("2026-11-17T19:23:41"));
    expect(new Date(span.start_time).getMinutes()).toBe(20);
    expect(Date.parse(span.end_time) - Date.parse(span.start_time)).toBe(
      60 * 60_000,
    );
  });
});
