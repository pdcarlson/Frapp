/** @vitest-environment jsdom */
/*
  Exercises the real Dexie store against a real IndexedDB implementation
  (`fake-indexeddb`), not a mock of it.

  That choice is the point of this file. The claim under test is that a row
  written for one member-and-chapter cannot be read back under another, and
  that claim lives in the *primary keys* — `[userId+chapterId]` and
  `[userId+chapterId+channelId]`. A hand-written in-memory stand-in, which is
  how every other Dexie-touching spec in `apps/web` works
  (`use-channel-draft.spec.ts`, `offline-queue.spec.ts`), would be asserting
  that the stand-in keys the way its author believed the schema does. That is
  exactly the proposition that must not be taken on trust here, so this spec
  puts the real schema in front of a real key-range query.
*/
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRow, type RawChatMessage } from "@repo/chat-core/types";
import {
  FIRST_CHUNK_CHANNEL_LIMIT,
  FIRST_CHUNK_MAX_AGE_MS,
  FIRST_CHUNK_MESSAGE_LIMIT,
  TAIL_ROW_FORMAT,
  pruneForeignScopes,
  readFirstChunk,
  resetFirstChunkCacheForTests,
  toCacheableRows,
  writeChannelList,
  writeBlockFloor,
  writeChannelTail,
  writeViewerId,
  type FirstChunkScope,
} from "./first-chunk-cache";
import { FIRST_CHUNK_DB_NAME, wipeFirstChunkCache } from "./first-chunk-wipe";
import type { ChatChannel } from "@/components/chat/channel-list";

const ALICE: FirstChunkScope = { userId: "auth-alice", chapterId: "chapter-1" };
/** Same chapter, different member — the shared-browser case. */
const BOB: FirstChunkScope = { userId: "auth-bob", chapterId: "chapter-1" };
/** Same member, different chapter — the chapter-switch case. */
const ALICE_ELSEWHERE: FirstChunkScope = {
  userId: "auth-alice",
  chapterId: "chapter-2",
};

/*
  "Now", because `cachedAt` is the origin time the reader ages rows against — a
  fixed literal in the past would read as expired and every tail would vanish.
  The one test that needs a controlled clock takes fake timers of its own.
*/
const AT = Date.now();

function channel(id: string, name: string): ChatChannel {
  return { id, name, type: "PUBLIC" };
}

/** The rail as the tests use it: `chan-1` is `#general`, so it is the pinned one. */
const RAIL: ChatChannel[] = [
  channel("chan-1", "general"),
  channel("chan-2", "social"),
  channel("chan-3", "random"),
  channel("chan-4", "rush"),
  channel("chan-9", "exec"),
];

function rawRow(id: string, overrides: Partial<RawChatMessage> = {}) {
  return {
    id,
    channel_id: "chan-1",
    sender_id: "user-1",
    content: `message ${id}`,
    created_at: `2026-09-14T10:00:${id.padStart(2, "0")}.000Z`,
    client_message_id: `client-${id}`,
    ...overrides,
  } satisfies RawChatMessage;
}

/** A confirmed `ChatMessage`, built the way the live cache builds one. */
function confirmed(id: string, overrides: Partial<RawChatMessage> = {}) {
  return normalizeRow(rawRow(id, overrides));
}

/** A tail is only served when the scope's own channel list vouches for it. */
async function seedRail(scope: FirstChunkScope, at = AT) {
  await writeChannelList(scope, RAIL, at);
}

beforeEach(async () => {
  resetFirstChunkCacheForTests();
  await wipeFirstChunkCache();
});

afterEach(() => {
  vi.useRealTimers();
  resetFirstChunkCacheForTests();
});

