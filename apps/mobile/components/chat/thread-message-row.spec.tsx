/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { CARD_KINDS } from "@repo/chat-core/message-actions";
import { reactionActionType } from "@repo/chat-core/types";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";
import {
  HELD_QUOTE_TEXT,
  TOMBSTONE_STALE_TEXT,
  TOMBSTONE_TEXT,
} from "@repo/chat-core/block-copy";
import type {
  BlockState,
  MaskedRefreshState,
  ThreadRow,
} from "@repo/chat-core/blocks";

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
    // The poll card's Polls gate (#3012); its own spec covers the gate.
    useCurrentChapter: () => ({
      data: { enabled_modules: {} },
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn(),
    }),
    // The event and task cards' reads and writes (#3185); their own specs
    // cover what each one does. Here they only have to draw.
    usePermissionList: () => [],
    // The hours and rush cards read the query itself (#3383).
    useMyPermissions: () => ({ data: { permissions: [] } }),
    useTask: () => ({ data: undefined }),
    useEvent: () => ({ data: undefined, isError: false }),
    useAttendance: () => ({ data: undefined }),
    useCheckIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateTaskStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useConfirmTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRejectTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
    // The hours card's live read (#3383); its own spec covers the badge.
    useServiceEntry: () => ({ data: undefined }),
    // The rush card's live read and writes (#3383); its own spec covers them.
    useRushCandidate: () => ({ data: undefined, isError: false }),
    useVoteRushCandidate: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useBidRushCandidate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  JUMP_TO_PARENT_A11Y_LABEL,
  MESSAGE_ACTIONS_A11Y_LABEL,
} from "./message-item";
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
  };
}

const READY_WITH_BLOCKED = blockState("ready", [BLOCKED]);

