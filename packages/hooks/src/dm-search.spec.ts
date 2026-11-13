import { describe, expect, it } from "vitest";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  dmChannelIdOf,
  normalizeDmSearchText,
  searchDirectMessages,
  type DmSearchConversation,
  type DmSearchInput,
} from "./dm-search";

const VIEWER = "viewer";
const names = {
  [VIEWER]: "Shawn Klein",
  paul: "Paul Carlson",
  pauline: "Pauline Park",
  winston: "Winston Lee",
  evan: "Evan Ruiz",
  jose: "José Alvarez",
  blocked: "Paula Blocked",
  hidden: "Paulo Hidden",
};
const roster = Object.entries(names).map(([user_id, display_name]) => ({
  user_id,
  display_name,
}));

type Row = DmSearchConversation & { title: string };
const dm = (id: string, other: string): Row => ({
  id,
  type: "DM",
  member_ids: [VIEWER, other],
  title: names[other as keyof typeof names],
});

function run(query: string, overrides: Partial<DmSearchInput<Row>> = {}) {
  return searchDirectMessages<Row>({
    query,
    conversations: [
      dm("dm-winston", "winston"),
      {
        id: "group",
        type: "GROUP_DM",
        member_ids: [VIEWER, "evan", "pauline"],
        title: "Rush crew",
      },
      dm("dm-paul", "paul"),
    ],
    titleOf: (row) => row.title,
    roster,
    names,
    viewerId: VIEWER,
    blockedIds: new Set(["blocked"]),
    blockListReady: true,
    ...overrides,
  });
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const userIds = (rows: { user_id: string }[]) => rows.map((row) => row.user_id);

describe("searchDirectMessages", () => {
  it("lists the existing conversation first, then members with none", () => {
    const result = run("Paul");
    // Both start with "Paul" (the group has Pauline); the 1:1 leads a tie.
    expect(ids(result.conversations)).toEqual(["dm-paul", "group"]);
    // Paul has a DM, so he is found as that row, not again as a member.
    // Pauline is only in a group, so a 1:1 with her is still offered.
    expect(userIds(result.members)).toEqual(["pauline", "hidden"]);
    expect(result.membersHeld).toBe(false);
  });

  it("matches a group DM on any member's name, not only its title", () => {
    expect(ids(run("evan").conversations)).toEqual(["group"]);
    expect(ids(run("rush").conversations)).toEqual(["group"]);
  });

  it("never offers a blocked member, the viewer or the system actor", () => {
    const result = run("a", {
      roster: [
        ...roster,
        { user_id: SYSTEM_SENDER_ID, display_name: "Frapp" },
      ],
    });
    const offered = userIds(result.members);
    expect(offered).not.toContain("blocked");
    expect(offered).not.toContain(VIEWER);
    expect(offered).not.toContain(SYSTEM_SENDER_ID);
  });

  it("holds members back until the block list is read, keeping conversations", () => {
    const result = run("Paul", { blockListReady: false });
    expect(ids(result.conversations)).toEqual(["dm-paul", "group"]);
    expect(result.members).toEqual([]);
    expect(result.membersHeld).toBe(true);
  });

  it("holds members back while the viewer is unknown", () => {
    expect(run("Paul", { viewerId: null }).membersHeld).toBe(true);
  });

  it("matches no conversation on the viewer's own name while the viewer is unknown", () => {
    // Every conversation holds the viewer; with no id to leave them out, their
    // name would match them all.
    expect(run("Shawn", { viewerId: null }).conversations).toEqual([]);
  });

  it("ranks a word that starts with the text above a name that only contains it", () => {
    const result = run("lee", {
      conversations: [],
      roster: [
        { user_id: "ashlee", display_name: "Ashlee Ford" },
        { user_id: "winston", display_name: "Winston Lee" },
      ],
    });
    expect(userIds(result.members)).toEqual(["winston", "ashlee"]);
  });

  it("offers the member of a hidden DM, since picking them reopens it", () => {
    // `hidden` has no listed conversation (hidden ones are left out).
    expect(userIds(run("Paulo").members)).toEqual(["hidden"]);
  });

  it("ignores case and accents and ranks name starts first", () => {
    expect(userIds(run("JOSE").members)).toEqual(["jose"]);
    // "park" is in the group only, through Pauline Park.
    expect(ids(run("park").conversations)).toEqual(["group"]);
  });

  it("returns the whole list, untouched, for an empty query", () => {
    const result = run("   ");
    expect(ids(result.conversations)).toEqual([
      "dm-winston",
      "group",
      "dm-paul",
    ]);
    expect(result.members).toEqual([]);
  });
});

describe("normalizeDmSearchText", () => {
  it("lowercases, strips accents and collapses spaces", () => {
    expect(normalizeDmSearchText("  José   ÁLVAREZ ")).toBe("jose alvarez");
  });
});

describe("dmChannelIdOf", () => {
  it("reads the id, or null for a body without one", () => {
    expect(dmChannelIdOf({ id: "c1" })).toBe("c1");
    expect(dmChannelIdOf({ id: "" })).toBeNull();
    expect(dmChannelIdOf(null)).toBeNull();
    expect(dmChannelIdOf("c1")).toBeNull();
  });
});
