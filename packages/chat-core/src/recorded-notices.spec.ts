import { describe, expect, test } from "vitest";
import type { KeyValueStore } from "./adapters";
import { emptyCache, locateRow, mergeServerRow } from "./cache";
import {
  mergePersistedRecorded,
  persistRecordedNotice,
  readRecordedNotices,
} from "./recorded-notices";
import { optimisticMessage } from "./types";
import { upsertOptimistic } from "./cache";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

const NOTICE = {
  clientMessageId: "cm-1",
  channelId: "chan-1",
  senderId: "user-1",
  content: "Granting 5 points…",
  note: "Points recorded — the chat card didn't post. Don't run this command again.",
  createdAt: "2026-09-09T00:00:00.000Z",
};

describe("recorded notices (#1789)", () => {
  test("round-trips a notice through the store", () => {
    const kv = memoryStore();
    persistRecordedNotice(NOTICE, kv);
    expect(readRecordedNotices("chan-1", kv)).toEqual([NOTICE]);
  });

  test("rehydrates an absent row as recorded, without a replay handle", () => {
    const kv = memoryStore();
    persistRecordedNotice(NOTICE, kv);
    const cache = mergePersistedRecorded(emptyCache(), {
      channelId: "chan-1",
      userId: "user-1",
      kv,
    });
    const row = cache.byId["cm-1"];
    expect(row).toBeDefined();
    expect(row?._status).toBe("recorded");
    expect(row?._replay).toBeUndefined();
    expect(row?._error).toMatch(/don't run this command again/i);
    expect(row?.created_at).toBe(NOTICE.createdAt);
  });

  test("drops a persisted notice once the server card has confirmed it", () => {
    const kv = memoryStore();
    persistRecordedNotice(NOTICE, kv);
    let cache = emptyCache();
    cache = upsertOptimistic(
      cache,
      optimisticMessage({
        clientMessageId: "cm-1",
        channelId: "chan-1",
        senderId: "user-1",
        content: "Granting 5 points…",
        kind: "loading",
      }),
    );
    cache = mergeServerRow(cache, {
      id: "server-1",
      channel_id: "chan-1",
      sender_id: "user-1",
      content: "+5 points",
      kind: "points",
      client_message_id: "cm-1",
      created_at: "2026-09-09T00:00:01.000Z",
    });
    expect(locateRow(cache, "cm-1")).toBe("confirmed");
    mergePersistedRecorded(cache, {
      channelId: "chan-1",
      userId: "user-1",
      kv,
    });
    expect(readRecordedNotices("chan-1", kv)).toEqual([]);
  });

  test("rehydrates from the notice's sender when userId is omitted", () => {
    const kv = memoryStore();
    persistRecordedNotice(NOTICE, kv);
    const cache = mergePersistedRecorded(emptyCache(), {
      channelId: "chan-1",
      kv,
    });
    expect(cache.byId["cm-1"]?._status).toBe("recorded");
    expect(cache.byId["cm-1"]?.sender_id).toBe("user-1");
  });

  test("drops a corrupt store value so a later persist can write", () => {
    const kv = memoryStore();
    kv.set("chat:recorded:chan-1", "{not-json");
    expect(readRecordedNotices("chan-1", kv)).toEqual([]);
    expect(kv.get("chat:recorded:chan-1")).toBeNull();
    persistRecordedNotice(NOTICE, kv);
    expect(readRecordedNotices("chan-1", kv)).toEqual([NOTICE]);
  });
});
