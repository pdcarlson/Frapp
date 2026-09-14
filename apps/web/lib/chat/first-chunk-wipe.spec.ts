/** @vitest-environment jsdom */
/*
  The wipe is the sign-out / chapter-switch half of the tenancy story, and it
  has one job it must not overreach on: delete the read cache and leave the
  outbound queue alone.
*/
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeRow } from "@repo/chat-core/types";
import {
  readFirstChunk,
  resetFirstChunkCacheForTests,
  writeChannelList,
  writeChannelTail,
  type FirstChunkScope,
} from "./first-chunk-cache";
import { FIRST_CHUNK_DB_NAME, wipeFirstChunkCache } from "./first-chunk-wipe";
import { loadDraft, saveDraft } from "./offline-queue";
import type { ChatChannel } from "@/components/chat/channel-list";

const ALICE: FirstChunkScope = { userId: "auth-alice", chapterId: "chapter-1" };
const GENERAL: ChatChannel = { id: "chan-1", name: "general", type: "PUBLIC" };
const AT = Date.now();

const MESSAGE = normalizeRow({
  id: "1",
  channel_id: "chan-1",
  sender_id: "user-1",
  content: "cached before the wipe",
  created_at: "2026-09-14T10:00:01.000Z",
  client_message_id: "client-1",
});

beforeEach(async () => {
  resetFirstChunkCacheForTests();
  await wipeFirstChunkCache();
});

afterEach(() => {
  resetFirstChunkCacheForTests();
});

describe("wipeFirstChunkCache", () => {
  it("removes the cached channel list and every cached tail", async () => {
    /*
      The tail has to be a REAL row. An earlier version of this wrote `[]`,
      which `writeChannelTail` treats as "nothing to cache" — so no tail ever
      existed and the post-wipe `toEqual([])` asserted nothing. Replacing the
      wipe with `channelLists.clear()` would have passed it with every cached
      message still on disk.
    */
    await writeChannelList(ALICE, [GENERAL], AT);
    await writeChannelTail(ALICE, "chan-1", [MESSAGE], AT);
    const before = await readFirstChunk(ALICE);
    expect(before.channels?.channels).toEqual([GENERAL]);
    expect(before.tails).toHaveLength(1);

    resetFirstChunkCacheForTests();
    await wipeFirstChunkCache();

    const chunk = await readFirstChunk(ALICE);
    expect(chunk.channels).toBeNull();
    expect(chunk.tails).toEqual([]);
  });

  it("leaves the outbound drafts and outbox database untouched", async () => {
    /*
      Drafts and the outbox are work the member has not sent yet, in a
      different database (`frapp-chat`). `spec/ui/resilience/principles.md` is
      "never lose a message"; a wipe that reached them would be the one way
      this feature could do that. Keeping the read cache in its own database is
      what makes that impossible rather than merely intended, and this is the
      assertion that says so.

      What this asserts is the *blast radius* of the wipe, not that a draft
      surviving into another member's session is correct — it is not, and
      #2226 tracks the decision between re-keying those tables and clearing
      them. If that lands as "clear", this expectation changes with it.
    */
    await saveDraft("chan-1", "half-written message");
    await writeChannelList(ALICE, [GENERAL], AT);
    await writeChannelTail(ALICE, "chan-1", [MESSAGE], AT);

    resetFirstChunkCacheForTests();
    await wipeFirstChunkCache();

    expect(await loadDraft("chan-1")).toBe("half-written message");
    const chunk = await readFirstChunk(ALICE);
    expect(chunk.channels).toBeNull();
    expect(chunk.tails).toEqual([]);
  });

  it("names a database of its own, not the one the outbox uses", () => {
    expect(FIRST_CHUNK_DB_NAME).not.toBe("frapp-chat");
  });

  it("resolves rather than throwing where IndexedDB does not exist", async () => {
    // SSR and privacy modes. An identity change must never fail on this.
    const real = globalThis.indexedDB;
    // @ts-expect-error -- deleting a global for the duration of one assertion.
    delete globalThis.indexedDB;
    try {
      await expect(wipeFirstChunkCache()).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});
