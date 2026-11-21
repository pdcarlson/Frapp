/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { FrappThemeProvider } from "@/lib/theme";
import { signetDarkTokens } from "@repo/theme/signet";
import { inSheet, skeletonBarFills } from "@/test/sheet-skeleton";
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
  /** Activity's read, which holds a channel's links (#5779). */
  activity: {
    data: undefined as { links: unknown[] } | undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  markRead: vi.fn(),
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    usePinnedMessages: () => reads.pins,
    useBookmarks: () => reads.bookmarks,
    useActivity: () => reads.activity,
    useActivityUnread: () => ({ markRead: reads.markRead }),
    useActivityFaces: () => () => null,
  };
});

import { ActivityListRow } from "@/components/activity/activity-row";
import {
  LINKS_EMPTY,
  LINKS_TITLE,
  MessageListSheet,
  PINNED_EMPTY,
  SAVED_EMPTY,
  SAVED_UNAVAILABLE,
  removeLabel,
  type ListedMessage,
  type MessageListKind,
} from "./message-list-sheet";
import { expectHostDismissGuarded } from "@/test/wedging-sheet";

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
    onOpenLink?: (row: unknown) => void;
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
          onOpenLink={handlers.onOpenLink}
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
  reads.activity = {
    ...reads.activity,
    data: { links: [] },
    isPending: false,
    isError: false,
  };
  reads.markRead.mockClear();
});

describe("Pinned messages (#3723)", () => {
  // #4690: the rows sit straight on the sheet's fill.
  it("draws its loading bars a step under the sheet, never in its fill", () => {
    const pins = reads.pins;
    reads.pins = { ...pins, data: undefined, isPending: true };
    const fills = inSheet(() => skeletonBarFills(render("pinned")));
    reads.pins = pins;
    expect(fills.length).toBeGreaterThan(0);
    expect(new Set(fills)).toEqual(
      new Set([signetDarkTokens.color.surface.card]),
    );
  });

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

describe("MessageListSheet — dismissed by the thread while closed (#4229)", () => {
  it("never reaches the modal unless it is up, so Pinned still opens", () => {
    expectHostDismissGuarded((ref) => (
      <FrappThemeProvider>
        <MessageListSheet
          ref={ref}
          kind="pinned"
          channelId="c1"
          nameFor={nameFor}
          onOpen={vi.fn()}
        />
      </FrappThemeProvider>
    ));
  });
});

describe("Links (#5779)", () => {
  const link = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    url: "https://forms.gle/abc",
    host: "forms.gle",
    title: "Rush shifts",
    message_id: "m1",
    thread_root_id: null,
    channel_id: "c1",
    channel_name: "rush",
    channel_type: "PUBLIC",
    posted_by: null,
    posted_by_name: "Olive",
    posted_at: "2026-11-10T15:00:00.000Z",
    unread: false,
    ...over,
  });
  const rows = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(ActivityListRow);

  it("lists the channel's sign-up links under web's title", () => {
    reads.activity.data = {
      links: [link(), link({ id: "l2", channel_id: "c2", title: "Elsewhere" })],
    };
    const tree = render("links");
    expect(text(tree)).toContain(LINKS_TITLE);
    expect(rows(tree).map((row) => row.props.row.title)).toEqual([
      "Rush shifts",
    ]);
  });

  it("opens a row's sheet, and reads it if it was unread", () => {
    reads.activity.data = {
      links: [link({ unread: true }), link({ id: "l2", title: "Read one" })],
    };
    const onOpenLink = vi.fn();
    const tree = render("links", { onOpenLink });
    act(() => rows(tree)[0]!.props.onPress());
    expect(reads.markRead).toHaveBeenCalledWith([
      { kind: "link", item_id: "l1" },
    ]);
    expect(onOpenLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "link:l1" }),
    );
    reads.markRead.mockClear();
    act(() => rows(tree)[1]!.props.onPress());
    expect(reads.markRead).not.toHaveBeenCalled();
    expect(onOpenLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "link:l2" }),
    );
  });

  it("says when the channel has none", () => {
    reads.activity.data = { links: [link({ channel_id: "c2" })] };
    expect(text(render("links"))).toContain(LINKS_EMPTY);
  });

  it("holds the rows' place while Activity's read loads", () => {
    reads.activity = { ...reads.activity, data: undefined, isPending: true };
    const tree = render("links");
    expect(rows(tree)).toHaveLength(0);
    expect(text(tree)).toContain("Loading links");
    expect(text(tree)).not.toContain(LINKS_EMPTY);
  });

  it("says a failed read with Retry, never as an empty list", () => {
    reads.activity = {
      ...reads.activity,
      data: undefined,
      isError: true,
      error: new TypeError("Network request failed"),
    };
    const tree = render("links");
    expect(text(tree)).toContain("Couldn't load links");
    expect(text(tree)).not.toContain(LINKS_EMPTY);
  });
});
