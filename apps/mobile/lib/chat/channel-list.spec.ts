import { describe, expect, it } from "vitest";
import {
  displayChannelName,
  isDirectChannel,
  listedChannels,
  selectCategories,
  selectChannels,
  postRefusalHint,
  selectPostCapability,
  type ChannelPostCapability,
  THREAD_HEADER_FALLBACK,
  threadHeaderTitle,
} from "./channel-list";

/**
 * These three selectors are the whole data path behind s04, and every one of
 * them parses `unknown` — `GET /v1/channels` infers as `never` in the generated
 * SDK, so nothing upstream of here is type-checked against reality.
 *
 * They live in `lib/` rather than beside the screen because expo-router bundles
 * every `.tsx` under `app/` — a spec there drags `vitest` into the Metro graph
 * and breaks the iOS bundle while every local check stays green.
 *
 * The DM cases are not hypothetical: the server names DM channels
 * `dm-<uuidA>-<uuidB>` and group DMs `group-dm-<epoch>`
 * (`apps/api/src/application/services/chat.service.ts`), so the first version of
 * this screen rendered a wall of uuid as the row title.
 */

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const VIEWER = UUID_A;
const OTHER = UUID_B;
const DM_NAME = `dm-${UUID_A}-${UUID_B}`;

/** Roster map as `useMemberDisplayNames().byId` hands it over. */
const NAMES = { [VIEWER]: "Viewer Self", [OTHER]: "Alice Chen" };

describe("selectChannels", () => {
  it("keeps id, name, type and participant ids", () => {
    expect(
      selectChannels([
        {
          id: "c1",
          name: "general",
          type: "PUBLIC",
          member_ids: null,
          extra: "ignored",
        },
      ]),
    ).toEqual([
      {
        id: "c1",
        name: "general",
        type: "PUBLIC",
        member_ids: [],
        hidden: false,
        category_id: null,
      },
    ]);
  });

  it("normalizes member_ids so no consumer needs a null check", () => {
    // Only DM rows populate the column server-side; a null or absent value
    // becomes [] here rather than leaking `undefined` into the name resolver.
    expect(
      selectChannels([
        { id: "c1", name: DM_NAME, type: "DM", member_ids: [VIEWER, OTHER] },
      ]),
    ).toEqual([
      {
        id: "c1",
        name: DM_NAME,
        type: "DM",
        member_ids: [VIEWER, OTHER],
        hidden: false,
        category_id: null,
      },
    ]);
  });

  it("drops non-string entries from member_ids", () => {
    expect(
      selectChannels([
        {
          id: "c1",
          name: "general",
          type: "PUBLIC",
          member_ids: [VIEWER, 7, null],
        },
      ]),
    ).toEqual([
      {
        id: "c1",
        name: "general",
        type: "PUBLIC",
        member_ids: [VIEWER],
        hidden: false,
        category_id: null,
      },
    ]);
  });

  it("defaults a missing type to PUBLIC rather than dropping the row", () => {
    expect(selectChannels([{ id: "c1", name: "general" }])).toEqual([
      {
        id: "c1",
        name: "general",
        type: "PUBLIC",
        member_ids: [],
        hidden: false,
        category_id: null,
      },
    ]);
  });

  it("drops rows with no usable id or name instead of rendering undefined", () => {
    expect(
      selectChannels([
        { id: "c1" },
        { name: "nameless" },
        { id: 7, name: "numeric id" },
        null,
        "not a row",
        { id: "ok", name: "kept", type: "PUBLIC" },
      ]),
    ).toEqual([
      {
        id: "ok",
        name: "kept",
        type: "PUBLIC",
        member_ids: [],
        hidden: false,
        category_id: null,
      },
    ]);
  });

  // #2303: the server keeps a hidden DM in the payload, flagged.
  it("carries the hidden flag, and reads anything but exactly true as not hidden", () => {
    expect(
      selectChannels([
        { id: "a", name: DM_NAME, type: "DM", hidden: true },
        { id: "b", name: DM_NAME, type: "DM", hidden: "true" },
        { id: "c", name: "general", type: "PUBLIC" },
      ]).map((channel) => [channel.id, channel.hidden]),
    ).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });

  // #1684: s04 groups by it, so a mangled value must read as "no category",
  // never drop the row.
  it("carries category_id, and reads anything but a string as uncategorized", () => {
    expect(
      selectChannels([
        { id: "a", name: "exec", type: "PRIVATE", category_id: "cat-exec" },
        { id: "b", name: "general", type: "PUBLIC", category_id: null },
        { id: "c", name: "rush", type: "PUBLIC", category_id: 7 },
        { id: "d", name: "social", type: "PUBLIC" },
      ]).map((channel) => [channel.id, channel.category_id]),
    ).toEqual([
      ["a", "cat-exec"],
      ["b", null],
      ["c", null],
      ["d", null],
    ]);
  });

  it("survives a non-array payload", () => {
    expect(selectChannels(undefined)).toEqual([]);
    expect(selectChannels(null)).toEqual([]);
    expect(selectChannels({ channels: [] })).toEqual([]);
  });
});

