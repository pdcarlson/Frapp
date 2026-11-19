import { describe, expect, it } from "vitest";
import { meetingDayLabel, meetingTabledFromLabel } from "./meeting-copy";
import {
  ALWAYS_MEETING_SECTIONS,
  normalizeMeetingSections,
  parseMinutesNotes,
  readMeetingContent,
} from "./meetings";

describe("the notes outline (#5410)", () => {
  it("reads topics, points and sub-points", () => {
    expect(
      parseMinutesNotes(
        [
          "Rolling out to the chapter",
          "- Get a few members on it first",
          "  - Shawn wants it before Thanksgiving",
          "",
          "Meeting transcripts",
          "- Accuracy over cost",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "topic", text: "Rolling out to the chapter" },
      { kind: "point", depth: 0, text: "Get a few members on it first" },
      { kind: "point", depth: 1, text: "Shawn wants it before Thanksgiving" },
      { kind: "topic", text: "Meeting transcripts" },
      { kind: "point", depth: 0, text: "Accuracy over cost" },
    ]);
  });

  it("reads older text with no bullets line by line, leading topic in bold", () => {
    expect(
      parseMinutesNotes(
        "Rusty Pipes afterparty: approved for December 5.\nThe budget passed.",
      ),
    ).toEqual([
      {
        kind: "line",
        head: "Rusty Pipes afterparty",
        text: "approved for December 5.",
      },
      { kind: "line", head: null, text: "The budget passed." },
    ]);
  });

  it("keeps a full sentence in an outline as a line, not a topic", () => {
    expect(
      parseMinutesNotes("Rush\n- Two events.\nThat was all for rush.")[2],
    ).toEqual({ kind: "line", head: null, text: "That was all for rush." });
  });

  it("reads an officer's report with a bullet as lines, not topics", () => {
    const report =
      "Treasurer: collected $1,200 in dues\n- 5 members still owe\nSecretary report";
    expect(parseMinutesNotes(report, { outline: false })).toEqual([
      { kind: "line", head: "Treasurer", text: "collected $1,200 in dues" },
      { kind: "point", depth: 0, text: "5 members still owe" },
      { kind: "line", head: null, text: "Secretary report" },
    ]);
    // Even in the notes, a line that says something after its topic is a
    // line with its topic in bold.
    expect(parseMinutesNotes(report)[0]).toEqual({
      kind: "line",
      head: "Treasurer",
      text: "collected $1,200 in dues",
    });
  });
});

describe("the notes, the TL;DR, Coming up and Tabled are always on", () => {
  it("adds them to a saved template that left them out, in catalog order", () => {
    expect(ALWAYS_MEETING_SECTIONS).toEqual([
      "tldr",
      "dates",
      "tabled",
      "discussion_log",
    ]);
    expect(normalizeMeetingSections(["summary", "decisions"])).toEqual([
      "tldr",
      "summary",
      "dates",
      "decisions",
      "tabled",
      "discussion_log",
    ]);
  });
});

describe("tabled items (#5522)", () => {
  it("reads only well-formed items, and none from minutes before them", () => {
    expect(readMeetingContent({ summary: "Old" }).tabled).toEqual([]);
    expect(
      readMeetingContent({
        tabled: [
          {
            text: "Formal budget",
            first_meeting_id: null,
            first_start_time: null,
            times: 1,
          },
          { text: "", first_meeting_id: null, first_start_time: null, times: 1 },
          { text: "No count" },
        ],
      }).tabled.map((item) => item.text),
    ).toEqual(["Formal budget"]);
  });

  it("says where a carried item was first tabled, and how often", () => {
    const now = new Date(2026, 10, 20, 12);
    const from = new Date(2026, 10, 11, 19).toISOString();
    expect(
      meetingTabledFromLabel(
        { first_start_time: from, times: 2 },
        now,
      ),
    ).toBe(`Tabled from ${meetingDayLabel(from, now)} · 2nd time`);
    expect(
      meetingTabledFromLabel({ first_start_time: null, times: 1 }, now),
    ).toBe("");
    expect(
      meetingTabledFromLabel({ first_start_time: from, times: 13 }, now),
    ).toContain("13th time");
  });
});
