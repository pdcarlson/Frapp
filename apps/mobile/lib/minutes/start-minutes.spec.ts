import { describe, expect, it, vi } from "vitest";
import type { MeetingSummary } from "@repo/hooks";

vi.mock("@repo/hooks", () => ({
  useStartMeeting: vi.fn(),
}));

import { MEETING_START_COPY, meetingChoices } from "./start-minutes";

const NOW = new Date("2026-11-17T19:20:00");
const ME = "user-me";

function event(id: string, name: string, start: string, end: string) {
  return {
    id,
    name,
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    check_in_opens_minutes: 15,
  };
}

function minutes(
  eventId: string,
  status: "draft" | "posted",
  createdBy: string,
): MeetingSummary {
  return {
    id: `m-${eventId}`,
    event_id: eventId,
    event_name: "x",
    event_start_time: NOW.toISOString(),
    meeting_type: "chapter",
    other_label: null,
    status,
    created_by: createdBy,
    posted_at: null,
    updated_at: NOW.toISOString(),
  } as MeetingSummary;
}

const tonight = event(
  "tonight",
  "Chapter Meeting",
  "2026-11-17T19:00:00",
  "2026-11-17T21:00:00",
);
const lastWeek = event(
  "last-week",
  "Chapter Meeting",
  "2026-11-10T19:00:00",
  "2026-11-10T21:00:00",
);
const longAgo = event(
  "long-ago",
  "Exec",
  "2026-09-01T19:00:00",
  "2026-09-01T20:00:00",
);

describe("meetingChoices", () => {
  it("picks the meeting on now and lists it first, then the recent ones", () => {
    const choices = meetingChoices([lastWeek, tonight, longAgo], [], ME, NOW);
    expect(choices.picked).toEqual({
      kind: "event",
      event: expect.objectContaining({ id: "tonight" }),
    });
    expect(choices.options.map((option) => option.title)).toEqual([
      "Chapter Meeting",
      "Chapter Meeting",
      MEETING_START_COPY.noneTitle,
    ]);
    expect(choices.options[0].detail).toBe(MEETING_START_COPY.onNow);
    // Older than two weeks is not listed.
    expect(
      choices.options.some(
        (option) =>
          option.choice.kind === "event" &&
          option.choice.event.id === "long-ago",
      ),
    ).toBe(false);
  });

  it("picks No meeting when nothing is on now", () => {
    const choices = meetingChoices([lastWeek], [], ME, NOW);
    expect(choices.picked).toEqual({ kind: "none" });
  });

  it("reopens the member's own draft on the meeting on now", () => {
    const own = meetingChoices(
      [tonight],
      [minutes("tonight", "draft", ME)],
      ME,
      NOW,
    );
    expect(own.picked?.kind).toBe("event");
    expect(own.ownDraftFor.get("tonight")).toBe("m-tonight");
    expect(own.options[0].detail).toContain(MEETING_START_COPY.yours);
  });

  it("lists the meeting on now with Open minutes when the member can read them, and picks No meeting", () => {
    for (const held of [
      minutes("tonight", "draft", "someone-else"),
      minutes("tonight", "posted", ME),
    ]) {
      const choices = meetingChoices([tonight], [held], ME, NOW);
      expect(choices.picked).toEqual({ kind: "none" });
      expect(choices.taken?.id).toBe("tonight");
      expect(
        choices.options.map((option) => [
          option.title,
          option.detail,
          option.opens ?? null,
          option.disabled ?? false,
        ]),
      ).toEqual([
        ["Chapter Meeting", "On now · Open minutes", "m-tonight", false],
        [MEETING_START_COPY.noneTitle, "Link one later", null, false],
      ]);
    }
  });

  it("shows a meeting whose minutes the member can't read as Has minutes, never to pick", () => {
    const choices = meetingChoices(
      [tonight],
      [],
      ME,
      NOW,
      new Set(["tonight"]),
    );
    expect(choices.options[0]).toMatchObject({
      title: "Chapter Meeting",
      detail: "On now · Has minutes",
      disabled: true,
    });
  });

  it("treats an event the server refused as taken, though its minutes can't be read", () => {
    const choices = meetingChoices(
      [tonight],
      [],
      ME,
      NOW,
      new Set(["tonight"]),
    );
    expect(choices.taken?.id).toBe("tonight");
    expect(choices.picked).toEqual({ kind: "none" });
  });

  it("never takes a creatorless draft for the member's own", () => {
    const orphan = { ...minutes("tonight", "draft", ME), created_by: null };
    const choices = meetingChoices([tonight], [orphan], ME, NOW);
    expect(choices.ownDraftFor.size).toBe(0);
    expect(choices.taken?.id).toBe("tonight");
  });

  it("never offers a hearing", () => {
    const hearing = event(
      "hearing",
      "Standards hearing",
      "2026-11-17T19:00:00",
      "2026-11-17T21:00:00",
    );
    const choices = meetingChoices([hearing], [], ME, NOW);
    expect(choices.picked).toEqual({ kind: "none" });
    expect(choices.options.map((option) => option.title)).toEqual([
      MEETING_START_COPY.noneTitle,
    ]);
  });
});
