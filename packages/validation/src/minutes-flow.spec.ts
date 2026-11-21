import { describe, expect, it } from "vitest";
import { EMPTY_MEETING_CONTENT, type MeetingContent } from "./meetings";
import {
  MINUTES_FLOW_COPY,
  minutesAddableSections,
  minutesDraftElapsed,
  minutesDraftSource,
  minutesDraftSteps,
  minutesEditorSections,
} from "./minutes-flow";

const content = (patch: Partial<MeetingContent>): MeetingContent => ({
  ...EMPTY_MEETING_CONTENT,
  ...patch,
});

const TRANSCRIPT = Array.from(
  { length: 40 },
  (_, at) => `[00:${String(at).padStart(2, "0")}:10] Speaker 1: line ${at}`,
).join("\n");

describe("minutesDraftSource", () => {
  it("names what the draft reads the way the officer would", () => {
    const base = { notes: "", othersWrote: false, recordingReady: false };
    expect(minutesDraftSource({ ...base, notes: "dues due friday" })).toBe(
      "notes",
    );
    expect(minutesDraftSource({ ...base, notes: TRANSCRIPT })).toBe(
      "transcript",
    );
    expect(minutesDraftSource({ ...base, recordingReady: true })).toBe(
      "recording",
    );
    expect(minutesDraftSource({ ...base, notes: "x", othersWrote: true })).toBe(
      "everyone",
    );
  });

  it("feeds the review banner and the first step", () => {
    expect(MINUTES_FLOW_COPY.review.banner("transcript")).toBe(
      "Drafted from your transcript. Read it over and fix anything, then post.",
    );
    expect(minutesDraftSteps("transcript")).toEqual([
      { label: "Saved your transcript", state: "done" },
      { label: "Writing the minutes", state: "now" },
      { label: "Ready for you to read", state: "next" },
    ]);
  });
});

describe("minutesDraftElapsed", () => {
  it("counts from the request, minutes and padded seconds", () => {
    const at = "2026-11-19T16:00:00.000Z";
    const start = Date.parse(at);
    expect(minutesDraftElapsed(at, start + 42_000)).toBe("0:42");
    expect(minutesDraftElapsed(at, start + 725_000)).toBe("12:05");
    // A clock a little behind the server's never reads negative.
    expect(minutesDraftElapsed(at, start - 3_000)).toBe("0:00");
    expect(minutesDraftElapsed(null, start)).toBeNull();
    expect(minutesDraftElapsed("not a date", start)).toBeNull();
  });
});

describe("minutesEditorSections", () => {
  const template = ["tldr", "summary", "decisions", "action_items"] as const;
  const drafted = content({
    tldr: "- Formal is on.",
    decisions: [{ text: "Approved the DJ.", headline: null, vote: null }],
  });

  it("shows only what a draft filled, plus what the officer added", () => {
    expect(
      minutesEditorSections(template, drafted, { byHand: false, added: [] }),
    ).toEqual(["tldr", "decisions"]);
    expect(
      minutesEditorSections(template, drafted, {
        byHand: false,
        added: ["announcements"],
      }),
    ).toEqual(["tldr", "decisions", "announcements"]);
  });

  it("lays out the template to fill in by hand", () => {
    expect(
      minutesEditorSections(template, EMPTY_MEETING_CONTENT, {
        byHand: true,
        added: [],
      }),
    ).toEqual(["tldr", "summary", "decisions", "action_items"]);
  });

  it("offers every section not on screen", () => {
    const shown = minutesEditorSections(template, drafted, {
      byHand: false,
      added: [],
    });
    const addable = minutesAddableSections(shown);
    expect(addable).not.toContain("tldr");
    expect(addable).toContain("action_items");
    expect(addable.length + shown.length).toBeGreaterThan(5);
  });
});