describe("scope keying", () => {
  it("reads back what it wrote for the same member and chapter", async () => {
    await seedRail(ALICE);
    await writeChannelTail(
      ALICE,
      "chan-1",
      [confirmed("1"), confirmed("2")],
      AT,
    );

    const chunk = await readFirstChunk(ALICE);

    expect(chunk.channels?.channels).toEqual(RAIL);
    expect(chunk.tails).toHaveLength(1);
    expect(chunk.tails[0]!.rows.map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("does not serve one member's rows to another on the same browser", async () => {
    await seedRail(ALICE);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);

    const chunk = await readFirstChunk(BOB);

    expect(chunk.channels).toBeNull();
    expect(chunk.tails).toEqual([]);
  });

  it("does not serve one chapter's rows under another chapter", async () => {
    await seedRail(ALICE);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);

    const chunk = await readFirstChunk(ALICE_ELSEWHERE);

    expect(chunk.channels).toBeNull();
    expect(chunk.tails).toEqual([]);
  });

  it("keeps both scopes' rows side by side rather than overwriting", async () => {
    // The keys are compound, so these are different rows — not the same row
    // written twice. If either half of the key were dropped from the schema,
    // the second write would clobber the first and this would catch it.
    await writeChannelList(ALICE, [channel("c1", "alice")], AT);
    await writeChannelList(BOB, [channel("c2", "bob")], AT);

    expect((await readFirstChunk(ALICE)).channels?.channels).toEqual([
      channel("c1", "alice"),
    ]);
    expect((await readFirstChunk(BOB)).channels?.channels).toEqual([
      channel("c2", "bob"),
    ]);
  });

  it("keeps tails for the same channel id apart across scopes", async () => {
    // A DM or a shared channel id can legitimately appear under two scopes.
    // The tail key carries the scope as well as the channel for that reason.
    await seedRail(ALICE);
    await seedRail(BOB);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);
    await writeChannelTail(BOB, "chan-1", [confirmed("2")], AT);

    expect((await readFirstChunk(ALICE)).tails[0]!.rows[0]!.id).toBe("1");
    expect((await readFirstChunk(BOB)).tails[0]!.rows[0]!.id).toBe("2");
  });

  it("will not serve a tail this scope's own channel list does not vouch for", async () => {
    /*
      Defence in depth behind the key. If a future call site ever persisted a
      tail without going through `usePersistUnderScope` and filed it under the
      wrong scope, the key alone would happily hand it back; the channel list
      is the second opinion that says this tenant has no such channel.
    */
    await writeChannelList(ALICE, [channel("chan-1", "general")], AT);
    await writeChannelTail(ALICE, "chan-unknown", [confirmed("1")], AT);

    const chunk = await readFirstChunk(ALICE);

    expect(chunk.tails).toEqual([]);
  });
});

describe("row encoding (#2313)", () => {
  it("keeps a REST row's cleared verdict, so a warm load paints other members' rows", async () => {
    // Stripping it would rehydrate every cached row unevaluated, and the block
    // list holds unevaluated rows until it loads: a warm load, or a whole
    // offline session, would show only the viewer's own messages. A verdict
    // that predates a block is hidden by the persisted floor instead (#2688).
    await seedRail(ALICE);
    await writeChannelTail(
      ALICE,
      "chan-1",
      [confirmed("1", { sender_blocked: false })],
      AT,
    );

    const chunk = await readFirstChunk(ALICE);
    const row = normalizeRow(chunk.tails[0]!.rows[0]!);

    expect(row._blockEvaluated).toBe(true);
    expect(row.sender_blocked).toBe(false);
  });

  /**
   * A tail as the build before #2493 wrote it: no `rowFormat`, and
   * `sender_blocked` on an echo row, which rehydrates as "the server evaluated
   * this and cleared it" — the one claim the block list lets through while it
   * is unavailable.
   */
  async function seedUnstampedTail() {
    resetFirstChunkCacheForTests();
    const db = new Dexie(FIRST_CHUNK_DB_NAME);
    db.version(2).stores({
      channelLists: "[userId+chapterId]",
      channelTails:
        "[userId+chapterId+channelId], [userId+chapterId], cachedAt",
      viewerIds: "[userId+chapterId]",
    });
    await db.open();
    await db.table("channelTails").put({
      ...ALICE,
      channelId: "chan-1",
      rows: [rawRow("1", { sender_blocked: false })],
      cachedAt: AT,
    });
    db.close();
  }

  it("stamps every tail it writes with the current encoding", async () => {
    await seedRail(ALICE);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);

    const chunk = await readFirstChunk(ALICE);
    expect(chunk.tails[0]!.rowFormat).toBe(TAIL_ROW_FORMAT);
  });

  it("refuses a tail written before the encoding was stamped", async () => {
    await seedRail(ALICE);
    await seedUnstampedTail();

    const chunk = await readFirstChunk(ALICE);

    // The rail is still served: only the row encoding changed.
    expect(chunk.channels?.channels).toEqual(RAIL);
    expect(chunk.tails).toEqual([]);
  });

  it("serves the channel again once it is rewritten in the current encoding", async () => {
    await seedRail(ALICE);
    await seedUnstampedTail();
    resetFirstChunkCacheForTests();
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);

    const chunk = await readFirstChunk(ALICE);
    expect(chunk.tails.map((tail) => tail.channelId)).toEqual(["chan-1"]);
  });
});

