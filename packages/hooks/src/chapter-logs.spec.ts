import { describe, expect, it } from "vitest";
import {
  CHAPTER_LOG_ANY,
  chapterLogFilterRows,
  chapterLogRow,
  groupChapterLogRows,
  type ChapterLogEntry,
} from "./chapter-logs";

const PAUL = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ETHAN = "9b2c1a10-1111-4222-8333-444455556666";
const names: Record<string, string> = { [PAUL]: "Paul", [ETHAN]: "Ethan" };
const nameFor = (id: string) => names[id] ?? null;

function entry(over: Partial<ChapterLogEntry>): ChapterLogEntry {
  return {
    id: "e1",
    chapter_id: "c1",
    actor_user_id: PAUL,
    action: "chapter_profile_updated",
    target_type: "chapter",
    target_id: "c1",
    diff: {},
    member_visible: true,
    created_at: "2026-11-21T14:32:00.000Z",
    ...over,
  } as ChapterLogEntry;
}

describe("chapterLogRow", () => {
  it("reads who, what, and the fields that changed", () => {
    const row = chapterLogRow(
      entry({ diff: { name: { from: "Old", to: "New" } } }),
      nameFor,
    );
    expect(row.actor).toBe("Paul");
    expect(row.phrase).toBe("updated the chapter profile");
    expect(row.changes).toEqual(["name: Old → New"]);
  });

  it("names the removed member as the subject", () => {
    const row = chapterLogRow(
      entry({
        action: "member_removed",
        target_type: "member",
        target_id: "m1",
        diff: { user_id: ETHAN },
      }),
      nameFor,
    );
    expect(row.phrase).toBe("removed a member");
    expect(row.subject).toBe("Ethan");
    expect(row.changes).toEqual([]);
  });

  it("names the role added, and never shows an id field", () => {
    const row = chapterLogRow(
      entry({
        action: "role_self_joined",
        target_type: "role",
        diff: { member_id: { from: null, to: ETHAN } },
      }),
      nameFor,
    );
    expect(row.changes).toEqual([]);
    const added = chapterLogRow(
      entry({
        action: "role_created",
        diff: { role: { from: null, to: { name: "On Campus" } } },
      }),
      nameFor,
    );
    expect(added.subject).toBe("On Campus");
  });
});

describe("groupChapterLogRows", () => {
  it("keeps the order and starts a group at each new day", () => {
    const now = new Date("2026-11-21T18:00:00.000Z");
    const rows = [
      "2026-11-21T15:00:00.000Z",
      "2026-11-21T09:00:00.000Z",
      "2026-11-14T12:00:00.000Z",
    ].map((created_at, i) =>
      chapterLogRow(entry({ id: `e${i}`, created_at }), nameFor),
    );
    const groups = groupChapterLogRows(rows, now);
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([
      ["e0", "e1"],
      ["e2"],
    ]);
    expect(groups[0]?.day).not.toBe(groups[1]?.day);
  });
});

describe("chapterLogFilterRows", () => {
  it("offers Kind, Person and When in that order, each led by its any", () => {
    const rows = chapterLogFilterRows([
      { user_id: PAUL, display_name: "Paul" },
      { user_id: ETHAN, display_name: "Ethan" },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Kind", "Person", "When"]);
    for (const row of rows) {
      expect(row.options[0]?.value).toBe(CHAPTER_LOG_ANY);
    }
    expect(rows[1]?.options.slice(1).map((o) => o.label)).toEqual([
      "Ethan",
      "Paul",
    ]);
  });
});
