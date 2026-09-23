/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { reactionActionType } from "@repo/chat-core/types";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import type { BlockState, ThreadRow } from "@/lib/chat/blocks";
import type { MaskedRefreshState } from "@/lib/chat/masked-refresh";

const attachmentHook = vi.hoisted(() => ({
  calls: 0,
  data: [] as unknown[],
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMessageAttachments: () => {
      attachmentHook.calls += 1;
      return { isPending: false, isError: false, data: attachmentHook.data };
    },
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentFallbackApplied: false,
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { MESSAGE_ACTIONS_A11Y_LABEL } from "./message-bubble";
import {
  TOMBSTONE_STALE_TEXT,
  TOMBSTONE_TEXT,
} from "./blocked-message-tombstone";
import { HELD_QUOTE_TEXT } from "./reply-quote";
import { ThreadMessageRow } from "./thread-message-row";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: FRIEND,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "hello",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  };
}

function blockState(
  status: BlockState["status"],
  ids: string[],
  extras: { unblocked?: string[]; cleared?: string[] } = {},
): BlockState {
  return {
    status,
    ids: new Set(ids),
    unblocked: new Set(extras.unblocked ?? []),
    cleared: new Set(extras.cleared ?? []),
    reading: false,
  };
}

const READY_WITH_BLOCKED = blockState("ready", [BLOCKED]);

function renderRow(
  row: ThreadRow,
  overrides: {
    blockState?: BlockState;
    replyParent?: ChatMessage | null;
    onOpenActions?: (message: ChatMessage) => void;
    onUnblock?: (userId: string) => void;
    maskedRefresh?: ReadonlyMap<string, MaskedRefreshState>;
    onReload?: (userId: string) => void;
  } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ThreadMessageRow
          row={row}
          viewerId={VIEWER}
          nameFor={(id) => (id === BLOCKED ? "Blake" : "Casey")}
          replyParent={overrides.replyParent}
          blockState={overrides.blockState ?? READY_WITH_BLOCKED}
          onVote={vi.fn()}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          onOpenActions={overrides.onOpenActions ?? vi.fn()}
          onUnblock={overrides.onUnblock ?? vi.fn()}
          maskedRefresh={overrides.maskedRefresh ?? new Map()}
          onReload={overrides.onReload ?? vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function longPressTargets(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      typeof node.props.onLongPress === "function",
  );
}

beforeEach(() => {
  attachmentHook.calls = 0;
  attachmentHook.data = [];
});

function flat(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe("ThreadMessageRow — tombstone", () => {
  // A raw Realtime row from a blocked member: real content, files, reactions
  // and a poll payload all present. None of it may reach the screen.
  const leaked = message({
    sender_id: BLOCKED,
    _blockEvaluated: false,
    content: "the real words",
    attachment_count: 3,
    reactions: { [reactionActionType("🔥")]: [FRIEND] },
  });

  it("renders no body, attachments or reactions", () => {
    const tree = renderRow({ message: leaked, visibility: "tombstone" });
    const flat = JSON.stringify(tree.toJSON());

    expect(flat).toContain(TOMBSTONE_TEXT);
    expect(flat).not.toContain("the real words");
    expect(flat).not.toContain("🔥");
    expect(attachmentHook.calls).toBe(0);
  });

  it("tombstones a blocked member's poll instead of drawing a votable card", () => {
    const tree = renderRow({
      message: {
        ...leaked,
        kind: "poll",
        payload: {
          question: "Formal theme?",
          options: [{ id: "o1", label: "Masquerade" }],
        },
      },
      visibility: "tombstone",
    });
    const flat = JSON.stringify(tree.toJSON());

    expect(flat).toContain(TOMBSTONE_TEXT);
    expect(flat).not.toContain("Formal theme?");
    expect(flat).not.toContain("Masquerade");
  });

  it("offers Unblock for the sender, and nothing to long-press", () => {
    const onUnblock = vi.fn();
    const tree = renderRow(
      { message: leaked, visibility: "tombstone" },
      { onUnblock },
    );

    const button = tree.root.find(
      (node) => node.props.accessibilityLabel === "Unblock Blake",
    );
    act(() => button.props.onPress());
    expect(onUnblock).toHaveBeenCalledWith(BLOCKED);
    expect(longPressTargets(tree)).toHaveLength(0);
  });

  it("withholds Unblock on a masked leftover once this client unblocked them", () => {
    const tree = renderRow(
      {
        message: { ...leaked, _blockEvaluated: true, sender_blocked: true },
        visibility: "tombstone",
      },
      { blockState: blockState("ready", [], { unblocked: [BLOCKED] }) },
    );
    const flat = JSON.stringify(tree.toJSON());

    expect(flat).toContain(TOMBSTONE_STALE_TEXT);
    expect(flat).not.toContain("Unblock");
  });

  describe("a masked leftover whose post-unblock re-read did not land", () => {
    const leftover: ThreadRow = {
      message: { ...leaked, _blockEvaluated: true, sender_blocked: true },
      visibility: "tombstone",
    };
    const afterUnblock = blockState("ready", [], { unblocked: [BLOCKED] });

    it("offers Reload, which re-runs that member's re-read", () => {
      const onReload = vi.fn();
      const tree = renderRow(leftover, {
        blockState: afterUnblock,
        maskedRefresh: new Map([[BLOCKED, "failed" as const]]),
        onReload,
      });
      expect(flat(tree)).toContain(TOMBSTONE_STALE_TEXT);
      expect(flat(tree)).not.toContain("Unblock");

      const button = tree.root.find(
        (node) =>
          node.props.accessibilityLabel ===
            "Reload hidden messages from Blake" &&
          typeof node.props.onPress === "function",
      );
      act(() => button.props.onPress());
      expect(onReload).toHaveBeenCalledWith(BLOCKED);
    });

    it("shows the re-read as busy while it runs, with nothing to tap", () => {
      const tree = renderRow(leftover, {
        blockState: afterUnblock,
        maskedRefresh: new Map([[BLOCKED, "refreshing" as const]]),
      });
      expect(
        tree.root.findAll(
          (node) => (node.type as unknown) === "ActivityIndicator",
        ),
      ).toHaveLength(1);
      expect(
        tree.root.findAll((node) => typeof node.props.onPress === "function"),
      ).toHaveLength(0);
    });

    it("offers nothing once the re-read landed — Reload could not reach an older copy", () => {
      const tree = renderRow(leftover, { blockState: afterUnblock });
      expect(flat(tree)).not.toContain("Reload");
      expect(
        tree.root.findAll((node) => typeof node.props.onPress === "function"),
      ).toHaveLength(0);
    });
  });

  it("keeps Unblock when a ready list merely lacks them — a block made elsewhere looks like that (finding 6)", () => {
    const tree = renderRow(
      {
        message: { ...leaked, _blockEvaluated: true, sender_blocked: true },
        visibility: "tombstone",
      },
      { blockState: blockState("ready", []) },
    );
    expect(flat(tree)).toContain(TOMBSTONE_TEXT);
    expect(flat(tree)).toContain("Unblock");
  });
});

describe("ThreadMessageRow — reactions (finding 2)", () => {
  // `reaction:` plus arbitrary text: a blocked member's reaction is their words.
  const insult = reactionActionType("go away loser");

  it("never draws a blocked member's reaction, on anyone's message", () => {
    for (const sender of [FRIEND, VIEWER]) {
      const tree = renderRow({
        message: message({
          sender_id: sender,
          reactions: {
            [insult]: [BLOCKED],
            [reactionActionType("👍")]: [FRIEND, BLOCKED],
          },
        }),
        visibility: "visible",
      });
      expect(flat(tree)).not.toContain("go away loser");
      // The blocked reactor is not counted either.
      expect(flat(tree)).toContain("👍 1");
    }
  });

  it("shows only the viewer's own reactions while the list is unavailable", () => {
    const tree = renderRow(
      {
        message: message({
          _blockEvaluated: true,
          reactions: {
            [insult]: [FRIEND],
            [reactionActionType("👍")]: [FRIEND, VIEWER],
          },
        }),
        visibility: "visible",
      },
      { blockState: blockState("unavailable", []) },
    );
    expect(flat(tree)).not.toContain("go away loser");
    expect(flat(tree)).toContain("👍 1");
  });
});

describe("ThreadMessageRow — reply quotes (finding 7, #2312 §1)", () => {
  const parentWords = "the parent's real words";

  function reply(overrides: Partial<ChatMessage> = {}) {
    return message({
      id: "reply-1",
      client_message_id: "client-reply-1",
      reply_to_id: "parent-1",
      content: "replying",
      ...overrides,
    });
  }

  function parent(overrides: Partial<ChatMessage> = {}) {
    return message({
      id: "parent-1",
      client_message_id: "client-parent-1",
      content: parentWords,
      ...overrides,
    });
  }

  it("quotes a blocked member's message as the tombstone, never its text", () => {
    for (const sender of [FRIEND, VIEWER]) {
      const tree = renderRow(
        { message: reply({ sender_id: sender }), visibility: "visible" },
        { replyParent: parent({ sender_id: BLOCKED }) },
      );
      expect(flat(tree)).toContain(TOMBSTONE_TEXT);
      expect(flat(tree)).not.toContain(parentWords);
      expect(flat(tree)).not.toContain("Blake");
    }
  });

  it("quotes a server-masked parent the same way, whatever the list says", () => {
    const tree = renderRow(
      { message: reply(), visibility: "visible" },
      {
        replyParent: parent({
          sender_id: BLOCKED,
          sender_blocked: true,
          content: "[masked]",
        }),
        blockState: blockState("ready", []),
      },
    );
    expect(flat(tree)).toContain(TOMBSTONE_TEXT);
    expect(flat(tree)).not.toContain("[masked]");
  });

  it("quotes a held parent as hidden while the list is unreadable — fail closed", () => {
    const tree = renderRow(
      { message: reply(), visibility: "visible" },
      {
        replyParent: parent({ _blockEvaluated: false }),
        blockState: blockState("unavailable", []),
      },
    );
    expect(flat(tree)).toContain(HELD_QUOTE_TEXT);
    expect(flat(tree)).not.toContain(parentWords);
  });

  it("quotes a visible parent as before", () => {
    const tree = renderRow(
      { message: reply(), visibility: "visible" },
      { replyParent: parent() },
    );
    expect(flat(tree)).toContain(parentWords);
  });
});

describe("ThreadMessageRow — message actions", () => {
  it("reaches the actions from a photo, which is the whole of a photo-only message (finding 8)", () => {
    attachmentHook.data = [
      {
        id: "att-1",
        filename: "IMG_0001.jpg",
        content_type: "image/jpeg",
        download_url: "https://example.test/signed",
        width: 100,
        height: 100,
        byte_size: 1024,
      },
    ];
    const onOpenActions = vi.fn();
    const target = message({ content: "", attachment_count: 1 });
    const tree = renderRow(
      { message: target, visibility: "visible" },
      { onOpenActions },
    );

    const photo = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Open IMG_0001.jpg",
    );
    expect(typeof photo.props.onLongPress).toBe("function");
    act(() => photo.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledWith(target);
  });

  it("reaches the actions from a reaction chip instead of toggling it (finding 8)", () => {
    const onOpenActions = vi.fn();
    const target = message({
      reactions: { [reactionActionType("🔥")]: [FRIEND] },
    });
    const tree = renderRow(
      { message: target, visibility: "visible" },
      { onOpenActions },
    );

    const chips = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        typeof node.props.accessibilityLabel === "string" &&
        (node.props.accessibilityLabel.startsWith("🔥") ||
          node.props.accessibilityLabel.startsWith("React with")),
    );
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      act(() => chip.props.onLongPress());
    }
    expect(onOpenActions).toHaveBeenCalledTimes(chips.length);
  });

  it("puts the screen-reader action on accessible containers, never on a Text (finding 10)", () => {
    for (const target of [
      message(),
      message({ content: "", attachment_count: 1 }),
      message({
        kind: "poll",
        payload: {
          question: "Formal theme?",
          options: [{ id: "o1", label: "Masquerade" }],
        },
      }),
    ]) {
      const tree = renderRow({ message: target, visibility: "visible" });
      const withAction = tree.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          Array.isArray(node.props.accessibilityActions),
      );
      expect(withAction.length).toBeGreaterThan(0);
      for (const node of withAction) {
        expect(node.type).toBe("View");
        expect(node.props.accessible).toBe(true);
      }
    }
  });

  it("opens the actions for someone else's message by long-press", () => {
    const onOpenActions = vi.fn();
    const target = message();
    const tree = renderRow(
      { message: target, visibility: "visible" },
      { onOpenActions },
    );

    const [pressable] = longPressTargets(tree);
    expect(pressable).toBeDefined();
    // The wrapper must not swallow the chips and files inside it for VoiceOver.
    expect(pressable!.props.accessible).toBe(false);
    act(() => pressable!.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledWith(target);
  });

  it("exposes the same actions to a screen reader", () => {
    const onOpenActions = vi.fn();
    const tree = renderRow(
      { message: message(), visibility: "visible" },
      { onOpenActions },
    );

    const withAction = tree.root.findAll(
      (node) =>
        Array.isArray(node.props.accessibilityActions) &&
        node.props.accessibilityActions.some(
          (action: { label?: string }) =>
            action.label === MESSAGE_ACTIONS_A11Y_LABEL,
        ),
    );
    expect(withAction.length).toBeGreaterThan(0);
    act(() =>
      withAction[0]!.props.onAccessibilityAction({
        nativeEvent: { actionName: "longpress" },
      }),
    );
    expect(onOpenActions).toHaveBeenCalledTimes(1);
  });

  it("offers nothing on the viewer's own message", () => {
    const tree = renderRow({
      message: message({ sender_id: VIEWER }),
      visibility: "visible",
    });
    expect(longPressTargets(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).not.toContain(
      MESSAGE_ACTIONS_A11Y_LABEL,
    );
  });

  it("offers nothing on a row still in flight", () => {
    const tree = renderRow({
      message: message({ _status: "pending" }),
      visibility: "visible",
    });
    expect(longPressTargets(tree)).toHaveLength(0);
  });

  it("reaches the same sheet from someone else's poll card (#2312)", () => {
    const onOpenActions = vi.fn();
    const poll = message({
      kind: "poll",
      payload: {
        question: "Formal theme?",
        options: [{ id: "o1", label: "Masquerade" }],
      },
    });
    const tree = renderRow(
      { message: poll, visibility: "visible" },
      {
        onOpenActions,
      },
    );

    const targets = longPressTargets(tree);
    expect(targets.length).toBeGreaterThan(0);
    act(() => targets[0]!.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledWith(poll);
  });

  it("still opens on a system message — Block is gated inside the sheet", () => {
    const onOpenActions = vi.fn();
    const tree = renderRow(
      {
        message: message({ sender_id: SYSTEM_SENDER_ID }),
        visibility: "visible",
      },
      { onOpenActions },
    );
    const [row] = longPressTargets(tree).filter(
      (node) => node.props.accessible === false,
    );
    expect(row).toBeDefined();
    act(() => row!.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledTimes(1);
  });
});
