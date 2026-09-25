/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyCache,
  mergeServerRow,
  selectMessages,
} from "@repo/chat-core/cache";
import type { ChatMessage, RawChatMessage } from "@repo/chat-core/types";
import { blockClearance } from "@repo/chat-core/blocks";
import type { BlockedUserIds } from "@repo/hooks";
import type { BlockListStatus } from "@repo/validation";

const list = vi.hoisted(() => ({
  current: null as unknown as BlockedUserIds,
  retry: vi.fn(),
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return { ...actual, useBlockedUserIds: () => list.current };
});

import { useThreadBlockList } from "./use-thread-block-list";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

function setList(
  status: BlockListStatus,
  ids: string[] = [],
  unblocked: string[] = [],
) {
  list.current = {
    status,
    ids: new Set(ids),
    unblocked: new Set(unblocked),
    retry: list.retry,
    isRetrying: false,
    isPaused: false,
    readAt: status === "ready" ? 1 : 0,
  };
}

/** A Realtime echo: never server-evaluated. */
function echoRow(id: string, senderId: string): RawChatMessage {
  return {
    id,
    channel_id: "chan-1",
    sender_id: senderId,
    author_name: null,
    content: `body ${id}`,
    kind: "text",
    created_at: "2026-09-15 18:05:12.4+00",
  };
}

function restRow(
  id: string,
  senderId: string,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    ...echoRow(id, senderId),
    created_at: "2026-09-15T18:00:00.123456+00:00",
    sender_blocked: false,
    ...overrides,
  };
}

function messagesOf(rows: RawChatMessage[]): ChatMessage[] {
  return selectMessages(
    rows.reduce((cache, row) => mergeServerRow(cache, row), emptyCache()),
  );
}

function shownIds(result: { current: ReturnType<typeof useThreadBlockList> }) {
  return result.current.thread.rows.map((row) => row.message.id);
}

beforeEach(() => {
  act(() => blockClearance.reset());
  list.retry.mockReset();
});

describe("useThreadBlockList — clearances (finding 4)", () => {
  it("keeps what a ready list showed through a later outage, and holds only what arrives during it", () => {
    setList("ready");
    const before = messagesOf([echoRow("m1", FRIEND)]);
    const { result, rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: before } },
    );
    expect(shownIds(result)).toEqual(["m1"]);

    // The list read fails later; m1 was read against a ready list.
    setList("unavailable");
    rerender({ messages: before });
    expect(shownIds(result)).toEqual(["m1"]);
    expect(result.current.thread.heldCount).toBe(0);

    // m2 arrives over the echo during the outage: nothing vouches for it.
    const during = messagesOf([echoRow("m1", FRIEND), echoRow("m2", FRIEND)]);
    rerender({ messages: during });
    expect(shownIds(result)).toEqual(["m1"]);
    expect(result.current.thread.heldCount).toBe(1);
  });

  it("keeps a REST row readable when an UPDATE echo lands during a later outage", () => {
    setList("ready");
    const read = messagesOf([restRow("m1", FRIEND)]);
    const { result, rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: read } },
    );
    expect(shownIds(result)).toEqual(["m1"]);

    // The list goes down, then an officer pins m1. The echo replaces the REST
    // row with an unevaluated one; the clearance recorded above is what keeps
    // the message the viewer already read on screen.
    setList("unavailable");
    const pinned = selectMessages(
      mergeServerRow(mergeServerRow(emptyCache(), restRow("m1", FRIEND)), {
        ...echoRow("m1", FRIEND),
        is_pinned: true,
      }),
    );
    expect(pinned[0]!._blockEvaluated).toBe(false);
    rerender({ messages: pinned });
    expect(shownIds(result)).toEqual(["m1"]);
    expect(result.current.thread.heldCount).toBe(0);
  });

  it("keeps a REST row readable through a pin echo when the list was never ready", () => {
    // A cold start whose block-list read failed: the REST rows still render,
    // because the server evaluated them.
    setList("unavailable");
    const read = messagesOf([restRow("m1", FRIEND)]);
    const { result, rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: read } },
    );
    expect(shownIds(result)).toEqual(["m1"]);

    // An officer pins m1 during the outage; the echo strips its evaluation.
    const pinned = selectMessages(
      mergeServerRow(mergeServerRow(emptyCache(), restRow("m1", FRIEND)), {
        ...echoRow("m1", FRIEND),
        is_pinned: true,
      }),
    );
    rerender({ messages: pinned });
    expect(shownIds(result)).toEqual(["m1"]);
    expect(result.current.thread.heldCount).toBe(0);

    // A block still outranks it.
    setList("unavailable", [FRIEND]);
    rerender({ messages: pinned });
    expect(result.current.thread.rows[0]?.visibility).toBe("tombstone");
  });

  it("holds everything unevaluated when the list was never ready", () => {
    setList("loading");
    const { result } = renderHook(() =>
      useThreadBlockList(messagesOf([echoRow("m1", FRIEND)]), VIEWER),
    );
    expect(shownIds(result)).toEqual([]);
    expect(result.current.thread.heldCount).toBe(1);
  });

  it("does not carry one viewer's clearances to another", () => {
    setList("ready");
    const messages = messagesOf([echoRow("m1", FRIEND)]);
    renderHook(() => useThreadBlockList(messages, VIEWER));

    setList("unavailable");
    const { result } = renderHook(() => useThreadBlockList(messages, OTHER));
    expect(shownIds(result)).toEqual([]);
  });

  it("never lets a clearance outrank a block confirmed since", () => {
    setList("ready");
    const messages = messagesOf([echoRow("m1", BLOCKED)]);
    const { result, rerender } = renderHook(() =>
      useThreadBlockList(messages, VIEWER),
    );
    expect(result.current.thread.rows[0]!.visibility).toBe("visible");

    setList("unavailable", [BLOCKED]);
    rerender();
    expect(result.current.thread.rows[0]!.visibility).toBe("tombstone");
  });
});

