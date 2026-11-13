import { describe, expect, it } from "vitest";
import {
  arrangeChannelSidebar,
  compareLatestFirst,
  countsLookUnread,
  foldedSectionAnnouncement,
  sidebarMutedChannelIds,
  sidebarSections,
  sidebarUnreadCounts,
  type ArrangeSidebarInput,
  type SidebarUnreadCounts,
} from "./channel-sidebar";
import { groupChannelsByCategory } from "./channel-sections";

interface Row {
  id: string;
  type: string;
  name: string;
  display_order?: number | null;
}

const ch = (id: string, name = id, type = "PUBLIC"): Row => ({
  id,
  name,
  type,
});

const general = ch("general");
const alumni = ch("alumni");
const social = ch("social");
const zeta = ch("zeta");
const exec = ch("exec", "exec", "PRIVATE");
const dmMarcus = ch("dm-m", "Marcus Reid", "DM");
const dmAnna = ch("dm-a", "Anna Lee", "DM");

const CATEGORY_KEY = "category:0a000000-0000-4000-8000-000000000001" as const;

const counts = (
  entries: Record<string, [number, number]>,
): Map<string, SidebarUnreadCounts> =>
  new Map(
    Object.entries(entries).map(([id, [unreadCount, mentionCount]]) => [
      id,
      { unreadCount, mentionCount },
    ]),
  );

function arrange(overrides: Partial<ArrangeSidebarInput<Row>> = {}) {
  return arrangeChannelSidebar<Row>({
    sections: [
      { key: "channels", label: "Channels", channels: [zeta, general, social] },
      { key: CATEGORY_KEY, label: "Executive", channels: [exec, alumni] },
      { key: "direct", label: "Direct messages", channels: [dmMarcus, dmAnna] },
    ],
    pinnedIds: new Set(),
    collapsed: new Set(),
    filters: { unreadOnly: false, hideMuted: false },
    activeChannelId: null,
    titleOf: (row) => row.name,
    unreadByChannelId: new Map(),
    mutedChannelIds: new Set(),
    ...overrides,
  });
}

/** The whole layout as `key: row, row` lines, so an order change anywhere fails. */
const layout = (result: ReturnType<typeof arrange>) =>
  result.sections.map(
    (s) =>
      `${s.key}${s.collapsed ? " (folded)" : ""}: ${s.rows.map((r) => r.id).join(", ")}`,
  );

