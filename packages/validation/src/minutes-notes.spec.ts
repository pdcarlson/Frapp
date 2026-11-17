import { describe, expect, it } from "vitest";
import {
  ALWAYS_MEETING_SECTIONS,
  normalizeMeetingSections,
  parseMinutesNotes,
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
});

describe("the notes are always on", () => {
  it("adds them to a saved template that left them out", () => {
    expect(normalizeMeetingSections(["summary", "decisions"])).toEqual([
      "summary",
      "decisions",
      ...ALWAYS_MEETING_SECTIONS,
    ]);
  });
});
