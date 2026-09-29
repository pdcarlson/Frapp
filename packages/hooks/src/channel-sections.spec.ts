import { describe, expect, it } from "vitest";
import { groupChannelsByCategory } from "./channel-sections";

// #1684. Both clients render from this, so this is the one place the rule is
// pinned whole. Each fixture passes rows in an order that a sort by name or id
// would change, so a helper that re-sorts fails here.

// Deliberately not alphabetical: "Executive" before "Committees" is the
// server's `display_order`.
const EXEC = { id: "cat-exec", name: "Executive" };
const COMM = { id: "cat-comm", name: "Committees" };
const CATEGORIES = [EXEC, COMM];

const general = { id: "c-general", type: "PUBLIC", category_id: null };
const zulu = { id: "c-zulu", type: "PUBLIC", category_id: "cat-exec" };
const alpha = { id: "c-alpha", type: "PRIVATE", category_id: "cat-exec" };
const philanthropy = { id: "c-phil", type: "PUBLIC", category_id: "cat-comm" };
const dm = { id: "c-dm", type: "DM" };
const groupDm = { id: "c-group", type: "GROUP_DM" };

function ids(rows: { id: string }[]): string[] {
  return rows.map((row) => row.id);
}

describe("groupChannelsByCategory", () => {
  it("returns categories in the order they were passed, not by name", () => {
    const sections = groupChannelsByCategory(
      [philanthropy, zulu],
      CATEGORIES,
    );

    expect(sections.categories.map((s) => s.category.name)).toEqual([
      "Executive",
      "Committees",
    ]);
    // Reversed input reverses the output: the order is the caller's, not a
    // sort that happens to agree with this fixture.
    expect(
      groupChannelsByCategory([philanthropy, zulu], [COMM, EXEC]).categories.map(
        (s) => s.category.name,
      ),
    ).toEqual(["Committees", "Executive"]);
  });

  it("nests each channel under its category, in the order the channels came", () => {
    const sections = groupChannelsByCategory(
      [zulu, general, philanthropy, alpha],
      CATEGORIES,
    );

    expect(
      sections.categories.map((s) => [s.category.id, ids(s.channels)]),
    ).toEqual([
      ["cat-exec", ["c-zulu", "c-alpha"]],
      ["cat-comm", ["c-phil"]],
    ]);
    expect(ids(sections.uncategorized)).toEqual(["c-general"]);
  });

  it("puts direct messages in their own group, whatever category_id they carry", () => {
    // The API doesn't forbid the column on a DM row, so type has to be tested
    // before category.
    const sections = groupChannelsByCategory(
      [
        { ...dm, category_id: "cat-exec" },
        { ...groupDm, category_id: "cat-comm" },
        general,
      ],
      CATEGORIES,
    );

    expect(ids(sections.direct)).toEqual(["c-dm", "c-group"]);
    expect(sections.categories.map((s) => ids(s.channels))).toEqual([[], []]);
    expect(ids(sections.uncategorized)).toEqual(["c-general"]);
  });

  it("falls back to uncategorized for a category_id that is not in the list", () => {
    const orphan = { id: "c-orphan", type: "PUBLIC", category_id: "cat-gone" };
    const sections = groupChannelsByCategory([general, orphan], CATEGORIES);

    expect(ids(sections.uncategorized)).toEqual(["c-general", "c-orphan"]);
  });

  it("treats every channel as uncategorized when there are no categories", () => {
    // The pre-category layout: categories not loaded yet, or the read failed.
    const sections = groupChannelsByCategory([zulu, general, dm], []);

    expect(ids(sections.uncategorized)).toEqual(["c-zulu", "c-general"]);
    expect(sections.categories).toEqual([]);
    expect(ids(sections.direct)).toEqual(["c-dm"]);
  });

  it("keeps an empty category as an entry with no channels", () => {
    const sections = groupChannelsByCategory([zulu], CATEGORIES);

    expect(sections.categories.map((s) => ids(s.channels))).toEqual([
      ["c-zulu"],
      [],
    ]);
  });
});