describe("selectCategories", () => {
  it("keeps id and name, in the order the server sent them", () => {
    // Not alphabetical on purpose: the server's `display_order` put Executive
    // first, and nothing here may re-sort it.
    expect(
      selectCategories([
        { id: "cat-exec", name: "Executive", display_order: 0, extra: 1 },
        { id: "cat-comm", name: "Committees", display_order: 1 },
      ]),
    ).toEqual([
      { id: "cat-exec", name: "Executive" },
      { id: "cat-comm", name: "Committees" },
    ]);
  });

  it("drops rows with no usable id or name", () => {
    expect(
      selectCategories([
        { id: "cat-a" },
        { name: "nameless" },
        { id: 7, name: "numeric id" },
        null,
        { id: "cat-ok", name: "Kept" },
      ]),
    ).toEqual([{ id: "cat-ok", name: "Kept" }]);
  });

  it("survives a non-array payload", () => {
    expect(selectCategories(undefined)).toEqual([]);
    expect(selectCategories({ categories: [] })).toEqual([]);
  });
});

describe("isDirectChannel", () => {
  it("treats DM and GROUP_DM as direct, everything else as a channel", () => {
    const direct = ["DM", "GROUP_DM"];
    const chapter = ["PUBLIC", "PRIVATE", "ROLE_GATED"];

    for (const type of direct) {
      expect(
        isDirectChannel({
          id: "x",
          name: "n",
          type,
          member_ids: [],
          hidden: false,
          category_id: null,
        }),
      ).toBe(true);
    }
    for (const type of chapter) {
      expect(
        isDirectChannel({
          id: "x",
          name: "n",
          type,
          member_ids: [],
          hidden: false,
          category_id: null,
        }),
      ).toBe(false);
    }
  });
});

describe("displayChannelName", () => {
  it("resolves a 1:1 DM to the other participant's name", () => {
    expect(
      displayChannelName(
        {
          id: "c1",
          name: DM_NAME,
          type: "DM",
          member_ids: [VIEWER, OTHER],
          hidden: false,
          category_id: null,
        },
        VIEWER,
        NAMES,
      ),
    ).toBe("Alice Chen");
  });

  it("falls back to a placeholder when the other participant is unresolvable — never a uuid", () => {
    expect(
      displayChannelName(
        {
          id: "c1",
          name: DM_NAME,
          type: "DM",
          member_ids: [VIEWER, "unknown-user"],
          hidden: false,
          category_id: null,
        },
        VIEWER,
        NAMES,
      ),
    ).toBe("Direct message");
  });

  it("replaces a server-generated group DM name", () => {
    expect(
      displayChannelName(
        {
          id: "c1",
          name: "group-dm-1755300000000",
          type: "GROUP_DM",
          member_ids: [VIEWER],
          hidden: false,
          category_id: null,
        },
        VIEWER,
        NAMES,
      ),
    ).toBe("Group message");
  });

  it("keeps a group DM the chapter actually titled", () => {
    expect(
      displayChannelName(
        {
          id: "c1",
          name: "Exec board",
          type: "GROUP_DM",
          member_ids: [VIEWER, OTHER],
          hidden: false,
          category_id: null,
        },
        VIEWER,
        NAMES,
      ),
    ).toBe("Exec board");
  });

  it("never rewrites a chapter channel, even one oddly named", () => {
    // The generated-name patterns must only ever apply to direct channels; a
    // public channel someone called `dm-something` keeps its name.
    expect(
      displayChannelName(
        {
          id: "c1",
          name: DM_NAME,
          type: "PUBLIC",
          member_ids: [],
          hidden: false,
          category_id: null,
        },
        VIEWER,
        NAMES,
      ),
    ).toBe(DM_NAME);
  });
});