describe("arrangeChannelSidebar", () => {
  describe("sort", () => {
    it("sorts every section A–Z by the title the row shows", () => {
      expect(layout(arrange())).toEqual([
        "channels: general, social, zeta",
        `${CATEGORY_KEY}: alumni, exec`,
        // By the person's name, not the stored `dm-…` id.
        "direct: dm-a, dm-m",
      ]);
    });

    it("keeps the sections in the order the grouping gave them", () => {
      const result = arrange({
        sections: [
          { key: "direct", label: "Direct messages", channels: [dmMarcus] },
          { key: "channels", label: "Channels", channels: [general] },
        ],
      });
      expect(result.sections.map((s) => s.key)).toEqual(["direct", "channels"]);
    });

    it("puts a section the chapter arranged in its order, unarranged rows after A–Z (#4178)", () => {
      const result = arrange({
        sections: [
          {
            key: "channels",
            label: "Channels",
            channels: [
              { ...general, display_order: 1 },
              { ...zeta, display_order: 0 },
              social,
              alumni,
            ],
          },
        ],
      });
      expect(layout(result)).toEqual([
        "channels: zeta, general, alumni, social",
      ]);
    });

    it("keeps Pinned A–Z whatever order the chapter set, since pins carry none", () => {
      const result = arrange({
        sections: [
          {
            key: "channels",
            label: "Channels",
            channels: [
              { ...zeta, display_order: 0 },
              { ...general, display_order: 1 },
            ],
          },
        ],
        pinnedIds: new Set(["zeta", "general"]),
      });
      expect(layout(result)).toEqual(["pinned: general, zeta"]);
    });

    it("breaks a tie between equal titles by id, so the order is stable", () => {
      const a = ch("b-id", "same");
      const b = ch("a-id", "same");
      const result = arrange({
        sections: [{ key: "channels", label: "Channels", channels: [a, b] }],
      });
      expect(result.sections[0]!.rows.map((r) => r.id)).toEqual([
        "a-id",
        "b-id",
      ]);
    });
  });

  describe("pinned", () => {
    it("moves pinned rows into a Pinned section on top, sorted the same way", () => {
      const result = arrange({ pinnedIds: new Set(["zeta", "dm-m", "exec"]) });
      expect(layout(result)).toEqual([
        "pinned: exec, dm-m, zeta",
        "channels: general, social",
        `${CATEGORY_KEY}: alumni`,
        "direct: dm-a",
      ]);
      expect(result.sections[0]!.label).toBe("Pinned");
    });

    it("draws no Pinned section when nothing is pinned", () => {
      expect(arrange().sections[0]!.key).toBe("channels");
    });

    it("ignores a pinned id that is not in the list", () => {
      expect(arrange({ pinnedIds: new Set(["gone"]) }).sections[0]!.key).toBe(
        "channels",
      );
    });

    it("keeps pinned rows through both filters", () => {
      const result = arrange({
        pinnedIds: new Set(["zeta"]),
        filters: { unreadOnly: true, hideMuted: true },
        mutedChannelIds: new Set(["zeta"]),
        unreadByChannelId: counts({ general: [1, 0] }),
      });
      expect(layout(result)).toEqual(["pinned: zeta", "channels: general"]);
    });
  });

  describe("unread only", () => {
    it("keeps only rows with something unread", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: false },
        unreadByChannelId: counts({ social: [3, 0], exec: [1, 1] }),
      });
      expect(layout(result)).toEqual([
        "channels: social",
        `${CATEGORY_KEY}: exec`,
      ]);
    });

    it("counts an unread DM", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: false },
        unreadByChannelId: counts({ "dm-a": [1, 0] }),
      });
      expect(layout(result)).toEqual(["direct: dm-a"]);
    });

    it("keeps a row whose mention count is set even if its unread count reads 0", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: false },
        unreadByChannelId: counts({ alumni: [0, 1] }),
      });
      expect(layout(result)).toEqual([`${CATEGORY_KEY}: alumni`]);
    });

    it("filters nothing while the counts are unknown", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: false },
        unreadByChannelId: undefined,
      });
      expect(layout(result)).toEqual(layout(arrange()));
      expect(result.emptiedByFilters).toBe(false);
    });

    it("always keeps the open channel", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: false },
        activeChannelId: "zeta",
      });
      expect(layout(result)).toEqual(["channels: zeta"]);
    });
  });

  describe("hide muted", () => {
    it("drops muted rows", () => {
      const result = arrange({
        filters: { unreadOnly: false, hideMuted: true },
        mutedChannelIds: new Set(["general", "social", "zeta", "dm-a"]),
      });
      expect(layout(result)).toEqual([
        `${CATEGORY_KEY}: alumni, exec`,
        "direct: dm-m",
      ]);
    });

    it("keeps a muted row that has an unread @-mention", () => {
      const result = arrange({
        filters: { unreadOnly: false, hideMuted: true },
        mutedChannelIds: new Set(["general", "social"]),
        unreadByChannelId: counts({ general: [4, 1], social: [9, 0] }),
      });
      expect(result.sections[0]!.rows.map((r) => r.id)).toEqual([
        "general",
        "zeta",
      ]);
    });

    it("keeps a muted DM with anything unread, since a DM addresses the member", () => {
      const result = arrange({
        filters: { unreadOnly: false, hideMuted: true },
        mutedChannelIds: new Set(["dm-a", "dm-m"]),
        unreadByChannelId: counts({ "dm-a": [1, 0] }),
      });
      expect(layout(result)).toContain("direct: dm-a");
    });

    it("hides nothing while the levels are unknown", () => {
      const result = arrange({
        filters: { unreadOnly: false, hideMuted: true },
        mutedChannelIds: undefined,
      });
      expect(layout(result)).toEqual(layout(arrange()));
    });

    it("always keeps the open channel", () => {
      const result = arrange({
        filters: { unreadOnly: false, hideMuted: true },
        mutedChannelIds: new Set(["general"]),
        activeChannelId: "general",
      });
      expect(result.sections[0]!.rows.map((r) => r.id)).toContain("general");
    });
  });

  describe("both filters", () => {
    it("keeps a row only when it passes both", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: true },
        // social: unread, not muted → kept. zeta: unread, muted → dropped.
        // general: muted with a mention → kept. alumni: read → dropped.
        mutedChannelIds: new Set(["zeta", "general"]),
        unreadByChannelId: counts({
          social: [2, 0],
          zeta: [5, 0],
          general: [1, 1],
        }),
      });
      expect(layout(result)).toEqual(["channels: general, social"]);
    });

    it("reports that the filters emptied the list", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: true },
      });
      expect(result.sections).toEqual([]);
      expect(result.emptiedByFilters).toBe(true);
    });

    it("does not call an empty chapter emptied by filters", () => {
      const result = arrange({
        sections: [],
        filters: { unreadOnly: true, hideMuted: true },
      });
      expect(result.emptiedByFilters).toBe(false);
    });
  });

  describe("folding", () => {
    it("folds a section to its header, keeping the totals of what it holds", () => {
      const result = arrange({
        collapsed: new Set(["channels"]),
        unreadByChannelId: counts({ general: [3, 0], social: [2, 1] }),
      });
      const channels = result.sections[0]!;
      expect(channels).toMatchObject({
        key: "channels",
        collapsed: true,
        rows: [],
        unreadCount: 5,
        mentionCount: 1,
        addressed: true,
      });
    });

    it("keeps the open channel visible under a folded header", () => {
      const result = arrange({
        collapsed: new Set(["channels"]),
        activeChannelId: "social",
      });
      expect(layout(result)[0]).toBe("channels (folded): social");
    });

    // Shawn, 2026-11-13 (#3999): a muted channel's plain unread stays quiet,
    // as its row reads as read. A mention, or a DM, still gets past the mute.
    it("drops a muted channel's plain unread, keeping one that addresses the member", () => {
      const result = arrange({
        filters: { unreadOnly: true, hideMuted: false },
        mutedChannelIds: new Set(["general", "social", "dm-m"]),
        unreadByChannelId: counts({
          general: [5, 0],
          social: [3, 1],
          zeta: [2, 0],
          "dm-m": [1, 0],
        }),
      });
      expect(layout(result)).toEqual([
        "channels: social, zeta",
        "direct: dm-m",
      ]);
    });

    it("adds nothing to a folded header for a muted channel's plain unread", () => {
      const result = arrange({
        collapsed: new Set(["channels"]),
        mutedChannelIds: new Set(["general", "social"]),
        unreadByChannelId: counts({ general: [7, 0], social: [3, 1] }),
      });
      expect(result.sections[0]).toMatchObject({
        key: "channels",
        unreadCount: 3,
        mentionCount: 1,
        addressedCount: 1,
        addressed: true,
      });
      const quiet = arrange({
        collapsed: new Set(["channels"]),
        mutedChannelIds: new Set(["general"]),
        unreadByChannelId: counts({ general: [7, 0] }),
      });
      expect(quiet.sections[0]).toMatchObject({
        unreadCount: 0,
        mentionCount: 0,
        addressed: false,
      });
    });

    it("counts a muted channel's unread while the mute levels are unknown", () => {
      // Missing data never quiets a row, the rule the filters already follow.
      const result = arrange({
        collapsed: new Set(["channels"]),
        mutedChannelIds: undefined,
        unreadByChannelId: counts({ general: [7, 0] }),
      });
      expect(result.sections[0]).toMatchObject({ unreadCount: 7 });
    });

    it("totals only rows that passed the filters", () => {
      const result = arrange({
        collapsed: new Set(["channels"]),
        filters: { unreadOnly: false, hideMuted: true },
        mutedChannelIds: new Set(["general"]),
        unreadByChannelId: counts({ general: [7, 0], social: [2, 0] }),
      });
      expect(result.sections[0]).toMatchObject({
        unreadCount: 2,
        addressed: false,
      });
    });

    it("marks a folded Direct section addressed when a DM is unread", () => {
      const result = arrange({
        collapsed: new Set(["direct"]),
        unreadByChannelId: counts({ "dm-m": [1, 0] }),
      });
      const direct = result.sections.find((s) => s.key === "direct");
      expect(direct).toMatchObject({ collapsed: true, addressed: true });
    });

    it("folds Pinned and categories by their own keys", () => {
      const result = arrange({
        pinnedIds: new Set(["general"]),
        collapsed: new Set(["pinned", CATEGORY_KEY]),
      });
      expect(layout(result)).toEqual([
        "pinned (folded): ",
        "channels: social, zeta",
        `${CATEGORY_KEY} (folded): `,
        "direct: dm-a, dm-m",
      ]);
    });

    it("ignores a folded key that names no section", () => {
      const result = arrange({ collapsed: new Set(["category:gone"]) });
      expect(layout(result)).toEqual(layout(arrange()));
    });
  });

  it("leaves out a section with no rows", () => {
    const result = arrange({
      sections: [
        { key: "channels", label: "Channels", channels: [] },
        { key: "direct", label: "Direct messages", channels: [dmAnna] },
      ],
    });
    expect(result.sections.map((s) => s.key)).toEqual(["direct"]);
  });
});

