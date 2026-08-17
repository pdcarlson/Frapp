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

describe("selectChannels", () => {
  it("keeps id, name and type", () => {
    expect(
      selectChannels([
        { id: "c1", name: "general", type: "PUBLIC", extra: "ignored" },
      ]),
    ).toEqual([{ id: "c1", name: "general", type: "PUBLIC" }]);
  });

  it("defaults a missing type to PUBLIC rather than dropping the row", () => {
    expect(selectChannels([{ id: "c1", name: "general" }])).toEqual([
      { id: "c1", name: "general", type: "PUBLIC" },
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
    ).toEqual([{ id: "ok", name: "kept", type: "PUBLIC" }]);
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
      expect(isDirectChannel({ id: "x", name: "n", type })).toBe(true);
    }
    for (const type of chapter) {
      expect(isDirectChannel({ id: "x", name: "n", type })).toBe(false);
    }
  });
});

describe("displayChannelName", () => {
  it("replaces a server-generated DM name — the row must never show a uuid", () => {
    expect(
      displayChannelName({
        id: "c1",
        name: `dm-${UUID_A}-${UUID_B}`,
        type: "DM",
      }),
    ).toBe("Direct message");
  });

  it("replaces a server-generated group DM name", () => {
    expect(
      displayChannelName({
        id: "c1",
        name: "group-dm-1755300000000",
        type: "GROUP_DM",
      }),
    ).toBe("Group message");
  });

  it("keeps a group DM the chapter actually titled", () => {
    expect(
      displayChannelName({ id: "c1", name: "Exec board", type: "GROUP_DM" }),
    ).toBe("Exec board");
  });

  it("never rewrites a chapter channel, even one oddly named", () => {
    // The generated-name patterns must only ever apply to direct channels; a
    // public channel someone called `dm-something` keeps its name.
    expect(
      displayChannelName({
        id: "c1",
        name: `dm-${UUID_A}-${UUID_B}`,
        type: "PUBLIC",
      }),
    ).toBe(`dm-${UUID_A}-${UUID_B}`);
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