describe("pruneForeignScopes", () => {
  it("deletes every other scope's rows and keeps the current one's", async () => {
    await seedRail(ALICE);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);
    await seedRail(BOB);
    await writeChannelTail(BOB, "chan-9", [confirmed("2")], AT);
    await writeChannelList(ALICE_ELSEWHERE, [channel("c3", "other")], AT);

    await pruneForeignScopes(ALICE);

    expect((await readFirstChunk(ALICE)).channels?.channels).toEqual(RAIL);
    expect((await readFirstChunk(ALICE)).tails).toHaveLength(1);
    expect((await readFirstChunk(BOB)).channels).toBeNull();
    expect((await readFirstChunk(BOB)).tails).toEqual([]);
    expect((await readFirstChunk(ALICE_ELSEWHERE)).channels).toBeNull();
  });

  it("is what makes a wipe that never ran still safe", async () => {
    /*
      `wipeFirstChunkCache` is un-awaited and can be cut short by a navigation,
      or blocked outright by a second tab. The next member to sign in on this
      browser runs the prune before any read — this asserts the previous
      member's rows are gone by then even though nothing deleted them at
      sign-out.
    */
    await seedRail(ALICE);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);

    await pruneForeignScopes(BOB);

    expect((await readFirstChunk(ALICE)).channels).toBeNull();
    expect((await readFirstChunk(ALICE)).tails).toEqual([]);
  });
});

