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
  UNCONFIRMED_NOTICE_TTL_MS,
} from "./heavy-command-notices";
import type { KeyValueStore } from "./adapters";
import { optimisticMessage } from "./types";
import { memoryStore } from "./test/memory-store";
import {
  pointsReplay,
  recordedNotice,
  unconfirmedNotice,
} from "./test/notices";

/** Where user-1's entries for chan-1 are filed. */
const KEY = "chat:heavy:v1:user-1:chan-1";
/** Where #1789 filed every member's `recorded` entries for chan-1. */
const LEGACY_KEY = "chat:recorded:chan-1";

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

function restore(kv: KeyValueStore, viewerId: string | null = "user-1") {
  return mergePersistedNotices(emptyCache(), {
    channelId: "chan-1",
    viewerId,
    kv,
  });
}

describe("heavy-command notices — recorded (#1789)", () => {
  test("round-trips a notice through the store", () => {
    const kv = memoryStore();
    expect(persistNotice(recordedNotice(), kv)).toBe(true);
    expect(readNotices("chan-1", "user-1", kv)).toEqual([recordedNotice()]);
  });

  test("rehydrates an absent row as recorded, without a replay handle", () => {
    const kv = memoryStore();
    persistNotice(recordedNotice(), kv);
    const row = restore(kv).byId["cm-1"];
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
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  test("drops a corrupt store value so a later persist can write", () => {
    const kv = memoryStore();
    kv.set(KEY, "{not-json");
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
    expect(kv.get(KEY)).toBeNull();
    persistNotice(recordedNotice(), kv);
    expect(readNotices("chan-1", "user-1", kv)).toEqual([recordedNotice()]);
  });

  // Display-only, so no age bound: it is the trace that says not to re-run.
  test("restores a recorded row however old it is", () => {
    const kv = memoryStore();
    persistNotice(recordedNotice({ createdAt: "2020-01-01T00:00:00.000Z" }), kv);
    expect(restore(kv).byId["cm-1"]?._status).toBe("recorded");
  });
});

/**
 * The store is per browser, and an `unconfirmed` entry carries a replay body
 * (target, amount, reason). Keying by the member who dispatched is what keeps
 * one member's entries unreachable from another member's session — the
 * outbox's rule (`spec/ui/resilience/caching.md`, #2226).
 */
describe("heavy-command notices — keyed by the dispatching member", () => {
  test("files an entry under its sender, not under the channel alone", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    expect(kv.get(KEY)).not.toBeNull();
    expect(kv.get(LEGACY_KEY)).toBeNull();
  });

  test("another member reads nothing, and the owner's entries stay put", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    persistNotice(recordedNotice({ clientMessageId: "cm-2" }), kv);

    expect(readNotices("chan-1", "user-9", kv)).toEqual([]);
    expect(restore(kv, "user-9").order).toEqual([]);
    expect(readNotices("chan-1", "user-1", kv)).toHaveLength(2);
  });

  test("restores nothing before the viewer is known", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    expect(restore(kv, null).order).toEqual([]);
    expect(readNotices("chan-1", "user-1", kv)).toHaveLength(1);
  });

  // A record in one member's list claiming another sender is not theirs to
  // replay, whatever put it there.
  test("drops an entry whose sender is not the list's owner", () => {
    const kv = memoryStore();
    kv.set(KEY, JSON.stringify([unconfirmedNotice({ senderId: "user-9" })]));
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  // #1789 filed every member's `recorded` entries under one per-channel key.
  // Each carries its sender, so each is handed to exactly one member.
  test("adopts the reader's #1789 entries and leaves other members' behind", () => {
    const kv = memoryStore();
    const mine: Partial<ReturnType<typeof recordedNotice>> = recordedNotice();
    delete mine.status;
    const theirs = { ...mine, clientMessageId: "cm-9", senderId: "user-9" };
    kv.set(LEGACY_KEY, JSON.stringify([mine, theirs]));

    expect(readNotices("chan-1", "user-1", kv)).toEqual([recordedNotice()]);
    expect(JSON.parse(kv.get(KEY)!)).toEqual([recordedNotice()]);
    expect(JSON.parse(kv.get(LEGACY_KEY)!)).toEqual([theirs]);

    readNotices("chan-1", "user-9", kv);
    expect(kv.get(LEGACY_KEY)).toBeNull();
  });
});

describe("heavy-command notices — unconfirmed (#1909)", () => {
  test("rehydrates an absent row as unconfirmed, carrying its original replay", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);

    const row = restore(kv).byId["cm-1"];
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
    expect(readNotices("chan-1", "user-1", kv)).toEqual([recordedNotice()]);
  });

  test("drops an unconfirmed entry once its card is confirmed", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const merged = mergePersistedNotices(mergeServerRow(emptyCache(), cardEcho()), {
      channelId: "chan-1",
      viewerId: "user-1",
      kv,
    });
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
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

  // A day on, a Retry is likelier to write a grant the officer already
  // re-typed than to recover a lost one: a never-committed key replays as a
  // first write.
  test("prunes an unconfirmed entry past the age bound instead of restoring it", () => {
    const kv = memoryStore();
    const createdAt = "2026-09-09T00:00:00.000Z";
    persistNotice(unconfirmedNotice({ createdAt }), kv);
    const justInside = Date.parse(createdAt) + UNCONFIRMED_NOTICE_TTL_MS;

    const kept = mergePersistedNotices(emptyCache(), {
      channelId: "chan-1",
      viewerId: "user-1",
      kv,
      now: justInside,
    });
    expect(kept.byId["cm-1"]?._status).toBe("unconfirmed");

    const pruned = mergePersistedNotices(emptyCache(), {
      channelId: "chan-1",
      viewerId: "user-1",
      kv,
      now: justInside + 1,
    });
    expect(pruned.byId["cm-1"]).toBeUndefined();
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  test("prunes an unconfirmed entry whose timestamp cannot be read", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice({ createdAt: "not a date" }), kv);
    expect(restore(kv).order).toEqual([]);
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  // A replay rebuilt from a partial record would send a DIFFERENT request under
  // the original key.
  test.each([
    ["no replay", { replay: undefined }],
    ["a replay under another key", { replay: pointsReplay("cm-other") }],
    ["a replay for another channel", { replay: pointsReplay("cm-1", "chan-2") }],
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
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  test("drops an entry filed under another channel's key", () => {
    const kv = memoryStore();
    kv.set(KEY, JSON.stringify([unconfirmedNotice({ channelId: "chan-2" })]));
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });
});

describe("persistNotice", () => {
  // `KeyValueStore.set` may degrade silently (storage blocked, quota full). A
  // caller about to promise the row survives a reload has to know.
  test("reports a write the store silently dropped", () => {
    const kv = memoryStore();
    const inert: KeyValueStore = { ...kv, set: () => {} };
    expect(persistNotice(unconfirmedNotice(), inert)).toBe(false);
  });
});

describe("dropNotices", () => {
  test("removes only the named entries, and the key with the last one", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    persistNotice(unconfirmedNotice({ clientMessageId: "cm-2" }), kv);

    dropNotices("chan-1", "user-1", ["cm-1", null, undefined], kv);
    expect(
      readNotices("chan-1", "user-1", kv).map((n) => n.clientMessageId),
    ).toEqual(["cm-2"]);

    dropNotices("chan-1", "user-1", ["cm-2"], kv);
    expect(kv.get(KEY)).toBeNull();
  });

  // It runs on every Realtime echo, so the common case must not write.
  test("does not write when nothing matches", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const set = vi.spyOn(kv, "set");
    const remove = vi.spyOn(kv, "remove");

    dropNotices("chan-1", "user-1", ["cm-unrelated"], kv);
    dropNotices("chan-2", "user-1", ["cm-1"], kv);
    dropNotices("chan-1", "user-9", ["cm-1"], kv);

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(readNotices("chan-1", "user-1", kv)).toHaveLength(1);
  });
});
