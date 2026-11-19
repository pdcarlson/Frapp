import { describe, expect, it } from "vitest";
import {
  eventMinutesLines,
  minutesRowTags,
  guessMeetingType,
  minutesGist,
} from "./meeting-copy";

describe("guessMeetingType", () => {
  it("files a meeting by what its name says", () => {
    expect(guessMeetingType("Exec meeting")).toBe("exec");
    expect(guessMeetingType("E-board")).toBe("exec");
    expect(guessMeetingType("Social committee")).toBe("committee");
    expect(guessMeetingType("Chapter meeting")).toBe("chapter");
    expect(guessMeetingType("Sunday GM")).toBe("chapter");
    expect(guessMeetingType("General meeting")).toBe("chapter");
    expect(guessMeetingType("General Body Meeting")).toBe("chapter");
    expect(guessMeetingType("GBM")).toBe("chapter");
  });

  it("leaves a name that says no type as Other, never Chapter", () => {
    expect(guessMeetingType("Ben Cunningham Meeting")).toBe("other");
    expect(guessMeetingType("Weekly meeting")).toBe("other");
    expect(guessMeetingType("")).toBe("other");
    expect(guessMeetingType("Team BM retro")).toBe("other");
  });
});

describe("eventMinutesLines", () => {
  const posted = {
    status: "posted" as const,
    posted_at: "2026-11-18T12:00:00Z",
    decision_count: 2,
    action_item_count: 1,
  };

  it("says where posted minutes stand, with what they hold", () => {
    const { status } = eventMinutesLines(posted);
    expect(status).toMatch(
      /^Posted \w+, November 18 · 2 decisions · 1 action item$/,
    );
  });

  it("calls a draft a draft, and leaves out counts of nothing", () => {
    expect(
      eventMinutesLines({
        ...posted,
        status: "draft",
        posted_at: null,
        decision_count: 0,
        action_item_count: 0,
      }).status,
    ).toBe("A draft, not posted yet");
  });

  it("carries the row's gist", () => {
    expect(
      eventMinutesLines({ ...posted, gist: "Dues are due Friday." }).gist,
    ).toBe("Dues are due Friday.");
    expect(eventMinutesLines(posted).gist).toBeNull();
  });
});

describe("minutesRowTags", () => {
  it("says Draft, Recorded, the counts and whose draft, in that order", () => {
    expect(
      minutesRowTags(
        {
          status: "draft",
          recorded: true,
          decision_count: 1,
          action_item_count: 2,
        },
        "Eli's draft",
      ).map((tag) => tag.label),
    ).toEqual([
      "Draft",
      "Recorded",
      "1 decision",
      "2 action items",
      "Eli's draft",
    ]);
  });

  it("leaves out what the minutes don't hold", () => {
    expect(
      minutesRowTags({
        status: "posted",
        recorded: false,
        decision_count: 0,
        action_item_count: 0,
      }),
    ).toEqual([]);
  });

  it("takes the TL;DR's first line, bullet off, as the gist", () => {
    expect(minutesGist("\n- Dues are due Friday.\n- Formal is set.")).toBe(
      "Dues are due Friday.",
    );
    expect(minutesGist("  ")).toBeNull();
  });
});

describe("minutesGist", () => {
  it("cuts a long line at a word, with an ellipsis", () => {
    const gist = minutesGist(`- ${"word ".repeat(60)}`)!;
    expect(gist.length).toBeLessThanOrEqual(141);
    expect(gist.endsWith("word…")).toBe(true);
  });
});
