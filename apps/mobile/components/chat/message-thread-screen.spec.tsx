/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Alert } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_CATCH_UP_COPY,
  chatCatchUpThreadOfferLine,
} from "@repo/validation";
import type { ChatMessage } from "@repo/chat-core/types";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import { Chip } from "@/components/filter-chips";
import { useOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { ChatComposer } from "@/components/chat/chat-composer";
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
    discard: vi.fn(),
    emitTyping: vi.fn(),
    ...overrides,
  } as ThreadStub;
}

let thread = threadState();
vi.mock("@/lib/chat/use-message-thread", () => ({
  useMessageThread: () => thread,
}));

let channelRow: Record<string, unknown> = {
  id: CHANNEL,
  name: "general",
  type: "PUBLIC",
  can_post: true,
  is_read_only: false,
};
let viewerId: string | null = VIEWER;
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChannel: () => ({ data: channelRow, isFetching: false }),
  useViewerUserId: () => viewerId,
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

/** Catch me up (#3946): the gate, and the sheet's hook, both stood in. */
const catchUp = vi.hoisted(() => ({
  surface: false,
  waiting: false,
  active: false,
  start: vi.fn(),
  resume: vi.fn(),
  drop: vi.fn(),
  options: undefined as
    | { onOpenPoint: (point: unknown) => void }
    | undefined,
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ catchUp: catchUp.surface }),
}));
vi.mock("@/components/chat/catch-up-sheet", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/chat/catch-up-sheet")
  >()),
  useCatchUp: (options: { onOpenPoint: (point: unknown) => void }) => {
    catchUp.options = options;
    return {
      start: catchUp.start,
      waiting: catchUp.waiting,
      active: catchUp.active,
      resume: catchUp.resume,
      drop: catchUp.drop,
      sheets: null,
    };
  },
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
  writeBlockedReason = null;
  queryClient = new QueryClient();
  catchUp.surface = false;
  catchUp.waiting = false;
  catchUp.active = false;
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
    expect(thread.send).toHaveBeenCalledWith("lost", "c-r9");
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

describe("Catch me up on a thread (#3946)", () => {
  const longThread = (replies: number) =>
    threadState({
      root: {
        ...threadState().root!,
        thread: {
          reply_count: replies,
          last_reply_at: null,
          recent_sender_ids: [],
        },
      },
    });
  const byLabel = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === label,
    );
  const strips = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        typeof node.type === "string" && node.props.testID === "catch-up-strip",
    );

  it("offers nothing where the chapter has no summaries", () => {
    thread = longThread(40);
    const tree = render();
    expect(byLabel(tree, CHAT_CATCH_UP_COPY.thread_action)).toHaveLength(0);
    expect(strips(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("offers nothing on a thread too short to shorten", () => {
    catchUp.surface = true;
    const tree = render();
    expect(byLabel(tree, CHAT_CATCH_UP_COPY.thread_action)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("offers nothing in a direct message", () => {
    catchUp.surface = true;
    channelRow = { ...channelRow, type: "DM" };
    thread = longThread(40);
    const tree = render();
    expect(byLabel(tree, CHAT_CATCH_UP_COPY.thread_action)).toHaveLength(0);
    expect(strips(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("summarizes this thread from the reply count's line", () => {
    catchUp.surface = true;
    thread = longThread(8);
    const tree = render();
    // Not long enough for the strip: the divider's action is the way in.
    expect(strips(tree)).toHaveLength(0);
    act(() =>
      byLabel(tree, CHAT_CATCH_UP_COPY.thread_action)[0]!.props.onPress(),
    );
    expect(catchUp.start).toHaveBeenCalledWith({
      kind: "thread",
      channelId: CHANNEL,
      channelName: "general",
      rootId: ROOT,
    });
    act(() => tree.unmount());
  });

  it("offers a long thread's summary under the header, once", () => {
    catchUp.surface = true;
    thread = longThread(34);
    const tree = render();
    expect(screenText(tree)).toContain(chatCatchUpThreadOfferLine(34));
    act(() =>
      byLabel(tree, CHAT_CATCH_UP_COPY.offer_dismiss)[0]!.props.onPress(),
    );
    expect(strips(tree)).toHaveLength(0);
    expect(catchUp.start).not.toHaveBeenCalled();
    // The divider's action is still there for a change of mind.
    expect(byLabel(tree, CHAT_CATCH_UP_COPY.thread_action)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("leads back to a summary left for one of its lines, without asking again", () => {
    catchUp.surface = true;
    catchUp.waiting = true;
    thread = longThread(34);
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain(CHAT_CATCH_UP_COPY.resume_line);
    expect(text).not.toContain(chatCatchUpThreadOfferLine(34));
    act(() =>
      byLabel(
        tree,
        `${CHAT_CATCH_UP_COPY.resume_line} ${CHAT_CATCH_UP_COPY.resume_action}`,
      )[0]!.props.onPress(),
    );
    expect(catchUp.resume).toHaveBeenCalledTimes(1);
    expect(catchUp.start).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
