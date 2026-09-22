import { describe, expect, it } from "vitest";
import {
  mergeServerRow,
  emptyCache,
  selectMessages,
} from "@repo/chat-core/cache";
import type { ChatMessage, RawChatMessage } from "@repo/chat-core/types";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  applyBlockList,
  blockListNotice,
  classifyMessage,
  isBlockableSender,
  messageActionsFor,
  tombstoneCanUnblock,
  type BlockState,
} from "./blocks";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";

/** What the API's masker writes today — used only to prove nothing reads it. */
const SERVER_SENTINEL = "[message from a blocked member]";

const ready = (ids: string[] = []): BlockState => ({
  status: "ready",
  ids: new Set(ids),
});
const loading = (ids: string[] = []): BlockState => ({
  status: "loading",
  ids: new Set(ids),
});
const unavailable = (ids: string[] = []): BlockState => ({
  status: "unavailable",
  ids: new Set(ids),
});

/**
 * Rows go through the real `mergeServerRow`, so provenance is whatever
 * chat-core's normalizer derives from the wire shape — not a hand-set flag
 * that could drift from it.
 */
function restRow(
  id: string,
  senderId: string | null,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    id,
    channel_id: "chan-1",
    sender_id: senderId,
    author_name: senderId === null ? "Discord Dan" : null,
    content: `body ${id}`,
    kind: "text",
    // PostgREST's `timestamptz` shape.
    created_at: "2026-09-15T18:00:00.123456+00:00",
    sender_blocked: false,
    ...overrides,
  };
}

function echoRow(
  id: string,
  senderId: string | null,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  const row: RawChatMessage = {
    id,
    channel_id: "chan-1",
    sender_id: senderId,
    author_name: senderId === null ? "Discord Dan" : null,
    content: `body ${id}`,
    kind: "text",
    // Realtime's untouched `timestamptz` shape — space, `+00`. Sorts *below*
    // every REST timestamp above as a string, which is exactly what made a
    // watermark compare vouch for it. Nothing here may care.
    created_at: "2026-09-15 18:05:12.4+00",
    ...overrides,
  };
  return row;
}

function one(raw: RawChatMessage): ChatMessage {
  const [message] = selectMessages(mergeServerRow(emptyCache(), raw));
  return message!;
}

