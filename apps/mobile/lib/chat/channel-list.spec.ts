import { describe, expect, it } from "vitest";
import {
  displayChannelName,
  indexUnread,
  isDirectChannel,
  selectChannels,
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
    ).toEqual([{ id: "c1", name: "general", type: "PUBLIC", member_ids: [] }]);
  });

  it("normalizes member_ids so no consumer needs a null check", () => {
    // Only DM rows populate the column server-side; a null or absent value
    // becomes [] here rather than leaking `undefined` into the name resolver.
    expect(
      selectChannels([
        { id: "c1", name: DM_NAME, type: "DM", member_ids: [VIEWER, OTHER] },
      ]),
    ).toEqual([
      { id: "c1", name: DM_NAME, type: "DM", member_ids: [VIEWER, OTHER] },
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
      { id: "c1", name: "general", type: "PUBLIC", member_ids: [VIEWER] },
    ]);
  });

  it("defaults a missing type to PUBLIC rather than dropping the row", () => {
    expect(selectChannels([{ id: "c1", name: "general" }])).toEqual([
      { id: "c1", name: "general", type: "PUBLIC", member_ids: [] },
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
    ).toEqual([{ id: "ok", name: "kept", type: "PUBLIC", member_ids: [] }]);
  });

  it("survives a non-array payload", () => {
    expect(selectChannels(undefined)).toEqual([]);
    expect(selectChannels(null)).toEqual([]);
    expect(selectChannels({ channels: [] })).toEqual([]);
  });
});

describe("isDirectChannel", () => {
  it("treats DM and GROUP_DM as direct, everything else as a channel", () => {
    const direct = ["DM", "GROUP_DM"];
    const chapter = ["PUBLIC", "PRIVATE", "ROLE_GATED"];

    for (const type of direct) {
      expect(
        isDirectChannel({ id: "x", name: "n", type, member_ids: [] }),
      ).toBe(true);
    }
    for (const type of chapter) {
      expect(
        isDirectChannel({ id: "x", name: "n", type, member_ids: [] }),
      ).toBe(false);
    }
  });
});

describe("displayChannelName", () => {
  it("resolves a 1:1 DM to the other participant's name", () => {
    expect(
      displayChannelName(
        { id: "c1", name: DM_NAME, type: "DM", member_ids: [VIEWER, OTHER] },
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
        { id: "c1", name: DM_NAME, type: "PUBLIC", member_ids: [] },
        VIEWER,
        NAMES,
      ),
    ).toBe(DM_NAME);
  });
});

describe("indexUnread", () => {
  it("keys counts by channel id", () => {
    expect(
      indexUnread([
        { channel_id: "c1", unread_count: 7, mention_count: 0 },
        { channel_id: "c2", unread_count: 9, mention_count: 2 },
      ]),
    ).toEqual({
      c1: { unread: 7, mentions: 0 },
      c2: { unread: 9, mentions: 2 },
    });
  });

  it("keeps explicit zeros — the endpoint returns a row per readable channel", () => {
    // A zero row is meaningful: it says "readable, and fully read". Dropping it
    // would be indistinguishable from "no data", which is what the error path
    // means.
    expect(
      indexUnread([{ channel_id: "c1", unread_count: 0, mention_count: 0 }]),
    ).toEqual({ c1: { unread: 0, mentions: 0 } });
  });

  it("returns an empty index for no rows", () => {
    expect(indexUnread([])).toEqual({});
  });
});
