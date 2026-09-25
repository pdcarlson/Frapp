import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockClearance } from "@repo/chat-core/blocks";
import {
  emptyCache,
  mergeServerRow,
  selectMessages,
} from "@repo/chat-core/cache";
import type { ChatMessage, RawChatMessage } from "@repo/chat-core/types";
import type { BlockedUserIds } from "@repo/hooks";
import type { BlockListStatus } from "@repo/validation";

const list = vi.hoisted(() => ({
  current: null as unknown as BlockedUserIds,
  retry: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useBlockedUserIds: () => list.current };
});

const { CachedBlockFloorContext, useThreadBlockList } = await import(
  "./use-thread-block-list"
);

const VIEWER = "11111111-1111-4111-8111-111111111111";
const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";

function setList(
  status: BlockListStatus,
  ids: string[] = [],
  {
    unblocked = [],
    readAt = status === "ready" ? 1 : 0,
  }: { unblocked?: string[]; readAt?: number } = {},
) {
  list.current = {
    status,
    ids: new Set(ids),
    unblocked: new Set(unblocked),
    retry: list.retry,
    isRetrying: false,
    isPaused: false,
    readAt,
  };
}

/** Renders under `ChatProvider`'s floor context, as the shell does. */
function withFloor(floor: string[]) {
  const value = new Set(floor);
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CachedBlockFloorContext.Provider value={value}>
        {children}
      </CachedBlockFloorContext.Provider>
    );
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
    created_at: "2026-09-25T18:05:12.400000+00:00",
  };
}

function restRow(
  id: string,
  senderId: string,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return { ...echoRow(id, senderId), sender_blocked: false, ...overrides };
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

// The web timeline's copy of mobile's hook glue: the rules themselves are
// `@repo/chat-core/blocks`' and are specced there. These pin that the glue
// runs them — the clearances, and the contradiction re-read (#2313).
describe("useThreadBlockList (web)", () => {
  it("keeps what a ready list showed through a later outage, and holds what arrives during it", () => {
    setList("ready");
    const before = messagesOf([echoRow("m1", FRIEND)]);
    const { result, rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: before } },
    );
    expect(shownIds(result)).toEqual(["m1"]);

    setList("unavailable");
    rerender({ messages: before });
    expect(shownIds(result)).toEqual(["m1"]);

    const during = messagesOf([echoRow("m1", FRIEND), echoRow("m2", FRIEND)]);
    rerender({ messages: during });
    expect(shownIds(result)).toEqual(["m1"]);
    expect(result.current.thread.heldCount).toBe(1);
  });

  it("tombstones a blocked sender's echo against a ready list", () => {
    setList("ready", [BLOCKED]);
    const { result } = renderHook(() =>
      useThreadBlockList(messagesOf([echoRow("m1", BLOCKED)]), VIEWER),
    );
    expect(result.current.thread.rows).toEqual([
      expect.objectContaining({ visibility: "tombstone" }),
    ]);
  });

  it("re-reads a ready list once per set of masked rows that contradict it", () => {
    // A masked REST row for a sender the ready list does not name: a block
    // made on another device, until the list is re-read.
    setList("ready");
    const masked = messagesOf([
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    const { rerender } = renderHook(
      ({ messages }) => useThreadBlockList(messages, VIEWER),
      { initialProps: { messages: masked } },
    );
    expect(list.retry).toHaveBeenCalledTimes(1);

    // The same rows on the next answer are not a new question.
    setList("ready");
    rerender({ messages: masked });
    expect(list.retry).toHaveBeenCalledTimes(1);
  });

  it("records nothing without a viewer", () => {
    setList("ready");
    renderHook(() =>
      useThreadBlockList(messagesOf([echoRow("m1", FRIEND)]), null),
    );
    expect(blockClearance.snapshot(VIEWER).size).toBe(0);
  });
});

/*
  The persisted floor (#2688). A cached tail keeps each REST row's cleared
  verdict so a warm load paints, and the classifier shows a cleared row in
  every list state unless its sender is on `ids`, so without the floor a
  member blocked since the tail was read painted until the list landed.
*/
describe("useThreadBlockList (web): the persisted block-list floor", () => {
  const cachedTail = () =>
    messagesOf([restRow("m1", BLOCKED), restRow("m2", FRIEND)]);

  it("tombstones a floor member's cached rows before the list lands, and still paints everyone else's", () => {
    setList("loading");
    const { result } = renderHook(
      () => useThreadBlockList(cachedTail(), VIEWER),
      { wrapper: withFloor([BLOCKED]) },
    );
    expect(
      result.current.thread.rows.map((row) => [row.message.id, row.visibility]),
    ).toEqual([
      ["m1", "tombstone"],
      ["m2", "visible"],
    ]);
  });

  it("holds for a whole outage when the list never reads", () => {
    setList("unavailable");
    const { result } = renderHook(
      () => useThreadBlockList(cachedTail(), VIEWER),
      { wrapper: withFloor([BLOCKED]) },
    );
    expect(result.current.blockState.ids.has(BLOCKED)).toBe(true);
    expect(result.current.thread.rows[0]).toEqual(
      expect.objectContaining({ visibility: "tombstone" }),
    );
  });

  it("retires once the live list has been read, even if a refetch then fails", () => {
    // The ready read said nobody is blocked (an unblock on another device), so
    // a failed refetch must not turn the rows it showed back into tombstones.
    setList("unavailable", [], { readAt: 1 });
    const { result } = renderHook(
      () => useThreadBlockList(cachedTail(), VIEWER),
      { wrapper: withFloor([BLOCKED]) },
    );
    expect(result.current.blockState.ids.has(BLOCKED)).toBe(false);
    expect(shownIds(result)).toEqual(["m1", "m2"]);
  });

  it("drops a member this client confirmed unblocking", () => {
    setList("unavailable", [], { unblocked: [BLOCKED] });
    const { result } = renderHook(
      () => useThreadBlockList(cachedTail(), VIEWER),
      { wrapper: withFloor([BLOCKED]) },
    );
    expect(result.current.blockState.ids.has(BLOCKED)).toBe(false);
    expect(result.current.thread.rows[0]).toEqual(
      expect.objectContaining({ visibility: "visible" }),
    );
  });

  it("changes nothing outside the provider", () => {
    setList("loading");
    const { result } = renderHook(() =>
      useThreadBlockList(cachedTail(), VIEWER),
    );
    expect(shownIds(result)).toEqual(["m1", "m2"]);
  });
});