describe("bounds", () => {
  it(`keeps at most ${FIRST_CHUNK_MESSAGE_LIMIT} messages, the newest ones`, async () => {
    await seedRail(ALICE);
    const messages = Array.from({ length: 45 }, (_, i) =>
      confirmed(String(i).padStart(2, "0")),
    );

    await writeChannelTail(ALICE, "chan-1", messages, AT);

    const rows = (await readFirstChunk(ALICE)).tails[0]!.rows;
    expect(rows).toHaveLength(FIRST_CHUNK_MESSAGE_LIMIT);
    expect(rows[rows.length - 1]!.id).toBe("44");
    expect(rows[0]!.id).toBe(String(45 - FIRST_CHUNK_MESSAGE_LIMIT));
  });

  it(`keeps at most ${FIRST_CHUNK_CHANNEL_LIMIT} tails per scope, evicting the oldest`, async () => {
    await seedRail(ALICE);
    // `chan-1` is `#general` and therefore pinned, so the eviction victims come
    // from the rest in write order.
    for (const [index, id] of ["chan-2", "chan-3", "chan-4", "chan-9"].entries()) {
      await writeChannelTail(ALICE, id, [confirmed("1")], AT + index);
    }

    const tails = (await readFirstChunk(ALICE)).tails;
    expect(tails).toHaveLength(FIRST_CHUNK_CHANNEL_LIMIT);
    expect(tails.map((row) => row.channelId).sort()).toEqual([
      "chan-3",
      "chan-4",
      "chan-9",
    ]);
  });

  it("never evicts the channel a cold load will land on", async () => {
    /*
      The regression this exists for. Eviction used to keep the three most
      recently written tails, while `chat-shell.tsx` sends any load without a
      `?channel=` to `#general`. A member who read `#general` first and three
      other channels after it evicted exactly the tail their next reload would
      ask for — the cache missing on the commonest cold load there is.
      `default-channel.ts` is now the one rule both sides read.
    */
    await seedRail(ALICE);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);
    for (const [index, id] of ["chan-2", "chan-3", "chan-4"].entries()) {
      await writeChannelTail(ALICE, id, [confirmed("2")], AT + 100 + index);
    }

    const tails = (await readFirstChunk(ALICE)).tails;
    expect(tails.map((row) => row.channelId)).toContain("chan-1");
    expect(tails).toHaveLength(FIRST_CHUNK_CHANNEL_LIMIT);
  });

  it("ignores rows past the maximum age instead of painting them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const at = Date.now();
    await writeChannelList(ALICE, RAIL, at);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], at);

    vi.setSystemTime(at + FIRST_CHUNK_MAX_AGE_MS + 1);
    const chunk = await readFirstChunk(ALICE);

    expect(chunk.channels).toBeNull();
    expect(chunk.tails).toEqual([]);
  });

  it("dates a row by when the server produced it, not by when it was written", async () => {
    /*
      Re-seeding a cached row counts as a query update, so the persist path
      writes it straight back out. When the write stamped `Date.now()` that
      renewed the age of the rows it had just read, and nothing could ever
      expire: a member opening the dashboard offline once a week would see an
      ever-older timeline that always read as fresh. `cachedAt` is the origin
      time the caller passes, so a re-write of unchanged rows preserves it.
    */
    vi.useFakeTimers({ toFake: ["Date"] });
    const origin = new Date("2026-09-01T00:00:00.000Z").getTime();
    vi.setSystemTime(origin);
    await writeChannelList(ALICE, RAIL, origin);

    // Six days later the cache is re-read and written straight back.
    vi.setSystemTime(origin + 6 * 24 * 60 * 60 * 1000);
    const reseeded = await readFirstChunk(ALICE);
    await writeChannelList(ALICE, RAIL, reseeded.channels!.cachedAt);

    // Two days after that it is past the limit — which it could not be if the
    // re-write had restamped it.
    vi.setSystemTime(origin + 8 * 24 * 60 * 60 * 1000);
    expect((await readFirstChunk(ALICE)).channels).toBeNull();
  });
});

