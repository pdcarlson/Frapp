/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Alert } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import { Chip } from "@/components/filter-chips";
import { useOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ThreadMessageRow } from "@/components/chat/thread-message-row";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The pushed message thread (#3785): what the screen draws from its hook and
 * what it hands back. `useMessageThread` is stubbed; the shared reads, writes
 * and cache it wraps are chat-core's `threads.ts`, pinned by its own spec.
 */

// Chat backgrounds (#3973) read their own query; decoration, not under test here.
vi.mock("@/components/chat/chat-background", () => ({
  ChatBackground: () => null,
}));

vi.mock("react-native", async () => {
  const { reactNativeStub, RenderingFlatList } =
    await import("@/test/react-native-stub");
  return { ...reactNativeStub, FlatList: RenderingFlatList };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));

const CHANNEL = "chan-1";
const ROOT = "root-1";
const VIEWER = "11111111-1111-4111-8111-111111111111";
const CASEY = "22222222-2222-4222-8222-222222222222";
const BLOCKED = "33333333-3333-4333-8333-333333333333";
const NAMES: Record<string, string> = {
  [CASEY]: "Casey",
  [BLOCKED]: "Blake",
};

function message(
  id: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    client_message_id: `c-${id}`,
    channel_id: CHANNEL,
    sender_id: CASEY,
    sender_blocked: false,
    _blockEvaluated: true,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: `text ${id}`,
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 10, 10, 17, 0).toISOString(),
    attachment_count: 0,
    mentions: [],
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

type ThreadStub = ReturnType<
  typeof import("@/lib/chat/use-message-thread").useMessageThread
>;

function threadState(overrides: Partial<ThreadStub> = {}): ThreadStub {
  return {
    connection: "live",
    root: message(ROOT, {
      content: "Who's driving Saturday?",
      thread: { reply_count: 2, last_reply_at: null, recent_sender_ids: [] },
    }),
    followState: null,
    metaError: null,
    isLoading: false,
    repliesError: null,
    retryLoad: vi.fn(),
    messages: [
      message("r1", { thread_root_id: ROOT, content: "I can" }),
      message("r2", {
        thread_root_id: ROOT,
        sender_id: VIEWER,
        content: "Me too",
        created_at: new Date(2026, 10, 10, 17, 1).toISOString(),
      }),
    ],
    hasOlder: false,
    isLoadingOlder: false,
    loadOlder: vi.fn(async () => ({ error: null })),
    typingUsers: [],
    setFollow: vi.fn(async () => {}),
    send: vi.fn(async () => ({ error: null })),
    retry: vi.fn(async () => ({ error: null })),
    refreshRoot: vi.fn(),
    discard: vi.fn(),
    emitTyping: vi.fn(),
    ...overrides,
  } as ThreadStub;
}

let thread = threadState();
/** The channel cache's copy of the parent (`useHeldChannelMessage`). */
let heldRoot: ChatMessage | null = null;
vi.mock("@/lib/chat/use-message-thread", () => ({
  useMessageThread: () => thread,
  useHeldChannelMessage: () => heldRoot,
}));

const writes = {
  react: vi.fn(async () => {}),
  unreact: vi.fn(async () => {}),
  act: vi.fn(async () => {}),
  edit: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  closePoll: vi.fn(async () => {}),
  rowError: null as string | null,
};
let writesInput: Record<string, unknown> | null = null;
vi.mock("@/lib/chat/use-thread-row-writes", () => ({
  useThreadRowWrites: (input: Record<string, unknown>) => {
    writesInput = input;
    return writes;
  },
}));

vi.mock("@/lib/haptics", () => ({ selectionHaptic: () => {} }));

const presentSheet = vi.fn();
vi.mock("@/components/chat/message-actions-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    MessageActionsSheet: forwardRef(function MessageActionsSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentSheet,
        dismiss: () => {},
      }));
      return createElement("MessageActionsSheet", props);
    }),
  };
});

