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
import { applyReactionInsert, emptyCache, mergeServerRow } from "./cache";
import type { RawChatMessage, RawChatMessageAction } from "./types";

function row(overrides: Partial<RawChatMessage> = {}): RawChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u1",
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
