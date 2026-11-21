import { describe, expect, it } from "vitest";
import {
  arrangeEntries,
  categoryMovedAnnouncement,
  moveCategory,
  moveChannelEntry,
  movedAnnouncement,
} from "./arrange-channels";
import type { ChannelSummary } from "./channel-list";

function channel(
  id: string,
  category_id: string | null,
  display_order?: number,
  type = "PUBLIC",
): ChannelSummary {
  return {
    id,
    name: id,
    type,
    member_ids: [],
    hidden: false,
    category_id,
    ...(display_order === undefined ? {} : { display_order }),
  };
}

const CATEGORIES = [
  { id: "exec", name: "Exec" },
  { id: "social", name: "Social" },
];

const CHANNELS = [
  channel("general", null, 1),
  channel("announcements", null, 0),
  channel("board", "exec"),
  channel("chapter-audit", null),
  channel("dm-a-b", null, undefined, "DM"),
];

function keys(entries: ReturnType<typeof arrangeEntries>) {
  return entries.map((e) => (e.kind === "heading" ? `[${e.label}]` : e.name));
}

describe("arrangeEntries (#3838)", () => {
  it("lists the default group, then each category, empty ones too, in the chapter's order", () => {
    expect(keys(arrangeEntries(CHANNELS, CATEGORIES))).toEqual([
      "[Channels]",
      "announcements",
      "general",
      "[Exec]",
      "board",
      "[Social]",
    ]);
  });
});

describe("moveChannelEntry", () => {
  const entries = arrangeEntries(CHANNELS, CATEGORIES);

  it("reorders inside a section and saves that section", () => {
    const moved = moveChannelEntry(entries, 2, 1)!;
    expect(keys(moved.entries).slice(0, 3)).toEqual([
      "[Channels]",
      "general",
      "announcements",
    ]);
    expect(moved.write).toEqual({
      category_id: null,
      channel_ids: ["general", "announcements"],
    });
  });

  it("moves a row into another category, including an empty one", () => {
    const moved = moveChannelEntry(entries, 1, 5)!;
    expect(keys(moved.entries)).toEqual([
      "[Channels]",
      "general",
      "[Exec]",
      "board",
      "[Social]",
      "announcements",
    ]);
    expect(moved.write).toEqual({
      category_id: "social",
      channel_ids: ["announcements"],
    });
  });

  it("never lands above the first heading, and a drop in place writes nothing", () => {
    expect(moveChannelEntry(entries, 1, 0)).toBeNull();
    expect(moveChannelEntry(entries, 2, 2)).toBeNull();
    expect(moveChannelEntry(entries, 0, 3)).toBeNull();
  });

  it("announces the new place", () => {
    const moved = moveChannelEntry(entries, 1, 3)!;
    expect(movedAnnouncement(moved.entries, 3)).toBe(
      "announcements moved to 1 of 2 in Exec",
    );
  });
});

describe("moveCategory (#4478)", () => {
  it("moves a category one place and refuses past either end", () => {
    expect(moveCategory(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveCategory(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveCategory(["a", "b", "c"], "a", -1)).toBeNull();
    expect(moveCategory(["a", "b", "c"], "c", 1)).toBeNull();
    expect(moveCategory(["a"], "missing", 1)).toBeNull();
  });

  it("announces the new place", () => {
    expect(categoryMovedAnnouncement(["b", "a"], "Social", "a")).toBe(
      "Social moved to 2 of 2 categories",
    );
  });
});
