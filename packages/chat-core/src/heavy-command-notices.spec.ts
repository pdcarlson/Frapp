import { describe, expect, test, vi } from "vitest";
import {
  emptyCache,
  locateRow,
  mergeServerRow,
  upsertOptimistic,
} from "./cache";
import {
  dropNotices,
  mergePersistedNotices,
  persistNotice,
  readNotices,
} from "./heavy-command-notices";
import { optimisticMessage } from "./types";
import { memoryStore } from "./test/memory-store";
import {
  pointsReplay,
  recordedNotice,
  unconfirmedNotice,
} from "./test/notices";

const KEY = "chat:recorded:chan-1";

function cardEcho(clientMessageId = "cm-1") {
  return {
    id: "server-1",
    channel_id: "chan-1",
    sender_id: "user-1",
    content: "+5 points",
    kind: "points",
    client_message_id: clientMessageId,
    created_at: "2026-09-09T00:00:01.000Z",
  };
}

describe("heavy-command notices — recorded (#1789)", () => {
  test("round-trips a notice through the store", () => {
    const kv = memoryStore();
    persistNotice(recordedNotice(), kv);
    expect(readNotices("chan-1", kv)).toEqual([recordedNotice()]);
  });

  // #1789 shipped these entries without `status`, and they are still on disk.
  test("reads a pre-status entry as recorded rather than dropping it", () => {
    const kv = memoryStore();
    const legacy: Partial<ReturnType<typeof recordedNotice>> = recordedNotice();
    delete legacy.status;
    kv.set(KEY, JSON.stringify([legacy]));
    expect(readNotices("chan-1", kv)).toEqual([recordedNotice()]);
  });

  test("rehydrates an absent row as recorded, without a replay handle", () => {
    const kv = memoryStore();
    persistNotice(recordedNotice(), kv);
    const cache = mergePersistedNotices(emptyCache(), {
      channelId: "chan-1",
      viewerId: "user-1",
      kv,
    });
    const row = cache.byId["cm-1"];
    expect(row).toBeDefined();
    expect(row?._status).toBe("recorded");
    expect(row?._replay).toBeUndefined();
    expect(row?._error).toMatch(/don't run this command again/i);
    expect(row?.created_at).toBe(recordedNotice().createdAt);
  });

  test("drops a persisted notice once the server card has confirmed it", () => {
    const kv = memoryStore();
    persistNotice(recordedNotice(), kv);
    let cache = upsertOptimistic(
      emptyCache(),
      optimisticMessage({
        clientMessageId: "cm-1",
        channelId: "chan-1",
        senderId: "user-1",
        content: "Granting 5 points…",
        kind: "loading",
      }),
    );
    cache = mergeServerRow(cache, cardEcho());
    expect(locateRow(cache, "cm-1")).toBe("confirmed");
    mergePersistedNotices(cache, { channelId: "chan-1", viewerId: "user-1", kv });
    expect(readNotices("chan-1", kv)).toEqual([]);
  });

  test("drops a corrupt store value so a later persist can write", () => {
    const kv = memoryStore();
    kv.set(KEY, "{not-json");
    expect(readNotices("chan-1", kv)).toEqual([]);
    expect(kv.get(KEY)).toBeNull();
    persistNotice(recordedNotice(), kv);
    expect(readNotices("chan-1", kv)).toEqual([recordedNotice()]);
  });
});

describe("heavy-command notices — unconfirmed (#1909)", () => {
  test("rehydrates an absent row as unconfirmed, carrying its original replay", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);

    const cache = mergePersistedNotices(emptyCache(), {
      channelId: "chan-1",
      viewerId: "user-1",
      kv,
    });

    const row = cache.byId["cm-1"];
    expect(row?._status).toBe("unconfirmed");
    expect(row?.kind).toBe("loading");
    expect(row?.content).toBe("Granting 5 points…");
    // The whole point: Retry must replay the ORIGINAL key, so the server's
    // dedupe index recognises it rather than writing a second ledger row.
    expect(row?._replay).toEqual(pointsReplay());
    expect(row?._replay?.body.client_message_id).toBe("cm-1");
  });

  test("a recorded outcome replaces the unconfirmed entry instead of adding a second", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    persistNotice(recordedNotice(), kv);
    expect(readNotices("chan-1", kv)).toEqual([recordedNotice()]);
  });

  test("drops an unconfirmed entry once its card is confirmed", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const cache = mergeServerRow(emptyCache(), cardEcho());
    const merged = mergePersistedNotices(cache, {
      channelId: "chan-1",
      viewerId: "user-1",
      kv,
    });
    expect(readNotices("chan-1", kv)).toEqual([]);
    expect(merged.byId["cm-1"]).toBeUndefined();
  });

  // A rebuild restores; it never overrides this session's own row, which is
  // newer than the stored copy (e.g. mid-retry).
  test("leaves a row that is still in the cache alone", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice({ note: "stored note" }), kv);
    const live = upsertOptimistic(
      emptyCache(),
      optimisticMessage({
        clientMessageId: "cm-1",
        channelId: "chan-1",
        senderId: "user-1",
        content: "Granting 5 points…",
        kind: "loading",
      }),
    );
    const merged = mergePersistedNotices(live, {
      channelId: "chan-1",
      viewerId: "user-1",
      kv,
    });
    expect(merged.byId["cm-1"]?._status).toBe("pending");
  });

  // A member on a shared browser must never be handed another member's Retry:
  // if the original never committed, pressing it writes a fresh grant under
  // THEIR name (`idx_point_transactions_dedupe` is `(chapter_id,
  // client_message_id)` and `resolveReplay` only 409s a committed original).
  test("restores nothing for another member, and keeps their entry on disk", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    persistNotice(recordedNotice({ clientMessageId: "cm-2" }), kv);

    const cache = mergePersistedNotices(emptyCache(), {
      channelId: "chan-1",
      viewerId: "user-9",
      kv,
    });

    expect(cache.order).toEqual([]);
    expect(readNotices("chan-1", kv)).toHaveLength(2);
  });

  test("restores nothing before the viewer is known", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const cache = mergePersistedNotices(emptyCache(), {
      channelId: "chan-1",
      viewerId: null,
      kv,
    });
    expect(cache.order).toEqual([]);
    expect(readNotices("chan-1", kv)).toHaveLength(1);
  });

  // A replay rebuilt from a partial record would send a DIFFERENT request under
  // the original key.
  test.each([
    ["no replay", { replay: undefined }],
    [
      "a replay under another key",
      { replay: pointsReplay("cm-other") },
    ],
    [
      "a replay for another channel",
      { replay: pointsReplay("cm-1", "chan-2") },
    ],
    [
      "a body missing its reason",
      {
        replay: {
          ...pointsReplay(),
          body: { ...pointsReplay().body, reason: undefined },
        },
      },
    ],
    [
      "a fractional amount",
      {
        replay: {
          ...pointsReplay(),
          body: { ...pointsReplay().body, amount: 2.5 },
        },
      },
    ],
  ])("drops an unconfirmed entry with %s", (_label, override) => {
    const kv = memoryStore();
    kv.set(KEY, JSON.stringify([{ ...unconfirmedNotice(), ...override }]));
    expect(readNotices("chan-1", kv)).toEqual([]);
  });

  test("drops an entry filed under another channel's key", () => {
    const kv = memoryStore();
    kv.set(KEY, JSON.stringify([unconfirmedNotice({ channelId: "chan-2" })]));
    expect(readNotices("chan-1", kv)).toEqual([]);
  });
});

describe("dropNotices", () => {
  test("removes only the named entries, and the key with the last one", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    persistNotice(unconfirmedNotice({ clientMessageId: "cm-2" }), kv);

    dropNotices("chan-1", ["cm-1", null, undefined], kv);
    expect(readNotices("chan-1", kv).map((n) => n.clientMessageId)).toEqual([
      "cm-2",
    ]);

    dropNotices("chan-1", ["cm-2"], kv);
    expect(kv.get(KEY)).toBeNull();
  });

  // It runs on every Realtime echo, so the common case must not write.
  test("does not write when nothing matches", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const set = vi.spyOn(kv, "set");
    const remove = vi.spyOn(kv, "remove");

    dropNotices("chan-1", ["cm-unrelated"], kv);
    dropNotices("chan-2", ["cm-1"], kv);

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(readNotices("chan-1", kv)).toHaveLength(1);
  });
});