describe("selectPostCapability", () => {
  it("reads can_post and is_read_only off the row", () => {
    expect(
      selectPostCapability({ can_post: false, is_read_only: true }),
    ).toEqual({ canPost: false, isReadOnly: true, isArchived: false });
    expect(
      selectPostCapability({ can_post: true, is_read_only: false }),
    ).toEqual({ canPost: true, isReadOnly: false, isArchived: false });
  });

  it("distinguishes the alumni case (can_post false, not read-only) from read-only", () => {
    expect(
      selectPostCapability({ can_post: false, is_read_only: false }),
    ).toEqual({ canPost: false, isReadOnly: false, isArchived: false });
  });

  // `GET /v1/channels/{id}` still returns an archived Group DM to whoever can
  // read it, with can_post false and is_read_only false (#2199).
  it("reads archived_at, so an archived Group DM isn't mistaken for the alumni case", () => {
    expect(
      selectPostCapability({
        can_post: false,
        is_read_only: false,
        archived_at: "2026-09-30T12:00:00.000Z",
      }),
    ).toEqual({ canPost: false, isReadOnly: false, isArchived: true });
    expect(
      selectPostCapability({ can_post: true, is_read_only: false, archived_at: null }),
    ).toEqual({ canPost: true, isReadOnly: false, isArchived: false });
  });

  it("defaults to postable, not-read-only while the payload hasn't loaded", () => {
    // Matches web's `canPost = true` default — the initial-fetch window
    // should not flash the composer disabled.
    expect(selectPostCapability(undefined)).toEqual({
      canPost: true,
      isReadOnly: false,
      isArchived: false,
    });
    expect(selectPostCapability(null)).toEqual({
      canPost: true,
      isReadOnly: false,
      isArchived: false,
    });
  });

  it("defaults can_post to true on a malformed value rather than locking the composer", () => {
    expect(
      selectPostCapability({ can_post: "no", is_read_only: true }),
    ).toEqual({ canPost: true, isReadOnly: true, isArchived: false });
  });
});

describe("postRefusalHint", () => {
  const capability = (over: Partial<ChannelPostCapability>) => ({
    canPost: false,
    isReadOnly: false,
    isArchived: false,
    ...over,
  });

  it("says nothing when the caller may post", () => {
    expect(postRefusalHint(capability({ canPost: true }))).toBeNull();
  });

  it("explains an archived Group DM as archived, not as the alumni rule (#2199)", () => {
    expect(postRefusalHint(capability({ isArchived: true }))).toBe(
      "This conversation is archived because everyone else left. You can still read it.",
    );
  });

  it("puts archived ahead of read-only, as canAccessChannel does", () => {
    expect(
      postRefusalHint(capability({ isArchived: true, isReadOnly: true })),
    ).toBe(
      "This conversation is archived because everyone else left. You can still read it.",
    );
  });

  it("keeps the read-only and alumni sentences", () => {
    expect(postRefusalHint(capability({ isReadOnly: true }))).toBe(
      "This channel is read-only. Posting requires the announcements:post permission.",
    );
    expect(postRefusalHint(capability({}))).toBe(
      "Alumni can read this channel but not post. Alumni may post in #alumni and direct messages.",
    );
  });
});

describe("listedChannels", () => {
  it("leaves out only the DMs the member hid, keeping order", () => {
    const rows = selectChannels([
      { id: "general", name: "general", type: "PUBLIC" },
      { id: "dm-hidden", name: DM_NAME, type: "DM", hidden: true },
      { id: "dm-shown", name: DM_NAME, type: "DM", hidden: false },
    ]);

    expect(listedChannels(rows).map((channel) => channel.id)).toEqual([
      "general",
      "dm-shown",
    ]);
  });
});

describe("threadHeaderTitle (#2775)", () => {
  const VIEWER = "11111111-1111-4111-8111-111111111111";
  const CASEY = "33333333-3333-4333-8333-333333333333";
  const names = { [CASEY]: "Casey" };
  const title = (overrides: Partial<Parameters<typeof threadHeaderTitle>[0]>) =>
    threadHeaderTitle({
      row: undefined,
      list: undefined,
      channelId: "c1",
      viewerId: VIEWER,
      names,
      isFetching: false,
      ...overrides,
    });

  it("prefixes a channel with #", () => {
    expect(title({ row: { id: "c1", name: "general", type: "PUBLIC" } })).toBe(
      "#general",
    );
  });

  it("names the other member for a DM, with no #", () => {
    expect(
      title({
        channelId: "c2",
        row: {
          id: "c2",
          name: `dm-${VIEWER}-${CASEY}`,
          type: "DM",
          member_ids: [VIEWER, CASEY],
        },
      }),
    ).toBe("Casey");
  });

  it("falls back to the cached list row while the channel's own read hasn't landed", () => {
    expect(
      title({
        list: [
          { id: "c9", name: "dues", type: "PUBLIC" },
          { id: "c1", name: "general", type: "PUBLIC" },
        ],
      }),
    ).toBe("#general");
  });

  it("stays empty while the read is in flight, then says Thread if nothing named it", () => {
    expect(title({ isFetching: true })).toBe("");
    expect(title({})).toBe(THREAD_HEADER_FALLBACK);
    // A row for another channel names nothing.
    expect(title({ row: { id: "c9", name: "dues", type: "PUBLIC" } })).toBe(
      THREAD_HEADER_FALLBACK,
    );
  });
});
