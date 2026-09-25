/** @vitest-environment jsdom */
/*
  Opening a database the *old* code created.

  Every other spec in this directory starts from a deleted database, so none of
  them opens a v1 store at all — they exercise a v2 schema that has never been
  anything else. The member this matters for is the opposite case: someone who
  has been using chat, whose browser holds a v1 database with their channel list
  and tails in it, and who loads the build that adds `viewerIds`. Their warm
  cache must survive, and the new store must be usable afterwards. So this
  builds a real v1 database with the v1 schema, closes it, and opens the
  shipping module on top of it.

  **What this does not establish, stated because it is easy to assume
  otherwise.** It does not validate the *version number*. The declaration was
  mutated — the new store moved into `version(1)` with no `version(2)` at all —
  and both tests below still passed, so `fake-indexeddb` does not model what a
  real browser does with a schema that changed without its version changing.
  The bump stays because Dexie's contract asks for it and because a real
  `indexedDB.open(name, 1)` against an existing v1 database never fires
  `onupgradeneeded`, which would leave the store absent and every write to it
  throwing. That reasoning is not under test here, and no spec in this repo can
  put it under test without a real browser.

  What these two do catch is the destructive failure: a `.stores()` call that
  drops the tables it did not name, which would delete the rows this cache
  exists to serve rather than merely failing to add one.
*/
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIRST_CHUNK_DB_NAME } from "./first-chunk-wipe";
import { wipeFirstChunkCache } from "./first-chunk-wipe";
import {
  TAIL_ROW_FORMAT,
  readFirstChunk,
  resetFirstChunkCacheForTests,
  writeViewerId,
  type FirstChunkScope,
} from "./first-chunk-cache";
import type { ChatChannel } from "@/components/chat/channel-list";

const ALICE: FirstChunkScope = { userId: "auth-alice", chapterId: "chapter-1" };
const RAIL: ChatChannel[] = [{ id: "chan-1", name: "general", type: "PUBLIC" }];
const AT = Date.now();

/** The schema exactly as `first-chunk-cache.ts` declared it before this change. */
async function seedV1Database() {
  const db = new Dexie(FIRST_CHUNK_DB_NAME);
  db.version(1).stores({
    channelLists: "[userId+chapterId]",
    channelTails: "[userId+chapterId+channelId], [userId+chapterId], cachedAt",
  });
  await db.open();
  await db.table("channelLists").put({ ...ALICE, channels: RAIL, cachedAt: AT });
  await db.table("channelTails").put({
    ...ALICE,
    channelId: "chan-1",
    rows: [
      {
        id: "1",
        channel_id: "chan-1",
        sender_id: "user-alice",
        content: "written under v1",
        created_at: new Date(AT).toISOString(),
        client_message_id: "client-1",
      },
    ],
    cachedAt: AT,
    // Stamped as the current encoding, which no real v1 tail ever was: a real
    // one is refused as pre-#2493 (`TAIL_ROW_FORMAT`, pinned in
    // `first-chunk-cache.spec.ts`). The stamp keeps this case about what it
    // tests — that the upgrade keeps the tables it did not name — rather than
    // about the row encoding.
    rowFormat: TAIL_ROW_FORMAT,
  });
  db.close();
}

beforeEach(async () => {
  resetFirstChunkCacheForTests();
  await wipeFirstChunkCache();
});

afterEach(() => {
  resetFirstChunkCacheForTests();
});

describe("first-chunk cache v1 → v2 upgrade (#2249)", () => {
  it("opens a v1 database and keeps the rows already in it", async () => {
    await seedV1Database();
    resetFirstChunkCacheForTests();

    const chunk = await readFirstChunk(ALICE);

    // The member's warm cache survives the upgrade — this is the half that
    // would silently cost them a cold load if the version were mis-declared.
    expect(chunk.channels?.channels).toEqual(RAIL);
    expect(chunk.tails).toHaveLength(1);
    expect(chunk.tails[0]!.rows[0]!.content).toBe("written under v1");
    // And the new row type is simply absent, which is what every first load
    // looks like — not an error, and not a reason to serve nothing.
    expect(chunk.viewer).toBeNull();
  });

  it("accepts a viewer id written after the upgrade", async () => {
    // The upgrade is only useful if the new store is actually usable
    // afterwards; an upgrade that creates a store the writes cannot reach
    // would pass the test above and still never warm anybody's identity.
    await seedV1Database();
    resetFirstChunkCacheForTests();

    await writeViewerId(ALICE, "user-alice", AT);

    const chunk = await readFirstChunk(ALICE);
    expect(chunk.viewer?.viewerUserId).toBe("user-alice");
    expect(chunk.channels?.channels).toEqual(RAIL);
  });
});