function renderRow(
  row: ThreadRow,
  overrides: {
    blockState?: BlockState;
    replyParent?: ChatMessage | null;
    onOpenActions?: (message: ChatMessage) => void;
    onJumpToMessage?: (messageId: string) => void;
    onUnblock?: (userId: string) => void;
    maskedRefresh?: ReadonlyMap<string, MaskedRefreshState>;
    onReload?: (userId: string) => void;
    startsRun?: boolean;
    startsDay?: boolean;
  } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ThreadMessageRow
          row={row}
          startsRun={overrides.startsRun ?? true}
          startsDay={overrides.startsDay ?? false}
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
          onJumpToMessage={overrides.onJumpToMessage ?? vi.fn()}
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

  /** The quote's own pressable: the one that jumps rather than long-presses alone. */
  function quoteJump(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        typeof node.props.onPress === "function" &&
        node.props.accessibilityRole === "text",
    );
  }

  it("jumps to a shown parent when the quote is tapped (#2775)", () => {
    for (const sender of [FRIEND, VIEWER]) {
      const onJumpToMessage = vi.fn();
      const tree = renderRow(
        { message: reply({ sender_id: sender }), visibility: "visible" },
        { replyParent: parent(), onJumpToMessage },
      );
      const [quote] = quoteJump(tree);
      expect(quote).toBeDefined();
      act(() => quote!.props.onPress());
      expect(onJumpToMessage).toHaveBeenCalledWith("parent-1");
    }
  });

  it("offers the jump to a screen reader as a named action, since the quote isn't a button", () => {
    for (const sender of [FRIEND, VIEWER]) {
      const onJumpToMessage = vi.fn();
      const tree = renderRow(
        { message: reply({ sender_id: sender }), visibility: "visible" },
        { replyParent: parent(), onJumpToMessage },
      );
      const container = tree.root.find(
        (node) =>
          (node.type as unknown) === "View" &&
          Array.isArray(node.props.accessibilityActions) &&
          node.props.accessibilityActions.some(
            (action: { label?: string }) =>
              action.label === JUMP_TO_PARENT_A11Y_LABEL,
          ),
      );
      act(() =>
        container.props.onAccessibilityAction({
          nativeEvent: { actionName: "jumpToParent" },
        }),
      );
      expect(onJumpToMessage).toHaveBeenCalledWith("parent-1");
    }
  });

  it("opens the actions from a long-press on the quote, on either side", () => {
    for (const sender of [FRIEND, VIEWER]) {
      const onOpenActions = vi.fn();
      const target = reply({ sender_id: sender });
      const tree = renderRow(
        { message: target, visibility: "visible" },
        { replyParent: parent(), onOpenActions },
      );
      const [quote] = quoteJump(tree);
      act(() => quote!.props.onLongPress());
      expect(onOpenActions).toHaveBeenCalledWith(target);
    }
  });

  it("never offers the jump for a parent it cannot show", () => {
    for (const replyParent of [null, parent({ sender_id: BLOCKED })]) {
      const tree = renderRow(
        { message: reply(), visibility: "visible" },
        { replyParent },
      );
      expect(quoteJump(tree)).toHaveLength(0);
    }
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

  it("opens the sheet from the viewer's own message too, for Reply, Edit and Delete (#2775)", () => {
    const onOpenActions = vi.fn();
    const own = message({ sender_id: VIEWER });
    const tree = renderRow(
      { message: own, visibility: "visible" },
      { onOpenActions },
    );
    // The row itself: the non-accessible wrapper, not a chip inside it.
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessible === false &&
        typeof node.props.onLongPress === "function",
    );
    act(() => row.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledWith(own);
    expect(JSON.stringify(tree.toJSON())).toContain(MESSAGE_ACTIONS_A11Y_LABEL);
  });

  it("opens the actions from a long-press on a link, not the browser", () => {
    for (const sender of [FRIEND, VIEWER]) {
      const onOpenActions = vi.fn();
      const target = message({
        sender_id: sender,
        content: "see https://frapp.live/rush",
      });
      const tree = renderRow(
        { message: target, visibility: "visible" },
        { onOpenActions },
      );
      const link = tree.root.find(
        (node) =>
          (node.type as unknown) === "Text" &&
          node.props.accessibilityRole === "link",
      );
      act(() => link.props.onLongPress());
      expect(onOpenActions).toHaveBeenCalledWith(target);
    }
  });

  it("opens the actions from the viewer's own photo, the whole of a photo-only message", () => {
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
    const own = message({
      sender_id: VIEWER,
      content: "",
      attachment_count: 1,
    });
    const tree = renderRow(
      { message: own, visibility: "visible" },
      { onOpenActions },
    );
    const photo = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Open IMG_0001.jpg",
    );
    act(() => photo.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledWith(own);
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

describe("ThreadMessageRow — runs and day dividers (#2873)", () => {
  const visible = (m: ChatMessage): ThreadRow => ({
    message: m,
    visibility: "visible",
  });
  const allDrawnText = (tree: ReactTestRenderer) =>
    tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map(drawnText)
      .join(" ");

  it("draws a day divider above the first row of a day, and only there", () => {
    const today = new Date();
    today.setHours(9, 30, 0, 0);
    const row = visible(
      message({ sender_id: FRIEND, created_at: today.toISOString() }),
    );

    const first = renderRow(row, { startsDay: true });
    expect(
      first.root.findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          node.props.accessibilityRole === "header",
      ),
    ).toHaveLength(1);
    expect(allDrawnText(first)).toContain("Today");

    const later = renderRow(row, { startsDay: false });
    expect(allDrawnText(later)).not.toContain("Today");
  });

  it("draws the author line only on a row that starts a run", () => {
    const row = visible(message({ sender_id: FRIEND, content: "second" }));
    expect(allDrawnText(renderRow(row, { startsRun: true }))).toContain("Casey");
    expect(allDrawnText(renderRow(row, { startsRun: false }))).not.toContain(
      "Casey",
    );
  });

  it("gives a poll card the same author line as any other row", () => {
    const poll = visible(
      message({
        sender_id: FRIEND,
        kind: "poll",
        content: "Formal theme?",
        payload: {
          question: "Formal theme?",
          options: [
            { id: "a", label: "Casino" },
            { id: "b", label: "Masquerade" },
          ],
        },
      }),
    );
    const text = allDrawnText(renderRow(poll, { startsRun: true }));
    expect(text).toContain("Casey");
    expect(text).toContain("Formal theme?");
  });

  it("trails Pinned under a pinned poll card, as web does", () => {
    const poll = visible(
      message({
        sender_id: FRIEND,
        kind: "poll",
        is_pinned: true,
        payload: {
          question: "Formal theme?",
          options: [
            { id: "a", label: "Casino" },
            { id: "b", label: "Masquerade" },
          ],
        },
      }),
    );
    expect(flat(renderRow(poll))).toContain("Pinned");
    expect(
      flat(renderRow({ ...poll, message: { ...poll.message, is_pinned: false } })),
    ).not.toContain("Pinned");
  });

  it("draws a deleted poll as the placeholder, with no votes or reactions", () => {
    const deleted = visible(
      message({
        sender_id: FRIEND,
        kind: "poll",
        is_deleted: true,
        content: "",
        reactions: { [reactionActionType("🔥")]: [VIEWER] },
        payload: {
          question: "Formal theme?",
          options: [
            { id: "a", label: "Casino" },
            { id: "b", label: "Masquerade" },
          ],
        },
      }),
    );
    const out = flat(renderRow(deleted));
    expect(out).toContain("[message deleted]");
    expect(out).not.toContain("Formal theme?");
    expect(out).not.toContain("Casino");
    expect(out).not.toContain("🔥");
    expect(out).not.toContain("👍 +");
  });

  it("draws an event card and a task card in the row frame (#3185)", () => {
    const event = visible(
      message({
        sender_id: FRIEND,
        kind: "event",
        content: "New event: Chapter meeting",
        payload: {
          event_id: "evt-1",
          name: "Chapter meeting",
          start_time: "2026-11-05T23:00:00.000Z",
          end_time: "2026-11-06T00:00:00.000Z",
          location: "Great Hall",
          point_value: 10,
          is_mandatory: false,
        },
      }),
    );
    const eventText = allDrawnText(renderRow(event));
    expect(eventText).toContain("Casey");
    expect(eventText).toContain("Great Hall");
    expect(eventText).not.toContain("New event: Chapter meeting");

    const task = visible(
      message({
        sender_id: FRIEND,
        kind: "task",
        content: 'Assigned "Fix the door" to Bob',
        payload: {
          task_id: "task-1",
          title: "Fix the door",
          assigner_name: "Alice",
          assignee_name: "Bob",
          assignee_user_id: VIEWER,
          due_date: "2026-11-07",
        },
      }),
    );
    const taskText = allDrawnText(renderRow(task));
    expect(taskText).toContain("Casey");
    expect(taskText).toContain("Alice → Bob");
    expect(taskText).not.toContain('Assigned "Fix the door"');
  });

  it("draws an event or task whose payload doesn't read as its text", () => {
    for (const kind of ["event", "task"] as const) {
      const malformed = visible(
        message({ kind, content: "Something happened", payload: { id: 3 } }),
      );
      expect(allDrawnText(renderRow(malformed))).toContain("Something happened");
    }
  });

  it("draws a deleted event or task as the placeholder, with no actions", () => {
    const deletedEvent = visible(
      message({
        kind: "event",
        is_deleted: true,
        content: "",
        payload: {
          event_id: "evt-1",
          name: "Chapter meeting",
          start_time: "2026-11-05T23:00:00.000Z",
          end_time: "2026-11-06T00:00:00.000Z",
        },
      }),
    );
    const out = flat(renderRow(deletedEvent));
    expect(out).toContain("[message deleted]");
    expect(out).not.toContain("Chapter meeting");
    expect(out).not.toContain("Check in");
  });

  it("offers a poll reply's jump to a screen reader, as a text reply does", () => {
    const parent = message({ id: "parent-1", sender_id: FRIEND, content: "which theme?" });
    const onJumpToMessage = vi.fn();
    const tree = renderRow(
      visible(
        message({
          id: "poll-reply",
          sender_id: FRIEND,
          kind: "poll",
          reply_to_id: "parent-1",
          payload: {
            question: "Formal theme?",
            options: [
              { id: "a", label: "Casino" },
              { id: "b", label: "Masquerade" },
            ],
          },
        }),
      ),
      { replyParent: parent, onJumpToMessage },
    );
    const host = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        Array.isArray(node.props.accessibilityActions) &&
        node.props.accessibilityActions.some(
          (action: { name?: string }) => action.name === "jumpToParent",
        ),
    );
    act(() =>
      host.props.onAccessibilityAction({
        nativeEvent: { actionName: "jumpToParent" },
      }),
    );
    expect(onJumpToMessage).toHaveBeenCalledWith("parent-1");
  });
});

describe("ThreadMessageRow — record cards (#3383)", () => {
  const visible = (m: ChatMessage): ThreadRow => ({
    message: m,
    visibility: "visible",
  });
  const allDrawnText = (tree: ReactTestRenderer) =>
    tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map(drawnText)
      .join(" ");

  const POINTS = {
    actor_user_id: FRIEND,
    actor_name: "Alice",
    recipient_user_id: VIEWER,
    recipient_name: "Bob",
    amount: -3,
    category: "FINE",
    reason: "Late to chapter",
  };
  const HOURS = {
    entry_id: "entry-1",
    user_id: FRIEND,
    user_name: "Casey Lin",
    duration_minutes: 150,
    description: "Food bank shift",
    date: "2026-11-04",
  };
  const AUDIT = {
    action: "role_updated",
    actor_user_id: BLOCKED,
    diff: { permissions: { added: ["tasks:manage"], removed: [] } },
  };

  /**
   * One drawable payload per kind mobile draws as a card, and the eyebrow that
   * says so. A kind added to `CARD_KINDS` fails the coverage case below until
   * it is drawn here or listed in `TEXT_ON_MOBILE` on purpose.
   */
  const CARDS: Record<string, { payload: unknown; eyebrow: string }> = {
    poll: {
      payload: {
        question: "Formal theme?",
        options: [
          { id: "a", label: "Casino" },
          { id: "b", label: "Masquerade" },
        ],
      },
      eyebrow: "Poll",
    },
    event: {
      payload: {
        event_id: "evt-1",
        name: "Chapter meeting",
        start_time: "2026-11-05T23:00:00.000Z",
        end_time: "2026-11-06T00:00:00.000Z",
      },
      eyebrow: "Event",
    },
    task: {
      payload: {
        task_id: "task-1",
        title: "Fix the door",
        assigner_name: "Alice",
        assignee_name: "Bob",
        due_date: "2026-11-07",
      },
      eyebrow: "Task",
    },
    points: { payload: POINTS, eyebrow: "Points" },
    hours: { payload: HOURS, eyebrow: "Service hours" },
    announcement: { payload: { body: "Dues are due Friday" }, eyebrow: "Announcement" },
    system_audit: { payload: AUDIT, eyebrow: "Audit" },
    rush: {
      payload: {
        candidate_id: "cand-1",
        display_name: "Jordan Reyes",
        added_by_name: "Alice",
      },
      // The IFC word: the mocked chapter names no archetype.
      eyebrow: "Rush",
    },
  };
  /** Card kinds mobile draws as their text on purpose (`cardFor`). */
  const TEXT_ON_MOBILE = ["dues", "loading"];

  it("draws every card kind as a card, but the ones it means to leave as text", () => {
    expect(new Set([...Object.keys(CARDS), ...TEXT_ON_MOBILE])).toEqual(
      new Set(CARD_KINDS),
    );
    for (const [kind, { payload, eyebrow }] of Object.entries(CARDS)) {
      const text = allDrawnText(
        renderRow(
          visible(
            message({
              kind: kind as ChatMessage["kind"],
              content: kind === "announcement" ? "Dues are due Friday" : "FALLBACK",
              payload: payload as ChatMessage["payload"],
            }),
          ),
        ),
      );
      expect(text, kind).toContain(eyebrow);
      expect(text, kind).not.toContain("FALLBACK");
    }
    for (const kind of TEXT_ON_MOBILE) {
      const text = allDrawnText(
        renderRow(
          visible(
            message({
              kind: kind as ChatMessage["kind"],
              content: "FALLBACK",
              payload: {},
            }),
          ),
        ),
      );
      expect(text, kind).toContain("FALLBACK");
    }
  });

  it("draws a points card as web's sentence and the reason", () => {
    const text = allDrawnText(
      renderRow(
        visible(
          message({
            kind: "points",
            content: "Alice deducted 3 points from Bob",
            payload: POINTS,
          }),
        ),
      ),
    );
    expect(text).toContain("Alice deducted \u22123 points from Bob");
    expect(text).toContain("\u201CLate to chapter\u201D");
  });

  it("draws an hours card with the duration and the day, not the stored date", () => {
    const text = allDrawnText(
      renderRow(
        visible(message({ kind: "hours", content: "Logged", payload: HOURS })),
      ),
    );
    expect(text).toContain("Casey Lin logged 2h 30m on");
    expect(text).not.toContain("2026-11-04");
    expect(text).toContain("\u201CFood bank shift\u201D");
  });

  it("names the audit actor from the roster, never by an id prefix", () => {
    const text = allDrawnText(
      renderRow(
        visible(
          message({
            kind: "system_audit",
            sender_id: SYSTEM_SENDER_ID,
            content: "role_updated: permissions",
            payload: AUDIT,
          }),
        ),
      ),
    );
    expect(text).toContain("role_updated");
    expect(text).toContain("by Blake");
    expect(text).not.toContain(BLOCKED.slice(0, 6));
    expect(text).toContain("Changed: permissions");
  });

  it("draws the server's own notices, which carry no audit payload, as their sentence", () => {
    const text = allDrawnText(
      renderRow(
        visible(
          message({
            kind: "system_audit",
            sender_id: SYSTEM_SENDER_ID,
            content: "This poll has closed.",
            payload: null,
          }),
        ),
      ),
    );
    expect(text).toContain("This poll has closed.");
    expect(text).not.toContain("Audit");
  });

  it("draws an announcement's content, the words the push showed, over its payload", () => {
    const text = allDrawnText(
      renderRow(
        visible(
          message({
            kind: "announcement",
            content: "Chapter at 8, **formal** dress",
            payload: { body: "Something else entirely" },
          }),
        ),
      ),
    );
    expect(text).toContain("Chapter at 8, formal dress");
    expect(text).not.toContain("Something else entirely");
  });

  it("offers an announcement's links to a screen reader on the card", () => {
    const tree = renderRow(
      visible(
        message({
          kind: "announcement",
          content: "Sign up at https://example.com/formal",
          payload: null,
        }),
      ),
    );
    const host = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        Array.isArray(node.props.accessibilityActions) &&
        node.props.accessibilityActions.some((action: { label?: string }) =>
          action.label?.startsWith("Open "),
        ),
    );
    expect(host.props.accessible).toBe(true);
  });

  it("draws a points, hours or rush row whose payload doesn't read as its text", () => {
    for (const kind of ["points", "hours", "rush"] as const) {
      const text = allDrawnText(
        renderRow(
          visible(
            message({ kind, content: "Something happened", payload: { id: 3 } }),
          ),
        ),
      );
      expect(text, kind).toContain("Something happened");
    }
  });
});
