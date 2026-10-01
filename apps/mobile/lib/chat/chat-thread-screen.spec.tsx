/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import * as expoRouter from "expo-router";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import type { ThreadRow } from "@repo/chat-core/blocks";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ImageViewer } from "@/components/chat/image-viewer";
import {
  NotificationLevelControl,
  NotificationLevelMenu,
} from "@/components/chat/notification-level-control";
import { ThreadHistoryEdge } from "@/components/chat/thread-history-edge";
import type { UseChatChannelResult } from "@/lib/chat/use-chat-channel";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * s05, the chat thread, rendered: the wiring its rows, overlays and list rely
 * on, which each component's own spec can't see because the screen decides it.
 *
 * - The identity gate (#2250): no row is drawn until the viewer is known.
 * - The mute menu (#2033) and the image viewer (#2874): where the screen puts
 *   each overlay, what it hides from a screen reader, and when it closes.
 * - The typing indicator through the block list (#2496).
 * - Scrollback (#2772) and each row's run/day placement (§11 § Grouping).
 *
 * The screen reads everything through `useChatChannel` and `@repo/hooks`,
 * which are stubbed here. Their own suites pin what they do.
 *
 * The rows are a stand-in that records its props and the image viewer's
 * opener it finds in context. Their drawing belongs to `thread-message-row`'s
 * and `message-attachments`' specs, and the stand-in is what lets this spec
 * see which viewer and placement the screen hands each one. `FlatList` is
 * `RenderingFlatList`, so the rows render inside the screen's tree, under the
 * provider the screen wraps the list in.
 *
 * It renders `app/(tabs)/chat-thread.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

vi.mock("react-native", async () => {
  const { reactNativeStub, RenderingFlatList } =
    await import("@/test/react-native-stub");
  return { ...reactNativeStub, FlatList: RenderingFlatList };
});

// `getKeyboardPath()` reaches `expo-constants` through `lib/expo-go.ts`. The
// suite leaves that module to each spec; this one runs as Expo Go.
vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "storeClient" },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

vi.mock("@/components/chat/thread-message-row", async () => {
  const { createElement } = await import("react");
  const { useOpenImageViewer } = await import("@/components/chat/image-viewer");
  return {
    ThreadMessageRow: (props: Record<string, unknown>) =>
      createElement("ThreadMessageRow", {
        ...props,
        openImageViewer: useOpenImageViewer(),
      }),
  };
});

vi.mock("@/components/chat/message-actions-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    MessageActionsSheet: forwardRef(function MessageActionsSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({ present: () => {} }));
      return createElement("MessageActionsSheet", props);
    }),
  };
});

const CHANNEL = "chan-1";
const OTHER_CHANNEL = "chan-2";
const VIEWER = "viewer-1";
const MEMBER = "member-2";
const BLOCKED = "blocked-3";

const IMAGE = {
  id: "img-1",
  filename: "formal.jpg",
  content_type: "image/jpeg",
  download_url: "https://storage.test/formal.jpg",
};

function message(
  id: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    client_message_id: `c-${id}`,
    channel_id: CHANNEL,
    sender_id: MEMBER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: id,
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    // Local-time constructors: CI runs this suite in UTC and in Asia/Tokyo.
    created_at: new Date(2026, 8, 28, 17, 0).toISOString(),
    attachment_count: 0,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

function channelState(
  overrides: Partial<UseChatChannelResult> = {},
): UseChatChannelResult {
  return {
    messages: [
      message("m1", { attachment_count: 1 }),
      message("m2", { created_at: new Date(2026, 8, 28, 17, 1).toISOString() }),
    ],
    isLoading: false,
    loadError: null,
    reload: vi.fn(),
    isReloading: false,
    hasOlder: true,
    isLoadingOlder: false,
    olderError: false,
    loadOlder: vi.fn(async () => "loaded" as const),
    viewerId: VIEWER,
    canSend: true,
    send: vi.fn(async () => true),
    edit: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    react: vi.fn(async () => {}),
    unreact: vi.fn(async () => {}),
    act: vi.fn(async () => {}),
    attachments: [],
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    draft: "",
    setDraft: vi.fn(),
    sendError: null,
    reactionError: null,
    clearReactionError: vi.fn(),
    actionError: null,
    clearActionError: vi.fn(),
    typingUsers: [],
    emitTyping: vi.fn(),
    connection: "live",
    retry: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    ...overrides,
  };
}

let channel = channelState();
vi.mock("@/lib/chat/use-chat-channel", () => ({
  useChatChannel: () => channel,
}));

let viewerQuery = { isError: false, isFetching: false, refetch: vi.fn() };

/** A ready list with one member on it, stable across renders as the hook's is. */
const BLOCK_LIST = {
  status: "ready" as const,
  ids: new Set([BLOCKED]),
  unblocked: new Set<string>(),
  retry: () => {},
  isRetrying: false,
  isPaused: false,
};

const ROSTER = {
  byId: {},
  nameFor: () => null,
  avatarFor: () => null,
  isPending: false,
  isError: false,
  refetch: () => {},
};

const NOTIFICATION_PREFS = [
  { channel_id: CHANNEL, level: "all" as const },
  { channel_id: OTHER_CHANNEL, level: "all" as const },
];
const setNotificationLevel = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  variables: undefined,
};
const markRead = { mutate: vi.fn() };
const requestUploadUrl = { mutateAsync: vi.fn() };

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "chapter-1",
  useChannel: (id: string) => ({
    data: { id, name: "general", can_post: true, is_read_only: false },
    isFetching: false,
  }),
  useCurrentUser: () => viewerQuery,
  useMemberDisplayNames: () => ROSTER,
  usePermissionList: () => [],
  useMarkChannelRead: () => markRead,
  useRequestChatUploadUrl: () => requestUploadUrl,
  useChannelNotificationPreferences: () => ({ data: NOTIFICATION_PREFS }),
  useSetChannelNotificationLevel: () => setNotificationLevel,
  useBlockedUserIds: () => BLOCK_LIST,
  // The viewer reads the message's images through the row's query.
  useMessageAttachments: () => ({ data: [IMAGE] }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ isOffline: false, writeBlockedReason: null }),
}));

vi.mock("@/lib/chat/block-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/block-actions")>()),
  useBlockActions: () => ({ unblock: vi.fn(), reloadMaskedCopies: vi.fn() }),
}));

let params: { channelId?: string } = { channelId: CHANNEL };
vi.mocked(expoRouter.useLocalSearchParams).mockImplementation(() => params);

import ChatThreadScreen from "@/app/(tabs)/chat-thread";

const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

let queryClient = new QueryClient();

function Screen() {
  return (
    <QueryClientProvider client={queryClient}>
      <FrappThemeProvider>
        <ChatThreadScreen />
      </FrappThemeProvider>
    </QueryClientProvider>
  );
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Screen />);
  });
  return tree;
}

function rerender(tree: ReactTestRenderer) {
  act(() => tree.update(<Screen />));
}

const rows = (tree: ReactTestRenderer) =>
  tree.root.findAllByType("ThreadMessageRow" as never);

const lists = (tree: ReactTestRenderer) =>
  tree.root.findAllByType("FlatList" as never);

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === label,
  );

/** The container the header, the list and the composer share. */
const threadContainer = (tree: ReactTestRenderer) =>
  byLabel(tree, "Back to chat").parent!.parent!;

const header = (tree: ReactTestRenderer) =>
  byLabel(tree, "Back to chat").parent!;

const muteTrigger = (tree: ReactTestRenderer) =>
  tree.root.findByType(NotificationLevelControl);

const menuOpen = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => node.props.accessibilityRole === "menu").length >
  0;

function openMuteMenu(tree: ReactTestRenderer) {
  act(() =>
    byLabel(
      tree,
      "Notifications: every message. Change notification level",
    ).props.onPress(),
  );
  expect(menuOpen(tree)).toBe(true);
}

const viewerOpen = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === "Close image",
  ).length > 0;

function openImageViewer(tree: ReactTestRenderer, messageId = "m1") {
  const row = rows(tree).find(
    (node) => (node.props.row as ThreadRow).message.id === messageId,
  )!;
  act(() =>
    (row.props.openImageViewer as (target: object) => void)({
      channelId: CHANNEL,
      messageId,
      imageId: IMAGE.id,
    }),
  );
  expect(viewerOpen(tree)).toBe(true);
  expect(screenText(tree)).toContain(IMAGE.filename);
}

/** The last child React renders into `node`, composite or host. */
const lastChild = (node: ReactTestInstance) =>
  node.children[node.children.length - 1] as ReactTestInstance;

beforeEach(() => {
  vi.clearAllMocks();
  channel = channelState();
  viewerQuery = { isError: false, isFetching: false, refetch: vi.fn() };
  params = { channelId: CHANNEL };
  queryClient = new QueryClient();
});

describe("chat thread identity gate (#2250)", () => {
  // A row decides whose it is by comparing `sender_id` with the viewer, and
  // messages can paint from cache while `/v1/users/me` is still in flight.
  // Drawn then, the member's own messages read as someone else's.

  it("shows the loading state, not rows, while the viewer is unresolved", () => {
    channel = channelState({ viewerId: null });
    const tree = render();

    expect(screenText(tree)).toContain("Loading messages…");
    expect(lists(tree)).toHaveLength(0);
    expect(rows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("draws the rows once the viewer lands, each handed that viewer", () => {
    channel = channelState({ viewerId: null });
    const tree = render();
    expect(rows(tree)).toHaveLength(0);

    channel = { ...channel, viewerId: VIEWER };
    rerender(tree);

    expect(screenText(tree)).not.toContain("Loading messages…");
    expect(rows(tree)).toHaveLength(2);
    for (const row of rows(tree)) expect(row.props.viewerId).toBe(VIEWER);
    act(() => tree.unmount());
  });

  it("offers a retry when /v1/users/me failed, rather than spinning", () => {
    // A failed lookup is a null viewer too, so checked after the loading
    // branch it would spin forever with no way out.
    channel = channelState({ viewerId: null });
    viewerQuery = { ...viewerQuery, isError: true };
    const tree = render();

    expect(screenText(tree)).toContain("Couldn't load your account");
    expect(screenText(tree)).not.toContain("Loading messages…");
    expect(rows(tree)).toHaveLength(0);
    act(() => byLabel(tree, "Try again").props.onPress());
    expect(viewerQuery.refetch).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("shows a messages load failure rather than burying it behind the gate", () => {
    // Web's order (#2243): a read that failed while `/users/me` is still in
    // flight, or failed too, says so instead of waiting on identity.
    channel = channelState({ viewerId: null, loadError: new Error("offline") });
    viewerQuery = { ...viewerQuery, isError: true };
    const tree = render();

    expect(screenText(tree)).toContain("Couldn't load messages");
    expect(screenText(tree)).not.toContain("Couldn't load your account");
    expect(screenText(tree)).not.toContain("Loading messages…");
    act(() => byLabel(tree, "Try again").props.onPress());
    expect(channel.reload).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe("chat thread mute menu (#2033)", () => {
  // The menu used to hang off the header as an overflowing absolute child. It
  // drew over the inverted list, but React Native hit-tested the list, so
  // every option tap landed on a thread row and the level never changed.

  it("draws the menu as the last child of the container that holds the list", () => {
    const tree = render();
    openMuteMenu(tree);

    // Nothing may follow it: a later sibling would be above it in hit-testing.
    const container = threadContainer(tree).parent!;
    expect(lastChild(container).type).toBe(NotificationLevelMenu);
    const thread = threadContainer(tree);
    expect(thread.findAllByType("FlatList" as never)).toHaveLength(1);
    expect(thread.findAllByType(ChatComposer)).toHaveLength(1);
    expect(thread.findAllByType(NotificationLevelMenu)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("keeps only the trigger in the header", () => {
    const tree = render();
    openMuteMenu(tree);

    expect(header(tree).findAllByType(NotificationLevelControl)).toHaveLength(
      1,
    );
    expect(header(tree).findAllByType(NotificationLevelMenu)).toHaveLength(0);
    // And no overflow half-measure to paint an absolute child past the header.
    expect(header(tree).props.style).not.toHaveProperty("zIndex");
    expect(header(tree).props.style?.overflow).not.toBe("visible");
    act(() => tree.unmount());
  });

  // The header and the trigger report their frames separately, so a stale
  // header width can sit under a trigger measured past it. The menu then
  // pins to the edge rather than hanging off-screen.
  it.each([
    ["in bounds", 390, 390 - (326 + 44)],
    ["under a stale, narrower header", 360, 0],
  ])(
    "hangs the menu from the measured trigger, not a restated header padding (%s)",
    (_label, headerWidth, right) => {
      const tree = render();
      act(() =>
        header(tree).props.onLayout({
          nativeEvent: {
            layout: { x: 0, y: 12, width: headerWidth, height: 52 },
          },
        }),
      );
      act(() =>
        muteTrigger(tree).props.onLayout({
          nativeEvent: { layout: { x: 326, y: 8, width: 44, height: 44 } },
        }),
      );
      openMuteMenu(tree);

      expect(tree.root.findByType(NotificationLevelMenu).props.anchor).toEqual({
        top: 12 + 52,
        right,
      });
      act(() => tree.unmount());
    },
  );

  it("hides what the menu covers from accessibility while it is open", () => {
    // `accessibilityViewIsModal` is iOS-only; without this TalkBack reaches
    // the thread and the composer under the open menu.
    const tree = render();
    expect(threadContainer(tree).props.accessibilityElementsHidden).toBe(false);
    expect(threadContainer(tree).props.importantForAccessibility).toBe("auto");
    // One native view throughout: flattened, toggling the two props below
    // would re-parent the whole thread under the open menu.
    expect(threadContainer(tree).props.collapsable).toBe(false);

    openMuteMenu(tree);

    expect(threadContainer(tree).props.accessibilityElementsHidden).toBe(true);
    expect(threadContainer(tree).props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    act(() => tree.unmount());
  });

  it("closes the menu when the screen blurs", () => {
    // The screen stays mounted, and the open overlay takes every tap on it.
    const tree = render();
    openMuteMenu(tree);

    act(() => refocus());

    expect(menuOpen(tree)).toBe(false);
    expect(threadContainer(tree).props.accessibilityElementsHidden).toBe(false);
    act(() => tree.unmount());
  });

  it("closes the menu when the thread switches channel", () => {
    const tree = render();
    openMuteMenu(tree);

    params = { channelId: OTHER_CHANNEL };
    rerender(tree);

    expect(menuOpen(tree)).toBe(false);
    act(() => tree.unmount());
  });
});

describe("chat thread image viewer (#2874)", () => {
  // An overlay in the screen's own tree, not a `Modal`
  // (`spec/ui/mobile/patterns.md` § Overlays), so where the screen draws it
  // decides whether it is on top and takes the taps.

  it("gives every row the viewer's opener", () => {
    const tree = render();
    expect(rows(tree)).toHaveLength(2);
    for (const row of rows(tree)) {
      expect(row.props.openImageViewer).toEqual(expect.any(Function));
    }
    act(() => tree.unmount());
  });

  it("draws the viewer as the screen's last child, above the thread and the mute menu", () => {
    const tree = render();
    openImageViewer(tree);

    const screen = tree.root.findByType("SafeAreaView" as never);
    expect(lastChild(screen).type).toBe(ImageViewer);
    // The mute menu is inside the container the viewer paints over.
    expect(
      screen
        .findByType("KeyboardAvoidingView" as never)
        .findAllByType(NotificationLevelMenu),
    ).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("hides everything it covers from accessibility while it is open", () => {
    const tree = render();
    const covered = () => tree.root.findByType("KeyboardAvoidingView" as never);
    expect(covered().props.accessibilityElementsHidden).toBe(false);
    expect(covered().props.importantForAccessibility).toBe("auto");
    // As the mute menu's wrapper: one native view, so the toggle below
    // doesn't re-parent everything under the viewer.
    expect(covered().props.collapsable).toBe(false);

    openImageViewer(tree);

    expect(covered().props.accessibilityElementsHidden).toBe(true);
    expect(covered().props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    act(() => tree.unmount());
  });

  it("closes when the screen blurs, so it can't come back over another thread", () => {
    const tree = render();
    openImageViewer(tree);

    act(() => refocus());

    expect(viewerOpen(tree)).toBe(false);
    act(() => tree.unmount());
  });

  it("closes when the thread switches channel", () => {
    const tree = render();
    openImageViewer(tree);

    params = { channelId: OTHER_CHANNEL };
    rerender(tree);

    expect(viewerOpen(tree)).toBe(false);
    act(() => tree.unmount());
  });

  // The viewer outlives the row that opened it, so the screen closes it when
  // the message stops being drawn in full.
  it.each([
    ["is deleted", (m: ChatMessage) => ({ ...m, is_deleted: true })],
    [
      "is held by the block list",
      (m: ChatMessage) => ({ ...m, sender_id: BLOCKED }),
    ],
    ["leaves the thread", () => null],
  ])("closes when its message %s", (_label, change) => {
    const tree = render();
    openImageViewer(tree, "m1");

    channel = {
      ...channel,
      messages: channel.messages
        .map((m) => (m.id === "m1" ? change(m) : m))
        .filter((m): m is ChatMessage => m !== null),
    };
    rerender(tree);

    expect(viewerOpen(tree)).toBe(false);
    act(() => tree.unmount());
  });

  it("stays open when another message changes", () => {
    const tree = render();
    openImageViewer(tree, "m1");

    channel = {
      ...channel,
      messages: channel.messages.map((m) =>
        m.id === "m2" ? { ...m, is_deleted: true } : m,
      ),
    };
    rerender(tree);

    expect(viewerOpen(tree)).toBe(true);
    act(() => tree.unmount());
  });
});

describe("chat thread typing indicator after the block list (#2496)", () => {
  // In a two-person DM "Someone is typing…" would tell the blocker that the
  // member they blocked is writing to them. `visibleTypingUsers` is the rule;
  // this is the screen applying it to what it draws.

  it.each([
    [[MEMBER], "Someone is typing…"],
    [[BLOCKED], null],
    [[MEMBER, BLOCKED], "Someone is typing…"],
    // The viewer's other device is not someone else typing.
    [[VIEWER], null],
    [[MEMBER, "member-4"], "2 people are typing…"],
  ])("with %j typing, shows %j", (typingUsers, shown) => {
    channel = channelState({ typingUsers });
    const tree = render();

    const text = screenText(tree);
    if (shown) {
      expect(text).toContain(shown);
    } else {
      expect(text).not.toMatch(/typing…/);
    }
    act(() => tree.unmount());
  });
});

describe("chat thread scrollback (#2772)", () => {
  // The list is inverted, so its end is the top: reaching it asks for the
  // next older page, which lands past the rows on screen.

  const list = (tree: ReactTestRenderer) => lists(tree)[0]!;

  it("loads an older page when the inverted list reaches its end, the top", () => {
    const tree = render();
    expect(list(tree).props.inverted).toBe(true);

    act(() => list(tree).props.onEndReached());

    expect(channel.loadOlder).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it.each([
    ["nothing older exists", { hasOlder: false }],
    ["a read is already pending", { isLoadingOlder: true }],
    // A failed read waits for Retry rather than re-firing on every scroll.
    ["the last read failed", { olderError: true }],
  ])("asks for nothing when %s", (_label, state) => {
    channel = channelState(state);
    const tree = render();

    act(() => list(tree).props.onEndReached());

    expect(channel.loadOlder).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("draws the history edge above the oldest row, and its Retry reads again", () => {
    channel = channelState({ olderError: true });
    const tree = render();

    const edge = list(tree).findByType(ThreadHistoryEdge);
    expect(edge.props).toMatchObject({
      hasOlder: true,
      isLoadingOlder: false,
      olderError: true,
    });
    // The footer of an inverted list is drawn at the top.
    expect(lastChild(list(tree)).type).toBe(ThreadHistoryEdge);
    act(() => byLabel(tree, "Retry loading earlier messages").props.onPress());
    expect(channel.loadOlder).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe("chat thread row placement (components.md §11 § Grouping)", () => {
  it("hands each row its own placement, grouped oldest first", () => {
    channel = channelState({
      messages: [
        message("a", {
          created_at: new Date(2026, 8, 28, 23, 58).toISOString(),
        }),
        message("b", {
          created_at: new Date(2026, 8, 28, 23, 59).toISOString(),
        }),
        message("c", { created_at: new Date(2026, 8, 29, 0, 1).toISOString() }),
      ],
    });
    const tree = render();

    const placement = Object.fromEntries(
      rows(tree).map((row) => [
        (row.props.row as ThreadRow).message.id,
        { startsRun: row.props.startsRun, startsDay: row.props.startsDay },
      ]),
    );
    // Newest first on screen, but "a" opens the first day and "c" the next:
    // grouped over the inverted list instead, the divider would land on "a".
    expect(
      rows(tree).map((row) => (row.props.row as ThreadRow).message.id),
    ).toEqual(["c", "b", "a"]);
    expect(placement).toEqual({
      a: { startsRun: true, startsDay: true },
      b: { startsRun: false, startsDay: false },
      c: { startsRun: true, startsDay: true },
    });
    act(() => tree.unmount());
  });
});

describe("chat thread frame (#2485)", () => {
  it("takes the top safe-area inset itself, since no navigator header does", () => {
    // The `‹ #name` bar is the top of the screen now, so without this it would
    // sit under the status bar and notch. `findByType` stops at the screen's
    // own SafeAreaView; it doesn't descend into the image viewer's.
    const tree = render();
    const frame = tree.root.findByType("SafeAreaView" as never);

    expect(frame.props.edges).toContain("top");
    act(() => tree.unmount());
  });
});