let channelRow: Record<string, unknown> = {
  id: CHANNEL,
  name: "general",
  type: "PUBLIC",
  can_post: true,
  is_read_only: false,
};
let viewerId: string | null = VIEWER;
let permissions: string[] = [];
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChannel: () => ({ data: channelRow, isFetching: false }),
  useViewerUserId: () => viewerId,
  useAuthorAvatars: () => ({ data: undefined }),
  usePermissionList: () => permissions,
  useActiveChapterId: () => "chapter-1",
  useMemberDisplayNames: () => ({
    byId: {},
    nameFor: (id: string) => NAMES[id] ?? null,
    roleColorFor: () => null,
    avatarFor: () => null,
    isPending: false,
    isError: false,
    refetch: () => {},
  }),
  useBlockedUserIds: () => ({
    status: "ready" as const,
    ids: new Set([BLOCKED]),
    unblocked: new Set<string>(),
    retry: () => {},
    isRetrying: false,
    isPaused: false,
  }),
}));

const unblock = vi.fn(async () => {});
vi.mock("@/lib/chat/block-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/block-actions")>()),
  useBlockActions: () => ({ unblock, block: vi.fn() }),
}));

let writeBlockedReason: string | null = null;
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({
    isOffline: writeBlockedReason !== null,
    writeBlockedReason,
  }),
}));

import {
  MessageThreadScreen,
  THREAD_NO_REPLY_HINT,
  THREAD_OFFLINE_HINT,
} from "./message-thread-screen";

let queryClient = new QueryClient();

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappThemeProvider>
          <MessageThreadScreen channelId={CHANNEL} rootId={ROOT} />
        </FrappThemeProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

const followChip = (tree: ReactTestRenderer) => tree.root.findByType(Chip);

beforeEach(() => {
  vi.clearAllMocks();
  thread = threadState();
  channelRow = {
    id: CHANNEL,
    name: "general",
    type: "PUBLIC",
    can_post: true,
    is_read_only: false,
  };
  viewerId = VIEWER;
  permissions = [];
  writeBlockedReason = null;
  heldRoot = null;
  writes.rowError = null;
  writesInput = null;
  queryClient = new QueryClient();
});

