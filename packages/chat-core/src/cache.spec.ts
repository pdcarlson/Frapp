/**
 * Pins `mergeServerRow`'s carry-forward on re-merge: server message rows
 * never carry reactions or action rows (`normalizeRow` emits empty for
 * both), so a re-merge of an already-cached message — a backfill overlap on
 * a missing last-seen cursor, or a pin/edit UPDATE echo — must preserve
 * whatever the actions channel and the initial-load hydration have
 * accumulated. The actions channel only delivers *new* inserts, so a wiped
 * tally has no self-heal path (#951's root cause).
 */

import { describe, expect, test } from "vitest";
import {
  applyReactionInsert,
  emptyCache,
  markMessageDeleted,
  markRecorded,
  markUnconfirmed,
  mergeServerRow,
  upsertOptimistic,
} from "./cache";
import {
  normalizeRow,
  optimisticMessage,
  toRawRow,
  type RawChatMessage,
  type RawChatMessageAction,
  type ReplayRequest,
} from "./types";

function row(overrides: Partial<RawChatMessage> = {}): RawChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u1",
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "vote!",
    kind: "poll",
    created_at: "2026-08-15T00:00:00Z",
    client_message_id: "cm1",
    ...overrides,
  };
}

function voteAction(id: string, userId: string): RawChatMessageAction {
  return {
    id,
    message_id: "m1",
    user_id: userId,
    action_type: "vote",
    payload: { option_id: "opt-1" },
    created_at: "2026-08-15T00:01:00Z",
  };
}