describe("classifyMessage", () => {
  describe("the viewer's own message", () => {
    it("is visible on every path and in every list state", () => {
      for (const state of [ready(), loading(), unavailable()]) {
        expect(classifyMessage(one(echoRow("m1", VIEWER)), state, VIEWER)).toBe(
          "visible",
        );
        expect(classifyMessage(one(restRow("m1", VIEWER)), state, VIEWER)).toBe(
          "visible",
        );
      }
    });
  });

  describe("a row the server evaluated", () => {
    it("is a tombstone when the server masked it, whatever the list says", () => {
      const masked = one(restRow("m1", BLOCKED, { sender_blocked: true }));
      expect(classifyMessage(masked, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
      // Unblocked since, but this copy's content was withheld: nothing to draw.
      expect(classifyMessage(masked, ready([]), VIEWER)).toBe("tombstone");
      expect(classifyMessage(masked, unavailable(), VIEWER)).toBe("tombstone");
    });

    it("is visible when cleared, even while the list is unavailable (no wholesale tombstoning)", () => {
      const cleared = one(restRow("m1", FRIEND));
      expect(classifyMessage(cleared, ready(), VIEWER)).toBe("visible");
      expect(classifyMessage(cleared, loading(), VIEWER)).toBe("visible");
      expect(classifyMessage(cleared, unavailable(), VIEWER)).toBe("visible");
    });

    it("is a tombstone when cleared before a block the list now records", () => {
      const cleared = one(restRow("m1", BLOCKED));
      expect(classifyMessage(cleared, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
      // The floor applies while the list is unreadable too.
      expect(classifyMessage(cleared, unavailable([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
    });
  });

  describe("a row that arrived over the Realtime echo", () => {
    it("is visible only against a ready list that does not name its sender", () => {
      expect(classifyMessage(one(echoRow("m1", FRIEND)), ready(), VIEWER)).toBe(
        "visible",
      );
    });

    it("is a tombstone when its sender is on the list", () => {
      const echoed = one(echoRow("m1", BLOCKED));
      expect(classifyMessage(echoed, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
      expect(classifyMessage(echoed, unavailable([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
    });

    it("is held while the list is loading or unavailable — fail closed", () => {
      const echoed = one(echoRow("m1", FRIEND));
      expect(classifyMessage(echoed, loading(), VIEWER)).toBe("held");
      expect(classifyMessage(echoed, unavailable(), VIEWER)).toBe("held");
    });

    it("an UPDATE echo over a masked row is not vouched for by the masked copy", () => {
      // A pin by any `channels:manage` holder writes the raw row back over the
      // server-masked one (#2315 defect 5).
      let cache = mergeServerRow(
        emptyCache(),
        restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
      );
      cache = mergeServerRow(
        cache,
        echoRow("m1", BLOCKED, { is_pinned: true, content: "the real words" }),
      );
      const [pinned] = selectMessages(cache);
      expect(classifyMessage(pinned!, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
      expect(classifyMessage(pinned!, unavailable(), VIEWER)).toBe("held");
    });
  });

  describe("senders nobody can block", () => {
    it("never hides the system actor or an imported row", () => {
      const system = one(echoRow("m1", SYSTEM_SENDER_ID));
      const imported = one(echoRow("m2", null, { kind: "imported" }));
      for (const state of [
        loading(),
        unavailable(),
        ready([SYSTEM_SENDER_ID]),
      ]) {
        expect(classifyMessage(system, state, VIEWER)).toBe("visible");
        expect(classifyMessage(imported, state, VIEWER)).toBe("visible");
      }
    });
  });

  describe("the server's sentinel string", () => {
    it("is never what decides", () => {
      // Sentinel content on a row the server says is clear stays visible…
      const lookalike = one(
        restRow("m1", FRIEND, { content: SERVER_SENTINEL }),
      );
      expect(classifyMessage(lookalike, ready(), VIEWER)).toBe("visible");
      // …and a masked row is a tombstone whatever its content says.
      const reworded = one(
        restRow("m2", BLOCKED, { sender_blocked: true, content: "anything" }),
      );
      expect(classifyMessage(reworded, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
    });
  });
});

describe("applyBlockList", () => {
  const rows = [
    restRow("a", FRIEND),
    restRow("b", BLOCKED, { sender_blocked: true }),
    echoRow("c", FRIEND),
    echoRow("d", VIEWER),
    echoRow("e", BLOCKED),
  ];
  const messages = selectMessages(
    rows.reduce((cache, row) => mergeServerRow(cache, row), emptyCache()),
  );

  it("holds unevaluated rows off screen when the list is unavailable", () => {
    const thread = applyBlockList(messages, unavailable(), VIEWER);
    expect(thread.heldCount).toBe(2); // c and e — the echoes from others
    expect(thread.rows.map((row) => [row.message.id, row.visibility])).toEqual(
      expect.arrayContaining([
        ["a", "visible"],
        ["b", "tombstone"],
        ["d", "visible"],
      ]),
    );
    expect(thread.rows.map((row) => row.message.id)).not.toContain("c");
    expect(thread.rows.map((row) => row.message.id)).not.toContain("e");
  });

  it("releases them once the list is ready, tombstoning the blocked sender", () => {
    const thread = applyBlockList(messages, ready([BLOCKED]), VIEWER);
    expect(thread.heldCount).toBe(0);
    expect(
      Object.fromEntries(
        thread.rows.map((row) => [row.message.id, row.visibility]),
      ),
    ).toEqual({
      a: "visible",
      b: "tombstone",
      c: "visible",
      d: "visible",
      e: "tombstone",
    });
  });

  it("keeps the input order", () => {
    const thread = applyBlockList(messages, ready(), VIEWER);
    expect(thread.rows.map((row) => row.message.id)).toEqual(
      messages
        .map((message) => message.id)
        .filter((id) => thread.rows.some((row) => row.message.id === id)),
    );
  });
});

describe("blockListNotice", () => {
  it("always speaks up when the list is unavailable, with a retry", () => {
    expect(blockListNotice("unavailable", 0)).toMatchObject({
      title: "Couldn't load your block list",
      canRetry: true,
    });
    expect(blockListNotice("unavailable", 3)?.body).toMatch(
      /^3 new messages are held/,
    );
    expect(blockListNotice("unavailable", 1)?.body).toMatch(
      /^1 new message is held/,
    );
  });

  it("stays quiet while loading unless something is actually held", () => {
    expect(blockListNotice("loading", 0)).toBeNull();
    expect(blockListNotice("loading", 2)).toMatchObject({ canRetry: false });
    expect(blockListNotice("ready", 0)).toBeNull();
  });
});

describe("messageActionsFor", () => {
  const base = one(restRow("m1", FRIEND));

  it("offers report and block on someone else's confirmed message", () => {
    expect(messageActionsFor(base, VIEWER)).toEqual({
      canOpen: true,
      canReport: true,
      canBlock: true,
    });
  });

  it("offers nothing on the viewer's own message", () => {
    expect(
      messageActionsFor({ ...base, sender_id: VIEWER }, VIEWER).canOpen,
    ).toBe(false);
  });

  it("offers nothing before the viewer is known", () => {
    expect(messageActionsFor(base, null).canOpen).toBe(false);
  });

  it("offers nothing on a row the server has not confirmed, or a deleted one", () => {
    expect(
      messageActionsFor({ ...base, _status: "pending" }, VIEWER).canOpen,
    ).toBe(false);
    expect(
      messageActionsFor({ ...base, _status: "failed" }, VIEWER).canOpen,
    ).toBe(false);
    expect(
      messageActionsFor({ ...base, is_deleted: true }, VIEWER).canOpen,
    ).toBe(false);
  });

  it("reports but never blocks the system actor", () => {
    expect(
      messageActionsFor({ ...base, sender_id: SYSTEM_SENDER_ID }, VIEWER),
    ).toEqual({ canOpen: true, canReport: true, canBlock: false });
  });

  it("reports but never blocks an imported row", () => {
    expect(messageActionsFor({ ...base, sender_id: null }, VIEWER)).toEqual({
      canOpen: true,
      canReport: true,
      canBlock: false,
    });
  });
});

describe("isBlockableSender / tombstoneCanUnblock", () => {
  it("rejects the system actor and imported rows", () => {
    expect(isBlockableSender(SYSTEM_SENDER_ID)).toBe(false);
    expect(isBlockableSender(null)).toBe(false);
    expect(isBlockableSender(BLOCKED)).toBe(true);
  });

  it("withholds Unblock only when a current list says there is nothing to undo", () => {
    const row = { sender_id: BLOCKED };
    expect(tombstoneCanUnblock(row, ready([BLOCKED]))).toBe(true);
    expect(tombstoneCanUnblock(row, unavailable())).toBe(true);
    expect(tombstoneCanUnblock(row, loading())).toBe(true);
    expect(tombstoneCanUnblock(row, ready([]))).toBe(false);
  });
});
