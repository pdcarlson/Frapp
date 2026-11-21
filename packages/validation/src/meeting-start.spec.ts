import { describe, expect, it } from "vitest";
import {
  likelyMeeting,
  looksLikeHearing,
  meetingInTheRoom,
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
    expect(meetingInTheRoom([chapter], NOW)).toBe(chapter);
  });

  it("does not guess a meeting that is over, or one well ahead", () => {
    const yesterday = event(
      "a",
      "Chapter Meeting",
      "2026-11-16T19:00:00",
      "2026-11-16T21:00:00",
    );
    // Ended 18:30; its grace closed at 18:45.
    const ended = event(
      "b",
      "Exec",
      "2026-11-17T18:00:00",
      "2026-11-17T18:30:00",
    );
    const tomorrow = event(
      "c",
      "Chapter Meeting",
      "2026-11-18T19:00:00",
      "2026-11-18T21:00:00",
    );
    expect(meetingInTheRoom([yesterday, ended, tomorrow], NOW)).toBeNull();
  });

  it("takes the meeting about to start over the one just ending", () => {
    const at = Date.parse("2026-11-17T18:55:00");
    // Both windows are open at 18:55: Exec's grace runs to 19:00.
    const exec = event(
      "a",
      "Exec",
      "2026-11-17T18:00:00",
      "2026-11-17T18:45:00",
    );
    const chapter = event(
      "b",
      "Chapter",
      "2026-11-17T19:00:00",
      "2026-11-17T20:00:00",
    );
    expect(meetingInTheRoom([exec, chapter], at)).toBe(chapter);
  });

  it("takes a meeting over an all-day event whose window spans it", () => {
    const at = Date.parse("2026-11-17T19:05:00");
    const day = event(
      "a",
      "Philanthropy day",
      "2026-11-17T12:00:00",
      "2026-11-17T20:00:00",
    );
    const chapter = event(
      "b",
      "Chapter",
      "2026-11-17T19:00:00",
      "2026-11-17T20:00:00",
    );
    expect(meetingInTheRoom([day, chapter], at)).toBe(chapter);
  });

  it("finds a meeting whose check-in opened well before its start", () => {
    const later = {
      ...event("a", "Initiation", "2026-11-17T20:30:00", "2026-11-17T22:00:00"),
      check_in_opens_minutes: 90,
    };
    expect(meetingInTheRoom([later], NOW)).toBe(later);
  });

  it("never picks a hearing", () => {
    const hearing = event(
      "a",
      "Standards hearing",
      "2026-11-17T19:00:00",
      "2026-11-17T21:00:00",
    );
    expect(meetingInTheRoom([hearing], NOW)).toBeNull();
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