describe("mergeServerRow carry-forward on re-merge", () => {
  test("preserves hydrated action rows and reactions when the same message re-merges", () => {
    let cache = mergeServerRow(emptyCache(), row());
    cache = applyReactionInsert(cache, voteAction("a1", "u1"));
    cache = applyReactionInsert(cache, voteAction("a2", "u2"));

    // Backfill overlap / pin echo: the same message arrives again as a full
    // row (server rows carry no actions).
    const remerged = mergeServerRow(cache, row({ is_pinned: true }));

    const message = remerged.byId["m1"]!;
    expect(message.is_pinned).toBe(true); // the re-merge itself applied
    expect(message.actions.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(message.reactions["vote"]).toEqual(["u1", "u2"]);
  });

  test("a fresh message merges with the row's own (empty) actions", () => {
    const cache = mergeServerRow(emptyCache(), row());
    expect(cache.byId["m1"]!.actions).toEqual([]);
  });
});

describe("markMessageDeleted (#2311)", () => {
  test("tombstones the cached row the way the server's soft delete does", () => {
    let cache = mergeServerRow(
      emptyCache(),
      row({
        content: "you are worthless",
        kind: "text",
        metadata: { attachment_count: 2 },
      }),
    );
    cache = applyReactionInsert(cache, voteAction("a1", "u2"));

    const next = markMessageDeleted(cache, "m1");

    const message = next.byId["m1"]!;
    expect(message).toMatchObject({
      content: "[message deleted]",
      is_deleted: true,
      attachment_count: 0,
      _status: "confirmed",
    });
    // Carried over like any re-merge, so the row keeps its place and tallies.
    expect(message.actions.map((a) => a.id)).toEqual(["a1"]);
    expect(next.order).toEqual(cache.order);
  });

  test("leaves every other row, including an unsent outbox row, where it was", () => {
    let cache = mergeServerRow(emptyCache(), row());
    cache = mergeServerRow(
      cache,
      row({ id: "m2", client_message_id: "cm2", content: "kept" }),
    );
    cache = upsertOptimistic(
      cache,
      optimisticMessage({
        clientMessageId: "cm-pending",
        channelId: "c1",
        senderId: "u1",
        content: "not sent yet",
      }),
    );

    const next = markMessageDeleted(cache, "m1");

    expect(next.byId["m2"]).toBe(cache.byId["m2"]);
    expect(next.byId["cm-pending"]).toBe(cache.byId["cm-pending"]);
    expect(next.order).toEqual(cache.order);
  });

  test("is a no-op for a message that is not cached, or is already deleted", () => {
    const cache = mergeServerRow(emptyCache(), row({ is_deleted: true }));
    expect(markMessageDeleted(cache, "m1")).toBe(cache);
    expect(markMessageDeleted(cache, "nope")).toBe(cache);
  });
});

describe("markRecorded (#1789)", () => {
  const replay: ReplayRequest = {
    command: "points",
    channelId: "c1",
    clientMessageId: "cm-rec",
    body: {
      target_user_id: "u2",
      amount: 5,
      category: "MANUAL" as const,
      reason: "cleanup",
      channel_id: "c1",
      client_message_id: "cm-rec",
    },
  };

  test("flips the placeholder to recorded and drops any replay handle", () => {
    const optimistic = optimisticMessage({
      clientMessageId: "cm-rec",
      channelId: "c1",
      senderId: "u1",
      content: "Granting 5 points…",
      kind: "loading",
    });
    let cache = upsertOptimistic(emptyCache(), optimistic);
    cache = markUnconfirmed(
      cache,
      "cm-rec",
      replay,
      "Not confirmed — these points may or may not have been recorded.",
    );
    expect(cache.byId["cm-rec"]?._replay).toEqual(replay);

    cache = markRecorded(
      cache,
      "cm-rec",
      "Points recorded — the chat card didn't post. Don't run this command again.",
    );

    const recorded = cache.byId["cm-rec"];
    expect(recorded?._status).toBe("recorded");
    expect(recorded?._replay).toBeUndefined();
    expect(recorded?._error).toMatch(/don't run this command again/i);
    expect(recorded?.kind).toBe("loading");
  });
});

/**
 * Block-list provenance (#2315): a row counts as server-evaluated only when it
 * arrived carrying `sender_blocked`, i.e. through a REST read the server ran
 * the viewer's block list over. Nothing here compares timestamps — the
 * fixtures deliberately mix the two wire serializations of `created_at`,
 * because uniform `.toISOString()` fixtures are how the watermark design this
 * replaced shipped green while being a no-op.
 */
describe("block-list provenance through the merge (#2315)", () => {
  /** REST/PostgREST's `timestamptz`: ISO, `T`, microseconds, `+00:00`. */
  const REST_CREATED_AT = "2026-09-15T18:00:00.123456+00:00";
  /**
   * Postgres's text form of `timestamptz`, which realtime-js would pass through
   * untouched (`transformers.js`). Local Realtime v2.113.4 actually sends the
   * ISO shape above (probed 2026-09-23, `spec/behavior/chat/README.md` § The
   * masking contract); this one is kept so nothing here can come to depend on
   * the two paths agreeing.
   */
  const REALTIME_CREATED_AT = "2026-09-15 18:05:12.4+00";

  /** A row as `GET /v1/channels/{id}/messages` serves it. */
  function restRow(overrides: Partial<RawChatMessage> = {}): RawChatMessage {
    return row({
      kind: "text",
      content: "hello",
      created_at: REST_CREATED_AT,
      sender_blocked: false,
      ...overrides,
    });
  }

  /** A `postgres_changes` echo: the raw table row, no `sender_blocked` key at all. */
  function echoRow(overrides: Partial<RawChatMessage> = {}): RawChatMessage {
    const base = row({
      kind: "text",
      content: "hello",
      created_at: REALTIME_CREATED_AT,
      ...overrides,
    });
    delete base.sender_blocked;
    return base;
  }

  test("a REST row is evaluated whatever its verdict", () => {
    const clear = mergeServerRow(emptyCache(), restRow());
    expect(clear.byId["m1"]).toMatchObject({
      _blockEvaluated: true,
      sender_blocked: false,
    });

    const masked = mergeServerRow(
      emptyCache(),
      restRow({ sender_blocked: true, content: "[redacted by server]" }),
    );
    expect(masked.byId["m1"]).toMatchObject({
      _blockEvaluated: true,
      sender_blocked: true,
    });
  });

  test("a Realtime INSERT echo is unevaluated", () => {
    const cache = mergeServerRow(emptyCache(), echoRow());
    expect(cache.byId["m1"]).toMatchObject({
      _blockEvaluated: false,
      sender_blocked: false,
    });
  });

  test("an UPDATE echo of a server-masked row clears its provenance but carries the mask", () => {
    // #2315 defect 5: a pin by any `channels:manage` holder echoes the raw row
    // over a masked one. The content is now the blocked member's real words,
    // so the row must stop reading as evaluated — and must keep the server's
    // verdict. Dropping it left the client's list as the only guard, and a
    // list that read ready but predated a block made on another device showed
    // those words in full.
    let cache = mergeServerRow(
      emptyCache(),
      restRow({ sender_blocked: true, content: "[redacted by server]" }),
    );
    cache = mergeServerRow(
      cache,
      echoRow({ is_pinned: true, content: "the real words" }),
    );

    expect(cache.byId["m1"]).toMatchObject({
      content: "the real words",
      is_pinned: true,
      _blockEvaluated: false,
      sender_blocked: true,
    });

    // A second echo — an edit after the pin — keeps carrying it.
    cache = mergeServerRow(
      cache,
      echoRow({ content: "edited again", edited_at: "2026-09-15 18:07:00+00" }),
    );
    expect(cache.byId["m1"]).toMatchObject({
      content: "edited again",
      _blockEvaluated: false,
      sender_blocked: true,
    });
  });

  test("an UPDATE echo of a server-cleared row carries nothing", () => {
    let cache = mergeServerRow(emptyCache(), restRow());
    cache = mergeServerRow(
      cache,
      echoRow({ is_pinned: true, content: "edited words" }),
    );

    expect(cache.byId["m1"]).toMatchObject({
      content: "edited words",
      _blockEvaluated: false,
      sender_blocked: false,
    });
  });

  test("a later REST read is the server's answer again, so an unblock brings the words back", () => {
    let cache = mergeServerRow(
      emptyCache(),
      restRow({ sender_blocked: true, content: "[redacted by server]" }),
    );
    cache = mergeServerRow(cache, echoRow({ content: "the real words" }));
    cache = mergeServerRow(cache, restRow({ content: "the real words" }));

    expect(cache.byId["m1"]).toMatchObject({
      content: "the real words",
      _blockEvaluated: true,
      sender_blocked: false,
    });
  });

  test("a REST read that does return an echoed row vouches for it", () => {
    // Whatever merges a REST row goes through this function, so a server read
    // that happens to return an echoed row re-evaluates it. That is NOT a
    // re-evaluation path to rely on: the reconnect backfill and the polling
    // fallback read only rows *after* the last-seen cursor, and every echo
    // advances that cursor, so an echoed row is normally never read back over
    // REST. It stays unevaluated for the session, which is why a client that
    // applies its own block list must remember rows it already cleared against
    // a ready list (`blockClearance` in `./blocks.ts`, both clients) rather
    // than hold them again when the list later becomes unavailable (#2257
    // review, finding 4).
    let cache = mergeServerRow(emptyCache(), echoRow());
    cache = mergeServerRow(cache, restRow());
    expect(cache.byId["m1"]!._blockEvaluated).toBe(true);
  });

  test("the viewer's optimistic row is unevaluated, and so is its confirmation", () => {
    const optimistic = optimisticMessage({
      clientMessageId: "cm1",
      channelId: "c1",
      senderId: "u1",
      content: "hello",
    });
    expect(optimistic._blockEvaluated).toBe(false);

    // The send response is the raw inserted row, with no `sender_blocked`.
    let cache = upsertOptimistic(emptyCache(), optimistic);
    cache = mergeServerRow(cache, echoRow());
    expect(cache.byId["m1"]!._blockEvaluated).toBe(false);
  });

  test("the wire round trip keeps provenance rather than laundering it", () => {
    const echoed = normalizeRow(echoRow());
    const wire = toRawRow(echoed);
    // Emitting `sender_blocked: false` here would turn an unevaluated echo into
    // a server-vouched row on the way back in.
    expect(wire).not.toHaveProperty("sender_blocked");
    expect(normalizeRow(wire)).toEqual(echoed);

    const vouched = normalizeRow(restRow({ sender_blocked: true }));
    expect(toRawRow(vouched).sender_blocked).toBe(true);
    expect(normalizeRow(toRawRow(vouched))).toEqual(vouched);
  });
});