describe("sidebarSections", () => {
  const CATEGORY_ID = "0A000000-0000-4000-8000-000000000001";
  const rows: { id: string; type: string; category_id?: string | null }[] = [
    { id: "g", type: "PUBLIC", category_id: null },
    { id: "e", type: "PRIVATE", category_id: CATEGORY_ID },
    { id: "d", type: "DM", category_id: CATEGORY_ID },
  ];

  it("keys every section the way the server stores folds", () => {
    const sections = sidebarSections(
      groupChannelsByCategory(rows, [{ id: CATEGORY_ID, name: "Executive" }]),
      { channels: "Channels", direct: "Direct messages" },
      { label: "System", channels: [{ id: "audit", type: "PUBLIC" }] },
    );
    expect(
      sections.map((s) => [s.key, s.label, s.channels.map((c) => c.id)]),
    ).toEqual([
      ["channels", "Channels", ["g"]],
      // Lower-cased, as Postgres prints a uuid and the server validates it.
      ["category:0a000000-0000-4000-8000-000000000001", "Executive", ["e"]],
      ["direct", "Direct messages", ["d"]],
      ["system", "System", ["audit"]],
    ]);
  });

  it("draws no System section unless the client splits one off", () => {
    const sections = sidebarSections(groupChannelsByCategory(rows, []), {
      channels: "CHANNELS",
      direct: "DIRECT",
    });
    expect(sections.map((s) => s.key)).toEqual(["channels", "direct"]);
  });
});

