/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { FrappThemeProvider } from "@/lib/theme";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const reads = vi.hoisted(() => ({
  pins: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  bookmarks: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    usePinnedMessages: () => reads.pins,
    useBookmarks: () => reads.bookmarks,
  };
});

import {
  MessageListSheet,
  PINNED_EMPTY,
  SAVED_EMPTY,
  SAVED_UNAVAILABLE,
  removeLabel,
  type ListedMessage,
  type MessageListKind,
} from "./message-list-sheet";

const NAMES: Record<string, string> = { u1: "Blake", u2: "Casey" };
const nameFor = (id: string) => NAMES[id] ?? null;

function message(over: Record<string, unknown>) {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u1",
    content: "Rush schedule is up",
    is_deleted: false,
    created_at: "2026-11-01T18:00:00Z",
    pinned_at: "2026-11-02T18:00:00Z",
    ...over,
  };
}

function render(
  kind: MessageListKind,
  handlers: {
    onOpen?: (target: ListedMessage) => void;
    onRemoveSaved?: (messageId: string) => void;
  } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageListSheet
          ref={createRef<BottomSheetModal>()}
          kind={kind}
          channelId="c1"
          nameFor={nameFor}
          onOpen={handlers.onOpen ?? vi.fn()}
          onRemoveSaved={handlers.onRemoveSaved}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function text(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function openButtons(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      node.props.accessibilityHint === "Opens this message in its channel." &&
      typeof node.props.onPress === "function",
  );
}

beforeEach(() => {
  reads.pins.data = [];
  reads.bookmarks.data = [];
});

describe("Pinned messages (#3723)", () => {
  it("lists the channel's pins newest pin first, and opens the one tapped", () => {
    reads.pins.data = [
      message({
        id: "old",
        content: "Old pin",
        pinned_at: "2026-10-01T00:00:00Z",
      }),
      message({
        id: "new",
        sender_id: "u2",
        content: "New pin",
        pinned_at: "2026-11-05T00:00:00Z",
      }),
    ];
    const onOpen = vi.fn();
    const tree = render("pinned", { onOpen });
    const shown = text(tree);
    expect(shown.indexOf("New pin")).toBeLessThan(shown.indexOf("Old pin"));
    expect(shown).toContain("Casey");
    act(() => openButtons(tree)[0]!.props.onPress());
    expect(onOpen).toHaveBeenCalledWith({
      channelId: "c1",
      messageId: "new",
      threadRootId: null,
    });
  });

  it("reads a blocked member's pin as the thread's tombstone, not their words", () => {
    reads.pins.data = [message({ content: "", sender_blocked: true })];
    expect(text(render("pinned"))).toContain(TOMBSTONE_TEXT);
  });

  it("says when there are none", () => {
    expect(text(render("pinned"))).toContain(PINNED_EMPTY);
  });
});

describe("Saved messages (#3723)", () => {
  it("opens a saved message in its own channel, and removes one", () => {
    reads.bookmarks.data = [
      {
        id: "b1",
        message_id: "m9",
        created_at: "2026-11-03T00:00:00Z",
        message: message({
          id: "m9",
          channel_id: "c2",
          content: "Dues due Friday",
        }),
      },
    ];
    const onOpen = vi.fn();
    const onRemoveSaved = vi.fn();
    const tree = render("saved", { onOpen, onRemoveSaved });
    expect(text(tree)).toContain("Dues due Friday");
    act(() => openButtons(tree)[0]!.props.onPress());
    expect(onOpen).toHaveBeenCalledWith({
      channelId: "c2",
      messageId: "m9",
      threadRootId: null,
    });
    const remove = tree.root.find(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith("Remove ") &&
        typeof node.props.onPress === "function",
    );
    act(() => remove.props.onPress());
    expect(onRemoveSaved).toHaveBeenCalledWith("m9");
  });

  it("does not open a message whose channel the viewer can no longer read", () => {
    reads.bookmarks.data = [
      {
        id: "b1",
        message_id: "m9",
        created_at: "2026-11-03T00:00:00Z",
        message_available: false,
        message: message({ id: "m9", channel_id: "c2", content: "" }),
      },
    ];
    const tree = render("saved");
    expect(text(tree)).toContain(SAVED_UNAVAILABLE);
    expect(openButtons(tree)).toHaveLength(0);
  });

  it("opens a saved thread reply in its thread, since a reply is never on the timeline", () => {
    reads.bookmarks.data = [
      {
        id: "b1",
        message_id: "r1",
        created_at: "2026-11-03T00:00:00Z",
        message: message({
          id: "r1",
          channel_id: "c2",
          thread_root_id: "root",
        }),
      },
    ];
    const onOpen = vi.fn();
    const tree = render("saved", { onOpen });
    act(() => openButtons(tree)[0]!.props.onPress());
    expect(onOpen).toHaveBeenCalledWith({
      channelId: "c2",
      messageId: "r1",
      threadRootId: "root",
    });
  });

  it("reads a blocked member's saved message as the tombstone, not the server's sentinel", () => {
    reads.bookmarks.data = [
      {
        id: "b1",
        message_id: "m9",
        created_at: "2026-11-03T00:00:00Z",
        message: message({
          id: "m9",
          content: "[message from a blocked member]",
          sender_blocked: true,
        }),
      },
    ];
    const shown = text(render("saved"));
    expect(shown).toContain(TOMBSTONE_TEXT);
    expect(shown).not.toContain("[message from a blocked member]");
  });

  it("previews a saved forward with no comment as its copy (#4875)", () => {
    reads.bookmarks.data = [
      {
        id: "b1",
        message_id: "m9",
        created_at: "2026-11-03T00:00:00Z",
        message: message({
          id: "m9",
          content: "",
          forwarded_from: {
            message_id: "orig-1",
            channel_id: "ch-2",
            sender_id: "u-3",
            author_name: "Sam",
            content: "the van leaves at 6",
            gif: null,
            attachment_count: 0,
            created_at: "2026-11-01T00:00:00Z",
            deleted: false,
            sender_blocked: false,
          },
        }),
      },
    ];
    expect(text(render("saved"))).toContain("Forwarded: the van leaves at 6");
  });

  it("names an unavailable row's Remove without calling it someone's message", () => {
    expect(removeLabel({ author: SAVED_UNAVAILABLE, openable: false })).toBe(
      "Remove this unavailable message from Saved",
    );
    expect(removeLabel({ author: "Blake", openable: true })).toBe(
      "Remove Blake's message from Saved",
    );
  });

  it("says when nothing is saved", () => {
    expect(text(render("saved"))).toContain(SAVED_EMPTY);
  });
});