describe("what is written", () => {
  it("stores only confirmed rows, leaving queued ones to the outbox", async () => {
    /*
      `hydrateOutboxIntoCache` replays pending, failed and unconfirmed rows on
      top of whatever the timeline starts from. A copy here would render each
      queued message twice on a cold load and would let this cache contradict
      the outbox about a status the outbox owns.
    */
    await seedRail(ALICE);
    const pending = { ...confirmed("2"), _status: "pending" as const };
    const failed = { ...confirmed("3"), _status: "failed" as const };
    const unconfirmed = { ...confirmed("4"), _status: "unconfirmed" as const };
    const recorded = { ...confirmed("5"), _status: "recorded" as const };

    await writeChannelTail(
      ALICE,
      "chan-1",
      [confirmed("1"), pending, failed, unconfirmed, recorded],
      AT,
    );

    const rows = (await readFirstChunk(ALICE)).tails[0]!.rows;
    expect(rows.map((row) => row.id)).toEqual(["1"]);
  });

  it("skips — never deletes — a tail with nothing cacheable in it", async () => {
    /*
      The destructive case. An offline member's timeline can hold nothing but
      queued outbox rows, which filter out to nothing here. Treating that as a
      delete destroyed the very tail their next cold load needed, in the one
      situation where no fetch was coming to rebuild it.
    */
    await seedRail(ALICE);
    await writeChannelTail(ALICE, "chan-1", [confirmed("1")], AT);
    const queuedOnly = [{ ...confirmed("2"), _status: "pending" as const }];

    await writeChannelTail(ALICE, "chan-1", queuedOnly, AT + 1);

    const rows = (await readFirstChunk(ALICE)).tails[0]!.rows;
    expect(rows.map((row) => row.id)).toEqual(["1"]);
  });

  it("deletes rather than writes an empty channel list", async () => {
    /*
      Unlike a tail, an empty channel list is a real paintable state: seeding
      `[]` would move `chat-shell.tsx`'s `channelsPaneState` straight to its
      terminal `empty` / `no-chapter` explanation over a load still in flight.
    */
    await writeChannelList(ALICE, RAIL, AT);
    await writeChannelList(ALICE, [], AT + 1);

    expect((await readFirstChunk(ALICE)).channels).toBeNull();
  });

  it("survives the round trip back through the canonical normalizer", async () => {
    /*
      Rows are stored in the wire shape and rehydrated with `mergeServerRows`,
      so what matters is that `normalizeRow(toRawRow(m))` equals `m`. Asserting
      the field list directly would only restate the projection; this catches a
      field the projection forgets — `attachment_count`, which travels inside
      `metadata` and is the one that does not round-trip by being copied across.
    */
    await seedRail(ALICE);
    const original = normalizeRow(
      rawRow("7", {
        author_name: "Casey",
        author_avatar_path: "avatars/casey.png",
        kind: "poll",
        payload: { question: "Pig Dinner?" },
        reply_to_id: "6",
        is_pinned: true,
        pinned_at: "2026-09-14T10:05:00.000Z",
        edited_at: "2026-09-14T10:06:00.000Z",
        metadata: { attachment_count: 3 },
      }),
    );
    expect(original.attachment_count).toBe(3);

    await writeChannelTail(ALICE, "chan-1", [original], AT);
    const stored = (await readFirstChunk(ALICE)).tails[0]!.rows[0]!;

    expect(normalizeRow(stored)).toEqual(original);
  });

  it("keeps reactions out, because the board puts them after paint", () => {
    const withReactions = {
      ...confirmed("1"),
      reactions: { "reaction:🔥": ["user-2"] },
    };

    const [row] = toCacheableRows([withReactions]);

    expect(row).not.toHaveProperty("reactions");
    expect(normalizeRow(row!).reactions).toEqual({});
  });
});

