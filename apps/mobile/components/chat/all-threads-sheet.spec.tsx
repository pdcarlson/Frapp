/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import { ALL_THREADS_EMPTY, ALL_THREADS_ERROR } from "@repo/hooks";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const read = vi.hoisted(() => ({
  value: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));

vi.mock("@repo/hooks", async () => ({
  ...(await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks")),
  useMemberThreads: () => read.value,
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#c8a24a" }),
}));

import { ThreadRows, type ThreadTarget } from "./all-threads-sheet";

const NAMES: Record<string, string> = { u1: "Blake", u2: "Casey" };

function message(over: Record<string, unknown>) {
  return {
    id: "root-1",
    channel_id: "c1",
    sender_id: "u1",
    content: "Dues are due Friday",
    is_deleted: false,
    created_at: "2026-11-13T18:00:00Z",
    thread_root_id: null,
    ...over,
  };
}

function thread(over: Record<string, unknown> = {}) {
  return {
    thread_root_id: "root-1",
    channel_id: "c1",
    state: "following",
    last_read_at: null,
    last_reply_at: "2026-11-13T19:00:00Z",
    reply_count: 1,
    unread_count: 2,
    root: message({}),
    latest_reply: message({
      id: "reply-1",
      sender_id: "u2",
      content: "Paid mine",
      thread_root_id: "root-1",
    }),
    ...over,
  };
}

function render(onOpen: (target: ThreadTarget) => void = vi.fn()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ThreadRows
          channelNameFor={(id) => (id === "c1" ? "#dues" : null)}
          nameFor={(id) => NAMES[id] ?? null}
          viewerId={null}
          onOpen={onOpen}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

beforeEach(() => {
  read.value = {
    data: [thread()],
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
});

describe("All threads (#4960)", () => {
  it("shows the channel, parent, latest reply and new count, and opens the thread", () => {
    const onOpen = vi.fn();
    const tree = render(onOpen);
    const shown = text(tree);
    expect(shown).toContain("#dues");
    expect(shown).toContain("2 new");
    expect(shown).toContain("Blake: Dues are due Friday");
    expect(shown).toContain("Casey: Paid mine");
    const row = tree.root.find(
      (node) =>
        node.props.accessibilityHint === "Opens this thread." &&
        typeof node.props.onPress === "function",
    );
    expect(row.props.accessibilityLabel).toBe("Thread in #dues, 2 new");
    act(() => row.props.onPress());
    expect(onOpen).toHaveBeenCalledWith({ channelId: "c1", rootId: "root-1" });
  });

  it("reads a blocked member's reply as the tombstone, not their words", () => {
    read.value.data = [
      thread({
        latest_reply: message({
          id: "reply-1",
          sender_id: "u2",
          content: "",
          sender_blocked: true,
        }),
      }),
    ];
    expect(text(render())).toContain(TOMBSTONE_TEXT);
  });

  it("says when there are none", () => {
    read.value.data = [];
    expect(text(render())).toContain(ALL_THREADS_EMPTY);
  });

  it("says the read failed rather than claiming there are none", () => {
    read.value = { ...read.value, data: undefined, isError: true };
    const shown = text(render());
    expect(shown).toContain(ALL_THREADS_ERROR);
    expect(shown).not.toContain(ALL_THREADS_EMPTY);
  });
});
