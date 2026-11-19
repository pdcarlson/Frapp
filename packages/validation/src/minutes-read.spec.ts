import { describe, expect, it } from "vitest";
import { EMPTY_MEETING_CONTENT, type MeetingContent } from "./meetings";
import {
  minutesActionMeta,
  minutesActionRows,
  minutesActionStatePrefix,
  minutesAttendanceDetail,
  minutesPreviewCuts,
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
    expect(minutesDateTile("2026-11-28", new Date(2026, 10, 19))).toEqual({
      month: "NOV",
      day: "28",
      weekday: "Saturday",
      line: "Saturday",
    });
  });

  it("never says the month and day again beside the tile, only another year", () => {
    const now = new Date(2026, 10, 19);
    expect(minutesDateTile("2026-12-15", now).line).toBe("Tuesday");
    expect(minutesDateTile("2027-01-15", now).line).toBe("Friday, 2027");
  });

  it("is blank for a value that isn't a day", () => {
    expect(minutesDateTile("soon")).toEqual({
      month: "",
      day: "",
      weekday: "",
      line: "",
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

  it("puts the reader's own with a due day before their undated ones", () => {
    const rows = minutesActionRows(
      [
        { text: "Undated", owner_user_id: ME, due_date: null },
        { text: "Dated", owner_user_id: ME, due_date: "2026-12-01" },
      ],
      ME,
    );
    expect(rows.map((row) => row.item.text)).toEqual(["Dated", "Undated"]);
  });
});

describe("the read helpers both apps share (#5562)", () => {
  it("cuts a list only when Show all would hide more than one line", () => {
    expect(minutesPreviewCuts(5, 4)).toBe(false);
    expect(minutesPreviewCuts(6, 4)).toBe(true);
  });

  it("counts who attended, late included, or says it wasn't taken", () => {
    expect(minutesAttendanceDetail(null)).toBe("Not taken");
    expect(
      minutesAttendanceDetail({ present: [], late: [], excused: [] }),
    ).toBe("Not taken");
    expect(
      minutesAttendanceDetail({
        present: ["a", "b"],
        late: ["c"],
        excused: ["d"],
      }),
    ).toBe("3 attended");
  });

  it("writes an action item's line and what a screen reader hears first", () => {
    expect(
      minutesActionMeta({
        owner: "Sam",
        dueLabel: "Fri, Nov 21",
        group: { done: 2, total: 5 },
        done: false,
      }),
    ).toBe("Sam · Due Fri, Nov 21 · 2 of 5 done");
    expect(
      minutesActionMeta({
        owner: "Sam",
        dueLabel: null,
        group: { done: 5, total: 5 },
        done: true,
      }),
    ).toBe("Sam");
    expect(minutesActionStatePrefix(true, true)).toBe("Done: ");
    expect(minutesActionStatePrefix(false, true)).toBe("Not done yet: ");
    expect(minutesActionStatePrefix(false, false)).toBe("");
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