/*
  The viewer id row (#2249).

  Same file as the rows above and for the same reason the header gives: the
  claim is about the *primary key*, so it is put in front of a real key-range
  query rather than a stand-in that keys the way its author believed.

  What makes this row worth its own block is that getting it wrong is not a cold
  load. `users.id` decides which of `components.md` §11's two bubble shapes a row
  takes, so a viewer id served under the wrong scope is the #2243 mis-ID again
  with a cache behind it instead of a race — a member's own history painted as
  somebody else's, or worse, another member's id painted as theirs.
*/
describe("cached viewer id", () => {
  /* `users.id`, deliberately unlike the `auth-*` uids the rows are keyed on. */
  const ALICE_VIEWER = "user-alice";
  const BOB_VIEWER = "user-bob";

  it("reads back the id it wrote for the same member and chapter", async () => {
    await writeViewerId(ALICE, ALICE_VIEWER, AT);

    const chunk = await readFirstChunk(ALICE);

    expect(chunk.viewer?.viewerUserId).toBe(ALICE_VIEWER);
  });

  it("does not serve one member's viewer id to another on the same browser", async () => {
    // The whole reason this row is allowed to exist. If Bob could read Alice's
    // `users.id`, the cache would paint Alice's messages as Bob's own — the
    // exact cross-account authorship bug the keying exists to make impossible,
    // and strictly worse than the race #2255 fixed.
    await writeViewerId(ALICE, ALICE_VIEWER, AT);

    const chunk = await readFirstChunk(BOB);

    expect(chunk.viewer).toBeNull();
  });

  it("keeps each member's own id when both have signed in on this browser", async () => {
    // Not implied by the test above: a single shared row that simply got
    // overwritten by the second writer would also return `null` for nobody, and
    // would return *Bob's* id to Alice. Asserted both ways round.
    await writeViewerId(ALICE, ALICE_VIEWER, AT);
    await writeViewerId(BOB, BOB_VIEWER, AT);

    expect((await readFirstChunk(ALICE)).viewer?.viewerUserId).toBe(
      ALICE_VIEWER,
    );
    expect((await readFirstChunk(BOB)).viewer?.viewerUserId).toBe(BOB_VIEWER);
  });

  it("does not serve one chapter's viewer id under another chapter", async () => {
    // `users.id` does not depend on the chapter, so this row could have been
    // keyed on the uid alone. It is not, and this pins that: the scope is the
    // same one the rows it attributes are keyed on, which is what lets it ride
    // the wipe and the prune with no second rule to keep right.
    await writeViewerId(ALICE, ALICE_VIEWER, AT);

    const chunk = await readFirstChunk(ALICE_ELSEWHERE);

    expect(chunk.viewer).toBeNull();
  });

  it("stops serving an id older than the max age", async () => {
    await writeViewerId(ALICE, ALICE_VIEWER, AT - FIRST_CHUNK_MAX_AGE_MS - 1);

    const chunk = await readFirstChunk(ALICE);

    // The one way this row goes stale without its key changing is an account
    // deleted and recreated under the same auth uid, which mints a new
    // `users.id`. The age bound is what stops that lasting.
    expect(chunk.viewer).toBeNull();
  });

  it("serves the id even when the channel list has expired", async () => {
    // Deliberately not gated on the rail the way a tail is. A tail needs the
    // list to vouch for its `channelId`, which is the one part of its key the
    // scope does not attest; the viewer id's whole key *is* the scope. Gating
    // it would withhold the id in the case it is most needed — fresh tails
    // under an expired rail would paint rows with no side to put them on.
    await writeChannelList(ALICE, RAIL, AT - FIRST_CHUNK_MAX_AGE_MS - 1);
    await writeViewerId(ALICE, ALICE_VIEWER, AT);

    const chunk = await readFirstChunk(ALICE);

    expect(chunk.channels).toBeNull();
    expect(chunk.viewer?.viewerUserId).toBe(ALICE_VIEWER);
  });

  it("refuses an empty id rather than deleting the good row it has", async () => {
    // An empty id means "identity has not resolved", which is what a missing
    // row already says. Deleting on it would throw away a usable id on the
    // strength of a value that means nothing — and the next warm load would pay
    // the round trip this cache exists to remove.
    await writeViewerId(ALICE, ALICE_VIEWER, AT);
    await writeViewerId(ALICE, "", AT + 1);

    expect((await readFirstChunk(ALICE)).viewer?.viewerUserId).toBe(
      ALICE_VIEWER,
    );
  });

  it("is dropped by the prune when it belongs to another scope", async () => {
    // The backstop half of the wipe pair has to know about this table too — a
    // `bulkDelete` over two of three tables leaves exactly the row that decides
    // authorship sitting on a shared machine.
    await writeViewerId(ALICE, ALICE_VIEWER, AT);
    await writeViewerId(BOB, BOB_VIEWER, AT);

    await pruneForeignScopes(BOB);

    expect((await readFirstChunk(BOB)).viewer?.viewerUserId).toBe(BOB_VIEWER);
    expect((await readFirstChunk(ALICE)).viewer).toBeNull();
  });

  it("is gone after the wipe a sign-out fires", async () => {
    // `wipeFirstChunkCache` deletes the whole database rather than clearing
    // named tables, so a new row type rides it — asserted rather than assumed,
    // because "the wipe covers it" is the kind of claim that stays true only
    // while nobody moves the row to another database.
    await writeViewerId(ALICE, ALICE_VIEWER, AT);

    resetFirstChunkCacheForTests();
    await wipeFirstChunkCache();

    expect((await readFirstChunk(ALICE)).viewer).toBeNull();
  });
});

