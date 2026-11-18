import { describe, expect, it } from "vitest";
import type { ActivityNudge } from "@repo/hooks";
import {
  activityNudgeAskPrompt,
  nudgeShowsRow,
  withoutWeekNext,
} from "./nudge";

function item(overrides: Partial<ActivityNudge> = {}): ActivityNudge {
  return {
    id: null,
    kind: "event_soon",
    subject_key: "event-1",
    headline: "Chapter Meeting",
    meta: "Tonight 7:00 PM",
    urgent: true,
    chip: "Tonight",
    action: "Open event",
    target_type: "event",
    target_id: "event-1",
    channel_id: null,
    task_id: null,
    line: null,
    start_here: null,
    seen: false,
    ...overrides,
  };
}

describe("withoutWeekNext", () => {
  const event = item({ id: "row-1" });
  const queue = item({
    kind: "officer_queue",
    subject_key: "queue:h1",
    target_type: "review",
    target_id: "h1",
  });

  it("keeps the card when Next is something else", () => {
    expect(
      withoutWeekNext({ card: event, tray: [queue] }, "needs:task:t9"),
    ).toEqual({ card: event, tray: [queue] });
  });

  it("moves the tray's first up when the card is the week card's Next", () => {
    expect(
      withoutWeekNext({ card: event, tray: [queue] }, "coming:event:event-1"),
    ).toEqual({ card: queue, tray: [] });
  });

  it("is nothing when there is no card", () => {
    expect(withoutWeekNext({ card: null, tray: [] }, null)).toBeNull();
    expect(withoutWeekNext(undefined, null)).toBeNull();
    expect(
      withoutWeekNext({ card: event, tray: [] }, "coming:event:event-1"),
    ).toBeNull();
  });
});

describe("activityNudgeAskPrompt", () => {
  it("asks how to start a task, and about anything else by name", () => {
    expect(
      activityNudgeAskPrompt(
        item({ target_type: "task", headline: "Book the venue" }),
      ),
    ).toBe('Help me get started on "Book the venue". What should I do first?');
    expect(activityNudgeAskPrompt(item())).toBe(
      "What should I know about Chapter Meeting?",
    );
  });
});

describe("nudgeShowsRow", () => {
  const card = item({ id: "row-1" });
  const queue = item({
    kind: "officer_queue",
    subject_key: "queue:h1",
    target_type: "review",
    target_id: "h1",
  });

  it("is true only for a sheet about something the card names", () => {
    expect(nudgeShowsRow({ card, tray: [queue] }, "coming:event:event-1")).toBe(
      true,
    );
    expect(nudgeShowsRow({ card, tray: [queue] }, "needs:hours:h1")).toBe(true);
    expect(nudgeShowsRow({ card, tray: [queue] }, "needs:task:t9")).toBe(false);
    expect(nudgeShowsRow({ card, tray: [] }, null)).toBe(false);
    expect(nudgeShowsRow(null, "coming:event:event-1")).toBe(false);
  });
});