describe("sidebarUnreadCounts and sidebarMutedChannelIds", () => {
  const unreadRows = [{ channel_id: "a", unread_count: 2, mention_count: 1 }];
  const levelRows = [
    { channel_id: "a", level: "off" },
    { channel_id: "b", level: "mentions" },
  ];

  it("reads the rows once they have loaded", () => {
    expect(sidebarUnreadCounts({ data: unreadRows, isError: false })).toEqual(
      new Map([["a", { unreadCount: 2, mentionCount: 1 }]]),
    );
    expect(sidebarMutedChannelIds({ data: levelRows, isError: false })).toEqual(
      new Set(["a"]),
    );
  });

  it("is unknown before the first read", () => {
    expect(
      sidebarUnreadCounts({ data: undefined, isError: false }),
    ).toBeUndefined();
    expect(
      sidebarMutedChannelIds({ data: undefined, isError: false }),
    ).toBeUndefined();
  });

  it("is unknown after a failed refetch, though the old rows are still there", () => {
    expect(
      sidebarUnreadCounts({ data: unreadRows, isError: true }),
    ).toBeUndefined();
    expect(
      sidebarMutedChannelIds({ data: levelRows, isError: true }),
    ).toBeUndefined();
  });
});

describe("foldedSectionAnnouncement", () => {
  it("names mentions first", () => {
    expect(
      foldedSectionAnnouncement({
        unreadCount: 5,
        mentionCount: 1,
        addressed: true,
      }),
    ).toBe("1 mention, 5 unread");
  });

  it("says when the red comes from direct messages", () => {
    expect(
      foldedSectionAnnouncement({
        unreadCount: 3,
        mentionCount: 0,
        addressed: true,
      }),
    ).toBe("3 unread messages, including direct messages");
  });

  it("is plain unread otherwise", () => {
    expect(
      foldedSectionAnnouncement({
        unreadCount: 1,
        mentionCount: 0,
        addressed: false,
      }),
    ).toBe("1 unread message");
  });
});

describe("compareLatestFirst (#3774)", () => {
  it("puts the newest conversation first, one with no message last, ties A to Z", () => {
    const at: Record<string, string> = {
      a: "2026-11-12T01:00:00.000Z",
      b: "2026-11-12T02:00:00.000Z",
    };
    const title: Record<string, string> = {
      a: "Zed",
      b: "Amy",
      c: "Cal",
      d: "Bo",
    };
    const rows = ["c", "a", "d", "b"].map((id) => ({ id }));
    rows.sort(
      compareLatestFirst(
        (row) => at[row.id],
        (row) => title[row.id]!,
      ),
    );
    expect(rows.map((row) => row.id)).toEqual(["b", "a", "d", "c"]);
  });
});

describe("countsLookUnread (#3999)", () => {
  const plain = { unreadCount: 3, mentionCount: 0 };
  it("draws plain unread as unread unless the channel is muted", () => {
    expect(countsLookUnread(false, plain, false)).toBe(true);
    expect(countsLookUnread(false, plain, true)).toBe(false);
  });
  it("lets a mention or a DM past the mute", () => {
    expect(
      countsLookUnread(false, { unreadCount: 3, mentionCount: 1 }, true),
    ).toBe(true);
    expect(countsLookUnread(true, plain, true)).toBe(true);
  });
  it("treats a mention as unread even when the counts disagree", () => {
    expect(
      countsLookUnread(false, { unreadCount: 0, mentionCount: 1 }, false),
    ).toBe(true);
    expect(
      countsLookUnread(false, { unreadCount: 0, mentionCount: 0 }, false),
    ).toBe(false);
  });
});
