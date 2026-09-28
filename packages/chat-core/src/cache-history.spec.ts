/**
 * Pins the cache operations older history rests on (#1571), and the refetch
 * half of it that #2486 is about: a channel query's read must fold into the
 * cache as it stands, never replace it, or queued sends vanish; and it must
 * not keep a cached row it did not re-read, or a removal made during an
 * outage stays on screen.
 */

import { describe, expect, test } from "vitest";
import {
  applyReactionInsert,
  emptyCache,
  markFailed,
  mergeUnheldRows,
  mergeServerRows,
  oldestConfirmed,
  reconcileNewestPage,
  selectMessages,
  trimOlderThan,
  upsertOptimistic,
} from "./cache";
import {
  optimisticMessage,
  type ChannelCache,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";

/** Row `n` was sent at minute `n`, so a higher number is newer. */
function row(n: number, overrides: Partial<RawChatMessage> = {}): RawChatMessage {
  const minute = String(n).padStart(2, "0");
  return {
    id: `m${n}`,
    channel_id: "c1",
    sender_id: "u1",
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: `message ${n}`,
    kind: "text",
    created_at: `2026-09-28T10:${minute}:00+00:00`,
    client_message_id: `cm${n}`,
    ...overrides,
  };
}

function rows(from: number, to: number): RawChatMessage[] {
  const out: RawChatMessage[] = [];
  for (let n = from; n <= to; n += 1) out.push(row(n));
  return out;
}

function page(from: number, to: number): ChannelCache {
  return mergeServerRows(emptyCache(), rows(from, to));
}

function reaction(id: string, messageId: string): RawChatMessageAction {
  return {
    id,
    message_id: messageId,
    user_id: "u2",
    action_type: "reaction:👍",
    payload: null,
    created_at: "2026-09-28T11:00:00+00:00",
  };
}

function queued(clientId: string): ReturnType<typeof optimisticMessage> {
  return optimisticMessage({
    clientMessageId: clientId,
    channelId: "c1",
    senderId: "u1",
    content: `unsent ${clientId}`,
  });
}

function ids(cache: ChannelCache): string[] {
  return selectMessages(cache).map((message) => message.id);
}

describe("reconcileNewestPage", () => {
  test("returns the read itself when nothing is cached yet", () => {
    const fresh = page(1, 3);
    expect(reconcileNewestPage(undefined, fresh)).toBe(fresh);
    expect(reconcileNewestPage(emptyCache(), fresh)).toBe(fresh);
  });

  test("keeps queued and failed sends written before the fetch landed (#2486)", () => {
    // The outbox hydrate (or the first-chunk seed) ran while the GET was in
    // flight, so the cache holds unsent rows the read cannot know about.
    let current = upsertOptimistic(emptyCache(), queued("q1"));
    current = upsertOptimistic(current, queued("f1"));
    current = markFailed(current, "f1", "Send failed");

    const next = reconcileNewestPage(current, page(1, 3));

    expect(ids(next)).toEqual(["m1", "m2", "m3", "q1", "f1"]);
    expect(next.byId.q1?._status).toBe("pending");
    expect(next.byId.f1?._status).toBe("failed");
  });

  test("drops an optimistic row the read confirms", () => {
    const current = upsertOptimistic(emptyCache(), queued("cm3"));

    const next = reconcileNewestPage(current, page(1, 3));

    expect(ids(next)).toEqual(["m1", "m2", "m3"]);
    expect(next.byId.cm3).toBeUndefined();
  });

  test("drops cached rows older than the page, which it cannot vouch for", () => {
    // Deleted, edited or report-removed during an outage, or a week-old disk
    // tail: they load again, fresh, when the member scrolls back to them.
    const current = page(1, 6);

    expect(ids(reconcileNewestPage(current, page(4, 6)))).toEqual([
      "m4",
      "m5",
      "m6",
    ]);
  });

  test("takes the read's copy of every row it carries", () => {
    const current = page(1, 3);
    const fresh = mergeServerRows(emptyCache(), [
      row(1),
      row(2, { content: "[message deleted]", is_deleted: true }),
      row(3),
    ]);

    const next = reconcileNewestPage(current, fresh);

    expect(next.byId.m2?.content).toBe("[message deleted]");
  });

  test("drops a cached row inside the read's range that the read does not carry", () => {
    const current = page(1, 4);
    const fresh = mergeServerRows(emptyCache(), [row(1), row(2), row(4)]);

    expect(ids(reconcileNewestPage(current, fresh))).toEqual([
      "m1",
      "m2",
      "m4",
    ]);
  });

  test("keeps a row newer than the read, which arrived while the fetch was in flight", () => {
    const current = page(1, 4);

    expect(ids(reconcileNewestPage(current, page(1, 3)))).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });

  test("keeps a row in the same millisecond as the read's newest", () => {
    // `created_at` carries microseconds the comparison cannot see.
    const tied = row(9, { created_at: row(3).created_at });
    const current = mergeServerRows(page(1, 3), [tied]);

    expect(ids(reconcileNewestPage(current, page(1, 3)))).toContain("m9");
  });

  test("keeps nothing confirmed when the read says the channel is empty", () => {
    const current = upsertOptimistic(page(1, 2), queued("q1"));

    expect(ids(reconcileNewestPage(current, emptyCache()))).toEqual(["q1"]);
  });

  test("carries the reactions of the newer rows it keeps", () => {
    const current = applyReactionInsert(page(1, 4), reaction("a1", "m4"));

    const next = reconcileNewestPage(current, page(1, 3));

    expect(next.byId.m4?.reactions["reaction:👍"]).toEqual(["u2"]);
    expect(next.actionIndex.a1?.messageKey).toBe("m4");
  });
});

describe("trimOlderThan", () => {
  test("drops confirmed rows strictly older than the time, with their reactions", () => {
    let cache = applyReactionInsert(page(1, 4), reaction("a1", "m1"));
    cache = upsertOptimistic(cache, queued("q1"));

    const next = trimOlderThan(cache, Date.parse(row(3).created_at));

    expect(ids(next)).toEqual(["m3", "m4", "q1"]);
    expect(next.actionIndex.a1).toBeUndefined();
  });

  test("returns the cache untouched when nothing is older", () => {
    const cache = page(3, 4);
    expect(trimOlderThan(cache, Date.parse(row(1).created_at))).toBe(cache);
  });
});

describe("mergeUnheldRows", () => {
  test("adds the rows it does not hold and reports how many", () => {
    const { cache, added } = mergeUnheldRows(page(3, 4), rows(1, 3), []);

    expect(added).toBe(2);
    expect(ids(cache)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  test("leaves a row it already holds alone, reactions included", () => {
    const current = applyReactionInsert(page(3, 4), reaction("a1", "m3"));

    const { cache, added } = mergeUnheldRows(
      current,
      [row(3, { content: "stale copy" })],
      [reaction("a2", "m3")],
    );

    expect(added).toBe(0);
    expect(cache).toBe(current);
    expect(cache.byId.m3?.content).toBe("message 3");
  });

  test("hydrates reactions only onto the rows the page added", () => {
    const { cache } = mergeUnheldRows(page(3, 3), rows(1, 2), [
      reaction("a1", "m1"),
      reaction("a2", "m3"),
    ]);

    expect(cache.byId.m1?.reactions["reaction:👍"]).toEqual(["u2"]);
    expect(cache.actionIndex.a2).toBeUndefined();
  });
});

describe("oldestConfirmed", () => {
  test("skips optimistic rows, whose created_at is the device clock", () => {
    const optimistic = queued("q1");
    const early = { ...optimistic, created_at: "2000-01-01T00:00:00Z" };
    const cache = upsertOptimistic(page(2, 3), early);

    expect(oldestConfirmed(cache)?.id).toBe("m2");
  });

  test("is null for an empty or all-optimistic cache", () => {
    expect(oldestConfirmed(undefined)).toBeNull();
    expect(oldestConfirmed(upsertOptimistic(emptyCache(), queued("q1")))).toBeNull();
  });
});