describe("MessageThreadScreen (#3785)", () => {
  it("draws the parent, the reply count, then the replies under a Thread header", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Thread");
    expect(text).toContain("#general");
    expect(text).toContain("2 replies");
    // Inverted, as s05's list is: newest first in the data, so it draws at
    // the bottom, and the parent rides the footer, which draws at the top.
    const list = tree.root.findByType("FlatList" as never);
    expect(list.props.inverted).toBe(true);
    expect(
      (list.props.data as { message: ChatMessage }[]).map(
        (row) => row.message.id,
      ),
    ).toEqual(["r2", "r1"]);
    // The stub draws the footer after the rows: the parent, then the divider.
    const drawn = tree.root
      .findAll(
        (node) =>
          typeof node.props.onRetry === "function" && !!node.props.message,
      )
      .map((node) => (node.props.message as ChatMessage).id);
    expect([...new Set(drawn)]).toEqual(["r2", "r1", ROOT]);
    // The parent's chip belongs to the channel; inside, the divider says it.
    expect(
      tree.root.findAll((node) => node.props.testID === "thread-chip"),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("follows and unfollows from the header", async () => {
    const tree = render();
    await act(async () => followChip(tree).props.onPress());
    expect(thread.setFollow).toHaveBeenCalledWith("following");

    thread = threadState({ followState: "following" });
    act(() =>
      tree.update(
        <QueryClientProvider client={queryClient}>
          <FrappThemeProvider>
            <MessageThreadScreen channelId={CHANNEL} rootId={ROOT} />
          </FrappThemeProvider>
        </QueryClientProvider>,
      ),
    );
    expect(followChip(tree).props.label).toBe("Following");
    expect(followChip(tree).props.on).toBe(true);
    await act(async () => followChip(tree).props.onPress());
    expect(thread.setFollow).toHaveBeenCalledWith("none");
    act(() => tree.unmount());
  });

  it("says so when a follow change fails", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    thread = threadState({
      setFollow: vi.fn(async () => {
        throw new Error("Network down");
      }),
    });
    const tree = render();
    await act(async () => followChip(tree).props.onPress());
    expect(alert).toHaveBeenCalledWith(
      "Couldn't change this thread",
      "Network down",
    );
    act(() => tree.unmount());
  });

  it("names who is typing in the thread, never a blocked member or the viewer", () => {
    thread = threadState({ typingUsers: [CASEY, BLOCKED, VIEWER] });
    const tree = render();
    expect(screenText(tree)).toContain("Casey is typing…");
    expect(screenText(tree)).not.toContain("Blake");
    act(() => tree.unmount());
  });

  it("shows a blocked member's reply as a tombstone, with Unblock", async () => {
    thread = threadState({
      messages: [
        message("r1", {
          thread_root_id: ROOT,
          sender_id: BLOCKED,
          content: "secret",
        }),
      ],
    });
    const tree = render();
    expect(screenText(tree)).toContain(TOMBSTONE_TEXT);
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    act(() =>
      tree.root
        .find(
          (node) =>
            node.type === ("Pressable" as never) &&
            screenText({ root: node } as never).includes("Unblock"),
        )
        .props.onPress(),
    );
    // The confirmation's destructive button runs the unblock, then a re-read.
    const buttons = alert.mock.calls[0]![2] as {
      style?: string;
      onPress?: () => void;
    }[];
    await act(async () =>
      buttons.find((button) => button.style !== "cancel")!.onPress!(),
    );
    expect(unblock).toHaveBeenCalledWith(BLOCKED);
    expect(thread.retryLoad).toHaveBeenCalled();
    expect(
      tree.root.findAll(
        (node) =>
          typeof node.props.onRetry === "function" &&
          node.props.message?.id === "r1",
      ),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("sends a reply, and says why when it fails", async () => {
    thread = threadState({
      send: vi.fn(async () => ({ error: "Slow down" })),
    });
    const tree = render();
    const composer = () => tree.root.findByType(ChatComposer);
    expect(composer().props.placeholder).toBe("Reply in thread…");
    act(() => composer().props.onChangeText("On my way"));
    expect(thread.emitTyping).toHaveBeenCalled();
    await act(async () => composer().props.onSend());
    expect(thread.send).toHaveBeenCalledWith("On my way");
    expect(composer().props.value).toBe("");
    expect(composer().props.disabledHint).toBe("Slow down");
    expect(composer().props.hintTone).toBe("error");
    act(() => tree.unmount());
  });

  it("retries a failed reply with its own client id, so the server dedupes", async () => {
    thread = threadState({
      messages: [
        message("r9", {
          thread_root_id: ROOT,
          sender_id: VIEWER,
          content: "lost",
          _status: "failed",
        }),
      ],
    });
    const tree = render();
    const row = tree.root.find(
      (node) =>
        typeof node.props.onRetry === "function" &&
        node.props.message?.id === "r9",
    );
    await act(async () => row.props.onRetry("c-r9"));
    // The hook re-sends it under its own client id (`useMessageThread.retry`).
    expect(thread.retry).toHaveBeenCalledWith("c-r9");
    act(() => row.props.onDiscard("c-r9"));
    expect(thread.discard).toHaveBeenCalledWith("c-r9");
    act(() => tree.unmount());
  });

  it("disables the composer offline and says why, since a reply has no queue", () => {
    writeBlockedReason = "Reconnect to make changes.";
    const tree = render();
    const composer = tree.root.findByType(ChatComposer);
    expect(composer.props.canSend).toBe(false);
    expect(composer.props.disabledHint).toBe(THREAD_OFFLINE_HINT);
    act(() => tree.unmount());
  });

  it("lets a reader reply in a read-only channel's thread", () => {
    channelRow = { ...channelRow, can_post: false, is_read_only: true };
    const tree = render();
    const composer = tree.root.findByType(ChatComposer);
    expect(composer.props.canSend).toBe(true);
    expect(composer.props.disabledHint).toBeNull();
    act(() => tree.unmount());
  });

  it("closes the composer where the viewer can't post at all", () => {
    channelRow = { ...channelRow, can_post: false, is_read_only: false };
    const tree = render();
    const composer = tree.root.findByType(ChatComposer);
    expect(composer.props.canSend).toBe(false);
    expect(composer.props.disabledHint).toBe(THREAD_NO_REPLY_HINT);
    act(() => tree.unmount());
  });

  it("offers earlier replies when the first read came back full", async () => {
    thread = threadState({ hasOlder: true });
    const tree = render();
    await act(async () =>
      tree.root
        .find(
          (node) =>
            node.type === ("Pressable" as never) &&
            screenText({ root: node } as never).includes(
              "Load earlier replies",
            ),
        )
        .props.onPress(),
    );
    expect(thread.loadOlder).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("counts the thread's replies, not just the loaded page or unsent rows", () => {
    thread = threadState({
      hasOlder: true,
      root: message(ROOT, {
        thread: {
          reply_count: 120,
          last_reply_at: null,
          recent_sender_ids: [],
        },
      }),
    });
    const many = render();
    expect(screenText(many)).toContain("120 replies");
    act(() => many.unmount());

    thread = threadState({
      messages: [
        message("r1", { thread_root_id: ROOT }),
        message("r2", { thread_root_id: ROOT, _status: "failed" }),
      ],
      root: message(ROOT, {
        thread: { reply_count: 1, last_reply_at: null, recent_sender_ids: [] },
      }),
    });
    const one = render();
    expect(screenText(one)).toContain("1 reply");
    act(() => one.unmount());
  });

  it("keeps the empty typing line away from a screen reader", () => {
    const quiet = render();
    const slot = () =>
      quiet.root.find((node) => node.props.testID === "typing-line");
    expect(slot().props.accessibilityElementsHidden).toBe(true);
    expect(slot().props.accessibilityLiveRegion).toBeUndefined();
    act(() => quiet.unmount());
  });

  it("dismisses the keyboard on a drag, as s05 does", () => {
    const tree = render();
    expect(
      tree.root.findByType("FlatList" as never).props.keyboardDismissMode,
    ).toBe("on-drag");
    act(() => tree.unmount());
  });

  it("offers a retry when the thread can't load", () => {
    thread = threadState({ metaError: new Error("boom") });
    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load this thread");
    act(() => tree.unmount());
  });

  it("reports the channel's transport to the app-wide pill while it is up", () => {
    thread = threadState({ connection: "polling" });
    let seen: unknown;
    function Probe() {
      seen = useOpenChatTransport();
      return null;
    }
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <QueryClientProvider client={queryClient}>
          <FrappThemeProvider>
            <MessageThreadScreen channelId={CHANNEL} rootId={ROOT} />
            <Probe />
          </FrappThemeProvider>
        </QueryClientProvider>,
      );
    });
    expect(seen).toBe("polling");
    act(() => tree.unmount());
  });
});

describe("MessageThreadScreen's full rows (#4297, slice 5)", () => {
  const rowFor = (tree: ReactTestRenderer, id: string) =>
    tree.root
      .findAllByType(ThreadMessageRow)
      .find((node) => node.props.row.message.id === id)!;
  const sheet = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) => (node.type as unknown) === "MessageActionsSheet",
    );

  it("draws the parent and the replies as the timeline's rows, with their reactions", () => {
    thread = threadState({
      root: message(ROOT, {
        content: "Who's driving Saturday?",
        reactions: { "👍": [CASEY] },
        thread: { reply_count: 2, last_reply_at: null, recent_sender_ids: [] },
      }),
    });
    const tree = render();
    const parent = rowFor(tree, ROOT);
    // Its own card would repeat the divider; its reactions stay.
    expect(parent.props.row.message.thread).toBeNull();
    expect(parent.props.row.message.reactions).toEqual({ "👍": [CASEY] });
    expect(rowFor(tree, "r1")).toBeDefined();
    expect(rowFor(tree, "r2")).toBeDefined();
    act(() => tree.unmount());
  });

  it("prefers the channel's copy of the parent, and tells the writes whether it is held", () => {
    const tree = render();
    expect(writesInput).toMatchObject({
      channelId: CHANNEL,
      rootId: ROOT,
      parentHeld: false,
    });
    act(() => tree.unmount());

    heldRoot = message(ROOT, { content: "Who's driving Sunday?" });
    const again = render();
    expect(rowFor(again, ROOT).props.row.message.content).toBe(
      "Who's driving Sunday?",
    );
    expect(writesInput).toMatchObject({ parentHeld: true });
    act(() => again.unmount());
  });

  it("reacts, votes and closes a poll through the thread's writes", async () => {
    const tree = render();
    const reply = rowFor(tree, "r1");
    act(() => reply.props.onReact("r1", "🎉"));
    expect(writes.react).toHaveBeenCalledWith("r1", "🎉");
    act(() => reply.props.onUnreact("r1", "🎉"));
    expect(writes.unreact).toHaveBeenCalledWith("r1", "🎉");
    act(() => reply.props.onVote("r1", "poll_vote", { option: 0 }));
    expect(writes.act).toHaveBeenCalledWith("r1", "poll_vote", { option: 0 });

    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    act(() => reply.props.onClosePoll("r1"));
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    await act(async () =>
      buttons.find((b) => b.style === "destructive")?.onPress?.(),
    );
    expect(writes.closePoll).toHaveBeenCalledWith("r1");
    act(() => tree.unmount());
  });

  it("opens the actions sheet with what web's thread rows offer", () => {
    const tree = render();
    act(() => rowFor(tree, "r2").props.onOpenActions(thread.messages[1]));
    expect(presentSheet).toHaveBeenCalled();
    const target = sheet(tree).props.target;
    expect(target).toMatchObject({
      messageId: "r2",
      canEdit: true,
      canDelete: true,
      canReply: false,
      canStartThread: false,
      canMention: false,
    });
    // Not offered here: the channel timeline's Reply, Start thread, Mention
    // and Important.
    expect(sheet(tree).props.onReply).toBeUndefined();
    expect(sheet(tree).props.onStartThread).toBeUndefined();
    expect(sheet(tree).props.onFlag).toBeUndefined();
    act(() => tree.unmount());
  });

  it("gates Edit as web does: the parent as a post, a reply as a thread reply", () => {
    // A read-only channel: no posting, but thread replies are open to readers.
    channelRow = { ...channelRow, can_post: false, is_read_only: true };
    const mine = message(ROOT, { sender_id: VIEWER, content: "Mine" });
    thread = threadState({
      root: mine,
      messages: [
        message("r2", { thread_root_id: ROOT, sender_id: VIEWER }),
      ],
    });
    const tree = render();
    act(() => rowFor(tree, ROOT).props.onOpenActions(mine));
    expect(sheet(tree).props.target.canEdit).toBe(false);
    act(() =>
      rowFor(tree, "r2").props.onOpenActions(thread.messages[0]),
    );
    expect(sheet(tree).props.target.canEdit).toBe(true);
    act(() => tree.unmount());
  });

  it("edits a reply in the thread's own composer and saves it through the thread", async () => {
    const tree = render();
    const composer = () => tree.root.findByType(ChatComposer);
    act(() => sheet(tree).props.onEdit("r2"));
    expect(composer().props.value).toBe("Me too");
    expect(composer().props.context).toMatchObject({ kind: "edit" });
    act(() => composer().props.onChangeText("Me too, at 6"));
    // An edit isn't typing a reply.
    expect(thread.emitTyping).not.toHaveBeenCalled();
    await act(async () => composer().props.onSend());
    expect(writes.edit).toHaveBeenCalledWith("r2", "Me too, at 6");
    expect(thread.send).not.toHaveBeenCalled();
    expect(composer().props.context).toBeNull();
    act(() => tree.unmount());
  });

  it("deletes after the same confirm the channel asks", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    const tree = render();
    act(() => sheet(tree).props.onDelete("r2"));
    expect(writes.remove).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    await act(async () =>
      buttons.find((b) => b.style === "destructive")?.onPress?.(),
    );
    expect(writes.remove).toHaveBeenCalledWith("r2");
    act(() => tree.unmount());
  });

  it("says why a reaction or a vote didn't land", () => {
    writes.rowError = "This poll is closed";
    const tree = render();
    const composer = tree.root.findByType(ChatComposer);
    expect(composer.props.disabledHint).toBe("This poll is closed");
    expect(composer.props.hintTone).toBe("error");
    act(() => tree.unmount());
  });
});