describe("useThreadBlockList — cross-device blocks (finding 6)", () => {
  it("re-reads the list once when a ready list is contradicted by a masked row", () => {
    setList("ready");
    const masked = messagesOf([
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    const { rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: masked } },
    );
    expect(list.retry).toHaveBeenCalledTimes(1);

    // The re-read came back and still does not name them (a masked copy that
    // outlived an unblock made elsewhere): no poll.
    setList("ready");
    rerender({ messages: masked });
    expect(list.retry).toHaveBeenCalledTimes(1);

    // A second contradicted sender is a new question.
    rerender({
      messages: messagesOf([
        restRow("m1", BLOCKED, { sender_blocked: true }),
        restRow("m2", OTHER, { sender_blocked: true }),
      ]),
    });
    expect(list.retry).toHaveBeenCalledTimes(2);
  });

  it("re-reads again when a member this client unblocked is blocked on another device (finding 7)", () => {
    // Blocked elsewhere, and a ready list that does not say so yet.
    setList("ready");
    const masked = messagesOf([
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    const { rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: masked } },
    );
    expect(list.retry).toHaveBeenCalledTimes(1);

    // The re-read names them: the contradiction is resolved.
    setList("ready", [BLOCKED]);
    rerender({ messages: masked });
    expect(list.retry).toHaveBeenCalledTimes(1);

    // Unblocked here, and the unblock's refresh brought m1 back clear.
    setList("ready", [], [BLOCKED]);
    rerender({ messages: messagesOf([restRow("m1", BLOCKED)]) });
    expect(list.retry).toHaveBeenCalledTimes(1);

    // Blocked again on another device: the next REST read masks m1 again. The
    // same row and the same sender as before, and this client's own unblock
    // on record — still a question the list has to answer.
    rerender({ messages: masked });
    expect(list.retry).toHaveBeenCalledTimes(2);
  });

  it("re-reads once for masked leftovers of this client's own unblock, then stops", () => {
    setList("ready", [], [BLOCKED]);
    const leftover = messagesOf([
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    const { rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: leftover } },
    );
    expect(list.retry).toHaveBeenCalledTimes(1);
    setList("ready", [], [BLOCKED]);
    rerender({ messages: leftover });
    expect(list.retry).toHaveBeenCalledTimes(1);
  });

  it("does not re-read on recovery just because the list was briefly unavailable", () => {
    setList("ready");
    const masked = messagesOf([
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    const { rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: masked } },
    );
    expect(list.retry).toHaveBeenCalledTimes(1);
    setList("unavailable");
    rerender({ messages: masked });
    setList("ready");
    rerender({ messages: masked });
    expect(list.retry).toHaveBeenCalledTimes(1);
  });

  it("does not re-read when the list agrees or is not ready", () => {
    setList("ready", [BLOCKED]);
    const masked = messagesOf([
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    const { rerender } = renderHook(() => useThreadBlockList(masked, VIEWER));
    setList("unavailable");
    rerender();
    expect(list.retry).not.toHaveBeenCalled();
  });
});

describe("useThreadBlockList — readable history is never wholesale held (#2315)", () => {
  // Provenance lives on each cached row, not in per-mount state, so nothing
  // resets when the member leaves a channel and comes back, and nothing has to
  // advance when a reconnect backfill merges straight into the cache through
  // `setQueryData`. The list here was never ready at all: the harshest case.

  it("re-entering an already-loaded channel shows its history, not a wall of holds", () => {
    setList("unavailable");
    const channelA = messagesOf([
      restRow("a1", FRIEND),
      restRow("a2", OTHER),
      restRow("a3", BLOCKED, { sender_blocked: true, content: "masked" }),
    ]);
    const channelB = messagesOf([restRow("b1", FRIEND)]);
    const { result, rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: channelA } },
    );
    const firstVisit = result.current.thread;
    expect(shownIds(result)).toEqual(["a1", "a2", "a3"]);
    expect(firstVisit.heldCount).toBe(0);

    rerender({ messages: channelB });
    expect(shownIds(result)).toEqual(["b1"]);

    // Back to the warm cache: the same rows, classified the same way.
    rerender({ messages: channelA });
    expect(shownIds(result)).toEqual(["a1", "a2", "a3"]);
    expect(result.current.thread.heldCount).toBe(0);
    expect(
      result.current.thread.rows.find((row) => row.message.id === "a3")
        ?.visibility,
    ).toBe("tombstone");
  });

  it("rows a reconnect backfill merged in show, while echoes that arrived in the outage stay held", () => {
    setList("unavailable");
    // Echoes from before the disconnect, then the backfill's REST page — the
    // realtime manager merges it with `mergeServerRow`, never the queryFn.
    const afterReconnect = messagesOf([
      echoRow("e1", FRIEND),
      restRow("r1", FRIEND),
      restRow("r2", OTHER),
    ]);
    const { result } = renderHook(() =>
      useThreadBlockList(afterReconnect, VIEWER),
    );

    expect(shownIds(result)).toEqual(["r1", "r2"]);
    expect(result.current.thread.heldCount).toBe(1);
  });
});
