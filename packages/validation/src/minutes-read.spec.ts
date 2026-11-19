import { describe, expect, it } from "vitest";
import { EMPTY_MEETING_CONTENT, type MeetingContent } from "./meetings";
import {
  minutesActionRows,
  minutesDateTile,
  minutesJumps,
  minutesReadSections,
  minutesTopics,
  notesLookLikeTranscript,
  notesWordCount,
} from "./minutes-read";

const content = (patch: Partial<MeetingContent>): MeetingContent => ({
  ...EMPTY_MEETING_CONTENT,
  ...patch,
});

const ME = "11111111-1111-4111-8111-111111111111";
const YOU = "22222222-2222-4222-8222-222222222222";

describe("minutesReadSections", () => {
  const template = [
    "tldr",
    "summary",
    "dates",
    "decisions",
    "action_items",
    "attendees",
    "discussion_log",
  ] as const;

  it("leaves the summary to its expander once there is a TL;DR", () => {
    const sections = minutesReadSections(
      template,
      content({ tldr: "- Installation set", summary: "Long story." }),
    );
    expect(sections).toEqual(["tldr"]);
  });

  it("keeps the summary as its own block when there is no TL;DR", () => {
    expect(
      minutesReadSections(template, content({ summary: "Long story." })),
    ).toEqual(["summary"]);
  });

  it("drops empty sections and attendees", () => {
    const sections = minutesReadSections(
      template,
      content({
        dates: [{ date: "2026-11-28", text: "Installation" }],
        discussion_log: "Budget\n- Approved",
      }),
    );
    expect(sections).toEqual(["dates", "discussion_log"]);
  });
});

describe("minutesJumps", () => {
  it("lists each section with its count", () => {
    const minutes = content({
      dates: [{ date: "2026-11-28", text: "Installation" }],
      decisions: [{ text: "Approve budget", vote: null }],
      announcements: "Dues are due\n\nFormal on Friday",
      discussion_log: "Budget\n- Approved\nFormal\n- Venue booked",
    });
    const jumps = minutesJumps(
      ["dates", "decisions", "announcements", "discussion_log"],
      minutes,
    );
    expect(jumps).toEqual([
      { key: "dates", label: "Coming up", count: 1 },
      { key: "decisions", label: "Decisions", count: 1 },
      { key: "announcements", label: "Announcements", count: 2 },
      { key: "discussion_log", label: "Notes", count: 2 },
    ]);
  });

  it("is empty when there is only one place to go", () => {
    expect(
      minutesJumps(
        ["decisions"],
        content({ decisions: [{ text: "Approve budget", vote: null }] }),
      ),
    ).toEqual([]);
  });
});

describe("minutesDateTile", () => {
  it("reads the day as a calendar day", () => {
    expect(minutesDateTile("2026-11-28")).toEqual({
      month: "NOV",
      day: "28",
      weekday: "Saturday",
    });
  });

  it("is blank for a value that isn't a day", () => {
    expect(minutesDateTile("soon")).toEqual({
      month: "",
      day: "",
      weekday: "",
    });
  });
});

describe("minutesTopics", () => {
  it("groups the outline's points under their topics", () => {
    const topics = minutesTopics(
      "Budget\n- Approved $400\n  - For the formal\nRecruitment\n- Two events",
    );
    expect(topics.map((topic) => topic.title)).toEqual([
      "Budget",
      "Recruitment",
    ]);
    expect(topics[0]?.lines).toHaveLength(2);
    expect(topics[1]?.lines).toHaveLength(1);
  });

  it("reads notes typed by hand as one untitled topic", () => {
    const topics = minutesTopics(
      "We talked about the formal.\nEveryone agreed.",
    );
    expect(topics).toHaveLength(1);
    expect(topics[0]?.title).toBeNull();
    expect(topics[0]?.lines).toHaveLength(2);
  });

  it("is empty for empty notes", () => {
    expect(minutesTopics("")).toEqual([]);
  });
});

describe("minutesActionRows", () => {
  const items = [
    { text: "Order shirts", owner_user_id: null, due_date: null },
    { text: "Book venue", owner_user_id: YOU, due_date: "2026-12-01" },
    { text: "Email alumni", owner_user_id: ME, due_date: null },
    { text: "Send invites", owner_user_id: null, due_date: "2026-11-25" },
  ];

  it("lists the reader's own first, then by due day, then as written", () => {
    const rows = minutesActionRows(items, ME);
    expect(rows.map((row) => row.item.text)).toEqual([
      "Email alumni",
      "Send invites",
      "Book venue",
      "Order shirts",
    ]);
    expect(rows.map((row) => row.index)).toEqual([2, 3, 1, 0]);
    expect(rows[0]?.mine).toBe(true);
  });

  it("marks nothing as the reader's without a reader", () => {
    expect(minutesActionRows(items, null).some((row) => row.mine)).toBe(false);
  });
});

describe("notesLookLikeTranscript", () => {
  it("folds long notes and timestamped ones, not short typed notes", () => {
    expect(notesLookLikeTranscript("Budget approved.\nFormal Dec 5")).toBe(
      false,
    );
    expect(notesLookLikeTranscript("word ".repeat(700))).toBe(true);
    expect(
      notesLookLikeTranscript(
        "00:01 Paul: Call to order\n00:15 Shawn: Treasurer\n01:02 Paul: Next",
      ),
    ).toBe(true);
  });

  it("counts words", () => {
    expect(notesWordCount("  one two\nthree ")).toBe(3);
  });
});
