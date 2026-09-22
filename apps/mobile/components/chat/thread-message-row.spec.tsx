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

const attachmentHook = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMessageAttachments: () => {
      attachmentHook.calls += 1;
      return { isPending: false, isError: false, data: [] };
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

const READY_WITH_BLOCKED: BlockState = {
  status: "ready",
  ids: new Set([BLOCKED]),
};

function renderRow(
  row: ThreadRow,
  overrides: {
    blockState?: BlockState;
    onOpenActions?: (message: ChatMessage) => void;
    onUnblock?: (userId: string) => void;
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
          replyParent={undefined}
          blockState={overrides.blockState ?? READY_WITH_BLOCKED}
          onVote={vi.fn()}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          onOpenActions={overrides.onOpenActions ?? vi.fn()}
          onUnblock={overrides.onUnblock ?? vi.fn()}
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
});

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

  it("withholds Unblock on a masked leftover once the list says they are unblocked", () => {
    const tree = renderRow(
      {
        message: { ...leaked, _blockEvaluated: true, sender_blocked: true },
        visibility: "tombstone",
      },
      { blockState: { status: "ready", ids: new Set() } },
    );
    const flat = JSON.stringify(tree.toJSON());

    expect(flat).toContain(TOMBSTONE_STALE_TEXT);
    expect(flat).not.toContain("Unblock");
  });
});

describe("ThreadMessageRow — message actions", () => {
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
    expect(longPressTargets(tree)).toHaveLength(1);
  });
});