/*
  The block list's floor (#2688). It shares the viewer id's per-scope row, so
  the property that matters beyond scoping is that neither writer drops the
  other's field.
*/
describe("block-list floor", () => {
  const ALICE_VIEWER = "user-alice";
  const BLAKE = "user-blake";
  const ZED = "user-zed";

  it("reads back the ids a ready read wrote, sorted", async () => {
    await writeBlockFloor(ALICE, new Set([ZED, BLAKE]), AT);

    const chunk = await readFirstChunk(ALICE);

    expect(chunk.blockFloor).toEqual({ ...ALICE, ids: [BLAKE, ZED], readAt: AT });
  });

  it("does not serve one member's blocks to another, or across chapters", async () => {
    await writeBlockFloor(ALICE, [BLAKE], AT);

    expect((await readFirstChunk(BOB)).blockFloor).toBeNull();
    expect((await readFirstChunk(ALICE_ELSEWHERE)).blockFloor).toBeNull();
  });

  it("keeps the viewer id when the floor is written, and the floor when the id is", async () => {
    await writeViewerId(ALICE, ALICE_VIEWER, AT);
    await writeBlockFloor(ALICE, [BLAKE], AT);
    await writeViewerId(ALICE, ALICE_VIEWER, AT + 1);

    const chunk = await readFirstChunk(ALICE);

    expect(chunk.viewer?.viewerUserId).toBe(ALICE_VIEWER);
    expect(chunk.blockFloor?.ids).toEqual([BLAKE]);
  });

  it("serves no viewer id from a row that holds only a floor", async () => {
    // A ready list can land before `GET /v1/users/me` does.
    await writeBlockFloor(ALICE, [BLAKE], AT);

    const chunk = await readFirstChunk(ALICE);

    expect(chunk.viewer).toBeNull();
    expect(chunk.blockFloor?.ids).toEqual([BLAKE]);
  });

  it("is replaced, not merged, by the next ready read, an empty one included", async () => {
    // An empty ready list is what retires a member unblocked since.
    await writeBlockFloor(ALICE, [BLAKE], AT);
    await writeBlockFloor(ALICE, [], AT + 1);

    expect((await readFirstChunk(ALICE)).blockFloor?.ids).toEqual([]);
  });

  it("stops serving a floor older than the max age", async () => {
    await writeBlockFloor(ALICE, [BLAKE], AT - FIRST_CHUNK_MAX_AGE_MS - 1);

    expect((await readFirstChunk(ALICE)).blockFloor).toBeNull();
  });

  it("is dropped by the prune and by the wipe", async () => {
    await writeBlockFloor(ALICE, [BLAKE], AT);
    await writeBlockFloor(BOB, [ZED], AT);

    await pruneForeignScopes(BOB);
    expect((await readFirstChunk(ALICE)).blockFloor).toBeNull();
    expect((await readFirstChunk(BOB)).blockFloor?.ids).toEqual([ZED]);

    resetFirstChunkCacheForTests();
    await wipeFirstChunkCache();
    expect((await readFirstChunk(BOB)).blockFloor).toBeNull();
  });
});

describe("degrading", () => {
  it("answers empty rather than throwing when IndexedDB is unavailable", async () => {
    // Private windows and blocked site data. `use-channel-draft.ts` already
    // degrades this way for drafts; a placeholder cache is never worth a
    // broken shell.
    resetFirstChunkCacheForTests();
    const real = globalThis.indexedDB;
    // @ts-expect-error -- deleting a global for the duration of one assertion.
    delete globalThis.indexedDB;
    try {
      await expect(readFirstChunk(ALICE)).resolves.toEqual({
        channels: null,
        tails: [],
        viewer: null,
        blockFloor: null,
      });
      await expect(
        writeChannelList(ALICE, RAIL, AT),
      ).resolves.toBeUndefined();
      await expect(
        writeViewerId(ALICE, "user-alice", AT),
      ).resolves.toBeUndefined();
      await expect(
        writeBlockFloor(ALICE, ["user-blake"], AT),
      ).resolves.toBeUndefined();
      await expect(pruneForeignScopes(ALICE)).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});
