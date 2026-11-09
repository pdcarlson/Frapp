/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Alert } from "react-native";
import * as expoRouter from "expo-router";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// These screens paint with the chapter accent (`useChapterBranding`), which
// reads the current chapter through the client provider these specs don't
// mount. A purple chapter's values, deliberately not house gold, so a control
// that slips back to a `gold.*` token shows up in an assertion; the hook
// itself has its own spec.
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
import type { ChatMessage } from "@repo/chat-core/types";
import type { ThreadRow } from "@repo/chat-core/blocks";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ImageViewer } from "@/components/chat/image-viewer";
import {
  NotificationLevelControl,
  NotificationLevelMenu,
} from "@/components/chat/notification-level-control";
import { ChannelStart } from "@/components/chat/channel-start";
import {
  HISTORY_START_COPY,
  ThreadHistoryEdge,
} from "@/components/chat/thread-history-edge";
import { ThreadSkeleton } from "@/components/chat/thread-skeleton";
import { jumpToLatestLabel } from "@/components/chat/jump-to-latest-button";
import { reactionActionType } from "@repo/chat-core/types";
import type { UseChatChannelResult } from "@/lib/chat/use-chat-channel";
import { FrappThemeProvider } from "@/lib/theme";
import { stackScreen } from "@/test/stack-screen";
import { flatStyle } from "@/test/flat-style";
import { screenText } from "@/test/screen-text";
import { useOpenChatTransport } from "@repo/hooks/open-chat-transport";

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
 * It renders `app/(app)/chat-thread.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

vi.mock("react-native", async () => {
  const { reactNativeStub, RenderingFlatList } =
    await import("@/test/react-native-stub");
  return { ...reactNativeStub, FlatList: RenderingFlatList };
});

// The reaction tick. Mocked so a spec can count it: one per tap, never per
// render.
const selectionHaptic = vi.hoisted(() => vi.fn());
/** The actions sheet's `dismiss`, as the screen calls it through its ref. */
const dismissSheet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/haptics", () => ({
  selectionHaptic: () => selectionHaptic(),
  successHaptic: vi.fn(),
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
      useImperativeHandle(ref, () => ({
        present: () => {},
        dismiss: () => dismissSheet(),
      }));
      return createElement("MessageActionsSheet", props);
    }),
  };
});

const presentProfileSheet = vi.fn();
vi.mock("@/components/directory/member-detail-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    MemberDetailSheet: forwardRef(function MemberDetailSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentProfileSheet,
        dismiss: vi.fn(),
      }));
      return createElement("MemberDetailSheet", props);
    }),
  };
});

const presentPollSheet = vi.fn();
const dismissPollSheet = vi.fn();
vi.mock("@/components/chat/new-poll-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    NewPollSheet: forwardRef(function NewPollSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentPollSheet,
        dismiss: dismissPollSheet,
      }));
      return createElement("NewPollSheet", props);
    }),
  };
});

const presentPlusSheet = vi.fn();
vi.mock("@/components/chat/composer-plus-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    ComposerPlusSheet: forwardRef(function ComposerPlusSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentPlusSheet,
        dismiss: vi.fn(),
      }));
      return createElement("ComposerPlusSheet", props);
    }),
  };
});

const presentTaskSheet = vi.fn();
vi.mock("@/components/tasks/new-task-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    NewTaskSheet: forwardRef(function NewTaskSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentTaskSheet,
        dismiss: vi.fn(),
      }));
      return createElement("NewTaskSheet", props);
    }),
  };
});
vi.mock("@/components/events/new-event-sheet", async () => {
  const { createElement, forwardRef } = await import("react");
  return {
    NewEventSheet: forwardRef(function NewEventSheet(
      props: Record<string, unknown>,
    ) {
      return createElement("NewEventSheet", props);
    }),
  };
});
vi.mock("@/components/service-hours/log-hours-sheet", async () => {
  const { createElement, forwardRef } = await import("react");
  return {
    LogHoursSheet: forwardRef(function LogHoursSheet(
      props: Record<string, unknown>,
    ) {
      return createElement("LogHoursSheet", props);
    }),
  };
});

const presentMemberSheet = vi.fn();
const dismissMemberSheet = vi.fn();
vi.mock("@/components/chat/channel-member-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    ChannelMembersButton: (props: Record<string, unknown>) =>
      createElement("ChannelMembersButton", props),
    ChannelMemberSheet: forwardRef(function ChannelMemberSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentMemberSheet,
        dismiss: dismissMemberSheet,
      }));
      return createElement("ChannelMemberSheet", props);
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
    sendInFlight: () => false,
    sendPoll: vi.fn(async () => ({ ok: true as const })),
    postTask: vi.fn(async () => ({ ok: true })),
    postHours: vi.fn(async () => ({ ok: true })),
    trackEventCard: vi.fn(() => ({
      clientMessageId: "c1",
      failed: vi.fn(),
      lost: vi.fn(),
    })),
    edit: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    closePoll: vi.fn(async () => {}),
    react: vi.fn(async () => {}),
    unreact: vi.fn(async () => {}),
    act: vi.fn(async () => {}),
    photos: [],
    addPhotos: vi.fn(),
    removePhoto: vi.fn(),
    retryPhoto: vi.fn(),
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

/** What `useChannel` hands back: the channel, or no row yet. */
let channelRow: "found" | "reading" | "missing" = "found";
/** The open channel's type, for the member list's 1:1 DM rule (#3536). */
let channelType = "PUBLIC";
/** The viewer's permissions, and the chapter's modules, for the + (#3701). */
let permissionList: string[] = [];
let enabledModules: Record<string, boolean> = {};
/** The member view of the chapter hasn't answered yet. */
let chapterUnread = false;

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

/** The chapter roster the composer's `@` offers. */
const MENTION_ROSTER = [{ user_id: "u-paul", display_name: "Paul Carlson" }];
const MENTION_ROLES = [
  { role_id: "r-1", name: "Officers", color: null, mentionable: true },
];

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
  useChannel: (id: string) =>
    channelRow === "found"
      ? {
          data: {
            id,
            name: "general",
            type: channelType,
            description: "The whole chapter.",
            can_post: true,
            is_read_only: false,
          },
          isFetching: false,
        }
      : // No row and no cached list: a blank title while it is read, then the
        // `Thread` fallback (`threadTitleFor`).
        { data: undefined, isFetching: channelRow === "reading" },
  useCurrentUser: () => viewerQuery,
  useMemberDisplayNames: () => ROSTER,
  useChapterRoster: () => ({ data: MENTION_ROSTER }),
  useMentionRoles: () => ({ data: MENTION_ROLES }),
  // No imported authors with avatars in these fixtures.
  useAuthorAvatars: () => ({ data: undefined }),
  usePermissionList: () => permissionList,
  useMyPermissions: () => ({
    data: { permissions: permissionList },
    isError: false,
    fetchStatus: "idle",
  }),
  useCurrentChapter: () =>
    chapterUnread
      ? { data: undefined, fetchStatus: "fetching" }
      : { data: { enabled_modules: enabledModules }, fetchStatus: "idle" },
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

import ChatThreadScreen from "@/app/(app)/chat-thread";

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

/** The message-shaped loading state (components.md §10). */
const skeletons = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ThreadSkeleton);

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
  // The filename is the shown image's accessible name, never drawn text.
  expect(
    tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === "image" &&
        node.props.accessibilityLabel === IMAGE.filename,
    ).length,
  ).toBeGreaterThan(0);
}

/** The last child React renders into `node`, composite or host. */
const lastChild = (node: ReactTestInstance) =>
  node.children[node.children.length - 1] as ReactTestInstance;

beforeEach(() => {
  vi.clearAllMocks();
  channel = channelState();
  viewerQuery = { isError: false, isFetching: false, refetch: vi.fn() };
  params = { channelId: CHANNEL };
  channelRow = "found";
  channelType = "PUBLIC";
  permissionList = [];
  enabledModules = {};
  chapterUnread = false;
  queryClient = new QueryClient();
});

describe("chat thread way back", () => {
  // `spec/ui/mobile/navigation.md` § Going back: ‹ pops the stack, exactly as
  // the edge swipe does, and names what is under the thread.
  it("pops to the screen it was opened from, and names it", () => {
    const { element, navigation } = stackScreen(
      [{ name: "(tabs)" }, { name: "directory" }],
      <Screen />,
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(element);
    });
    act(() => byLabel(tree, "Back to directory").props.onPress());
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(expoRouter.useRouter)().dismissTo).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("goes to Chat home with nothing under it", () => {
    const tree = render();
    act(() => byLabel(tree, "Back to chat").props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().dismissTo).toHaveBeenCalledWith(
      "/",
    );
    act(() => tree.unmount());
  });
});

describe("chat thread identity gate (#2250)", () => {
  // A row decides whose it is by comparing `sender_id` with the viewer, and
  // messages can paint from cache while `/v1/users/me` is still in flight.
  // Drawn then, the member's own messages read as someone else's.

  it("shows the loading state, not rows, while the viewer is unresolved", () => {
    channel = channelState({ viewerId: null });
    const tree = render();

    expect(skeletons(tree)).toHaveLength(1);
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

    expect(skeletons(tree)).toHaveLength(0);
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
    expect(skeletons(tree)).toHaveLength(0);
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
    expect(skeletons(tree)).toHaveLength(0);
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

describe("chat thread typing line holds its place", () => {
  // Mounting and unmounting in flow between the list and the composer moved
  // every row, and the jump control, by a line each time.
  const slot = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("View" as never) && node.props.testID === "typing-line",
    );
  const flat = (style: unknown) =>
    Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<
      string,
      unknown
    >;

  it("reserves the caption's own line whether or not anyone is typing", () => {
    // The reserved height is the caption Text's line box, which React Native
    // scales with the system text size. A fixed height on the slot would not
    // scale, and large text would spill onto the composer or be cut off.
    const caption = (tree: ReactTestRenderer) => {
      const texts = slot(tree).findAllByType("Text" as never);
      expect(texts).toHaveLength(1);
      return texts[0]!;
    };
    const slotStyle = (tree: ReactTestRenderer) => flat(slot(tree).props.style);

    const idle = render();
    for (const key of ["height", "maxHeight", "minHeight"]) {
      expect(slotStyle(idle)).not.toHaveProperty(key);
    }
    const blank = caption(idle);
    // A non-breaking space: one line box, no glyphs, no words.
    expect(blank.props.children).toBe("\u00a0");
    expect(blank.props.numberOfLines).toBe(1);
    expect(blank.props.allowFontScaling).not.toBe(false);
    expect(blank.props.maxFontSizeMultiplier).toBeUndefined();
    const idleTextStyle = flat(blank.props.style);
    act(() => idle.unmount());

    channel = channelState({ typingUsers: [MEMBER] });
    const typing = render();
    for (const key of ["height", "maxHeight", "minHeight"]) {
      expect(slotStyle(typing)).not.toHaveProperty(key);
    }
    const line = caption(typing);
    expect(line.props.children).toBe("Someone is typing…");
    expect(line.props.numberOfLines).toBe(1);
    // Same type and line height as the blank, so the swap moves nothing.
    expect(flat(line.props.style)).toEqual(idleTextStyle);
    act(() => typing.unmount());
  });

  it("hides the empty line from a screen reader, and shows the full one", () => {
    const idle = render();
    expect(slot(idle).props.accessibilityElementsHidden).toBe(true);
    expect(slot(idle).props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    act(() => idle.unmount());

    channel = channelState({ typingUsers: [MEMBER] });
    const typing = render();
    expect(slot(typing).props.accessibilityElementsHidden).toBe(false);
    expect(slot(typing).props.importantForAccessibility).toBe("auto");
    act(() => typing.unmount());
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

describe("chat thread loading state (components.md §10)", () => {
  it("draws message shapes, not a spinner and a sentence", () => {
    channel = channelState({ isLoading: true });
    const tree = render();

    expect(skeletons(tree)).toHaveLength(1);
    expect(tree.root.findAllByType("ActivityIndicator" as never)).toHaveLength(
      0,
    );
    expect(screenText(tree)).not.toMatch(/Loading/);
    expect(lists(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("sits the shapes at the bottom, where an inverted thread's rows land", () => {
    channel = channelState({ isLoading: true });
    const tree = render();

    const container = skeletons(tree)[0]!.find(
      (node) =>
        node.type === ("View" as never) &&
        node.props.accessibilityLabel === "Loading messages",
    );
    expect(container.props.style).toMatchObject({
      flex: 1,
      justifyContent: "flex-end",
    });
    act(() => tree.unmount());
  });

  it("reads aloud as one loading element", () => {
    // A label alone is not enough on iOS: VoiceOver only reads a View that is
    // an accessibility element, and the shapes inside have nothing to read.
    channel = channelState({ isLoading: true });
    const tree = render();

    const container = skeletons(tree)[0]!.find(
      (node) =>
        node.type === ("View" as never) &&
        node.props.accessibilityLabel === "Loading messages",
    );
    expect(container.props.accessible).toBe(true);
    expect(container.props.accessibilityRole).toBe("progressbar");
    act(() => tree.unmount());
  });
});

describe("chat thread list behaviour", () => {
  const list = (tree: ReactTestRenderer) => lists(tree)[0]!;

  it("keeps the reader's place as messages arrive, following them only near the newest", () => {
    const tree = render();
    expect(list(tree).props.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 0,
      autoscrollToTopThreshold: 80,
    });
    act(() => tree.unmount());
  });

  it("lets a tap act with the keyboard up, and a drag put the keyboard away", () => {
    const tree = render();
    expect(list(tree).props.keyboardShouldPersistTaps).toBe("handled");
    expect(list(tree).props.keyboardDismissMode).toBe("on-drag");
    act(() => tree.unmount());
  });
});

describe("chat thread jump to latest", () => {
  const list = (tree: ReactTestRenderer) => lists(tree)[0]!;
  const jumpButtons = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        node.type === ("Pressable" as never) &&
        [jumpToLatestLabel(false), jumpToLatestLabel(true)].includes(
          node.props.accessibilityLabel,
        ),
    );

  function scrollTo(tree: ReactTestRenderer, y: number) {
    act(() =>
      list(tree).props.onScroll({
        nativeEvent: { contentOffset: { x: 0, y } },
      }),
    );
  }

  function renderMeasured(scrollToOffset = vi.fn()) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Screen />, {
        createNodeMock: (element) =>
          element.type === "FlatList"
            ? { scrollToOffset, scrollToIndex: vi.fn() }
            : null,
      });
    });
    act(() =>
      list(tree).props.onLayout({ nativeEvent: { layout: { height: 500 } } }),
    );
    return tree;
  }

  it("appears past a screen of history, and takes the reader back down", () => {
    const scrollToOffset = vi.fn();
    const tree = renderMeasured(scrollToOffset);
    expect(jumpButtons(tree)).toHaveLength(0);

    scrollTo(tree, 1200);
    const [jump] = jumpButtons(tree);
    expect(jump!.props.accessibilityLabel).toBe(jumpToLatestLabel(false));

    act(() => jump!.props.onPress());
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });

    scrollTo(tree, 0);
    expect(jumpButtons(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("says so when a newer message lands while the reader is away", () => {
    const tree = renderMeasured();
    scrollTo(tree, 1200);

    channel = {
      ...channel,
      messages: [
        ...channel.messages,
        message("m3", {
          created_at: new Date(2026, 8, 28, 17, 2).toISOString(),
        }),
      ],
    };
    rerender(tree);

    expect(jumpButtons(tree)[0]!.props.accessibilityLabel).toBe(
      jumpToLatestLabel(true),
    );
    act(() => tree.unmount());
  });

  it("says so when a message lands out of sight just past the follow threshold", () => {
    // Past 80pt the list stops following arrivals, so one that lands while
    // the reader is less than a screen back is still out of sight.
    const tree = renderMeasured();
    scrollTo(tree, 200);
    expect(jumpButtons(tree)).toHaveLength(0);

    channel = {
      ...channel,
      messages: [
        ...channel.messages,
        message("m3", {
          created_at: new Date(2026, 8, 28, 17, 2).toISOString(),
        }),
      ],
    };
    rerender(tree);

    expect(jumpButtons(tree)[0]!.props.accessibilityLabel).toBe(
      jumpToLatestLabel(true),
    );
    act(() => tree.unmount());
  });

  it("opens another channel at its newest message, with no jump control", () => {
    // The screen stays mounted across a switch. A shared list kept the last
    // channel's offset, so a cached channel opened mid-history with no ↓.
    const mounted: object[] = [];
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Screen />, {
        createNodeMock: (element) => {
          if (element.type !== "FlatList") return null;
          const instance = { scrollToOffset: vi.fn(), scrollToIndex: vi.fn() };
          mounted.push(instance);
          return instance;
        },
      });
    });
    act(() =>
      list(tree).props.onLayout({ nativeEvent: { layout: { height: 500 } } }),
    );
    scrollTo(tree, 1200);
    expect(jumpButtons(tree)).toHaveLength(1);
    // Read off the test instance, never `.instance`, which builds a fresh
    // node mock on every read.
    const before = list(tree);
    rerender(tree);
    expect(list(tree)).toBe(before);
    expect(mounted).toHaveLength(1);

    params = { channelId: OTHER_CHANNEL };
    rerender(tree);

    // A new native list, which opens at offset 0: the newest message.
    expect(mounted).toHaveLength(2);
    expect(list(tree)).not.toBe(before);
    expect(jumpButtons(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  /** A send the test settles itself, as a slow POST holds it open. */
  function heldSend() {
    const held: { settle: (queued: boolean) => void } = { settle: () => {} };
    // As the channel hook's: claimed as `send` is called, before it awaits,
    // and released when it settles.
    let inFlight = false;
    const send = vi.fn(() => {
      inFlight = true;
      return new Promise<boolean>((resolve) => {
        held.settle = (queued) => {
          inFlight = false;
          resolve(queued);
        };
      });
    });
    return { send, sendInFlight: () => inFlight, held };
  }

  // Online, `send` settles only once the server has answered, so the jump
  // can't wait for it: it comes on the tap.
  it("takes a member who sends a new message to the bottom on the tap", async () => {
    const { send, held } = heldSend();
    channel = channelState({ draft: "on my way", send });
    const scrollToOffset = vi.fn();
    const tree = renderMeasured(scrollToOffset);
    scrollTo(tree, 1200);

    act(() => tree.root.findByType(ChatComposer).props.onSend());
    expect(send).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(jumpButtons(tree)).toHaveLength(0);

    await act(async () => {
      held.settle(true);
      await Promise.resolve();
    });
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  // The composer greys Send out then; this is the belt to it.
  it("leaves the reader where they are when there is nothing to send", () => {
    const scrollToOffset = vi.fn();
    const tree = renderMeasured(scrollToOffset);
    scrollTo(tree, 1200);

    act(() => tree.root.findByType(ChatComposer).props.onSend());

    expect(channel.send).not.toHaveBeenCalled();
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(jumpButtons(tree)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("does not move the reader again for a second tap while their reply is still on its way", async () => {
    const { send, held } = heldSend();
    channel = channelState({ draft: "same here", send });
    const scrollToOffset = vi.fn();
    const tree = renderMeasured(scrollToOffset);
    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    act(() => (sheet.props.onReply as (id: string) => void)("m1"));
    scrollTo(tree, 1200);

    act(() => {
      // One render: the second tap meets the same staged reply, in flight.
      const composer = tree.root.findByType(ChatComposer);
      composer.props.onSend();
      composer.props.onSend();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.settle(true);
      await Promise.resolve();
    });
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  // `send` refuses a message while an earlier one is out (a slow POST), so a
  // jump then would move the reader with nothing on its way.
  it("leaves the reader where they are for a Send tap while an earlier send is still out", async () => {
    const { send, sendInFlight, held } = heldSend();
    channel = channelState({ draft: "first", send, sendInFlight });
    const scrollToOffset = vi.fn();
    const tree = renderMeasured(scrollToOffset);
    scrollTo(tree, 1200);
    act(() => tree.root.findByType(ChatComposer).props.onSend());
    expect(scrollToOffset).toHaveBeenCalledTimes(1);

    // Back up the thread, with the next message typed, before the POST answers.
    scrollTo(tree, 1200);
    channel = { ...channel, draft: "second" };
    rerender(tree);
    act(() => tree.root.findByType(ChatComposer).props.onSend());
    expect(send).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(jumpButtons(tree)).toHaveLength(1);

    // Once it answers, the next tap sends and jumps.
    await act(async () => {
      held.settle(true);
      await Promise.resolve();
    });
    act(() => tree.root.findByType(ChatComposer).props.onSend());
    expect(send).toHaveBeenCalledTimes(2);
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it("moves the reader once for a double tap on Send", () => {
    const { send, sendInFlight } = heldSend();
    channel = channelState({ draft: "on my way", send, sendInFlight });
    const scrollToOffset = vi.fn();
    const tree = renderMeasured(scrollToOffset);
    scrollTo(tree, 1200);

    act(() => {
      // One render: the second tap reads the same draft.
      const composer = tree.root.findByType(ChatComposer);
      composer.props.onSend();
      composer.props.onSend();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  // The screen stays mounted across channels, so anything still waiting on a
  // send would act on whichever channel is open when it settles.
  it("does not scroll the next channel when a send from the last one settles", async () => {
    const { send, held } = heldSend();
    channel = channelState({ draft: "see you there", send });
    const mounted: { scrollToOffset: ReturnType<typeof vi.fn> }[] = [];
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Screen />, {
        createNodeMock: (element) => {
          if (element.type !== "FlatList") return null;
          const instance = { scrollToOffset: vi.fn(), scrollToIndex: vi.fn() };
          mounted.push(instance);
          return instance;
        },
      });
    });
    const measure = () =>
      act(() =>
        list(tree).props.onLayout({
          nativeEvent: { layout: { height: 500 } },
        }),
      );
    measure();
    scrollTo(tree, 1200);
    act(() => tree.root.findByType(ChatComposer).props.onSend());
    expect(mounted[0]!.scrollToOffset).toHaveBeenCalledTimes(1);

    params = { channelId: OTHER_CHANNEL };
    channel = channelState({ draft: "", send });
    rerender(tree);
    measure();
    scrollTo(tree, 1200);
    expect(jumpButtons(tree)).toHaveLength(1);

    await act(async () => {
      held.settle(true);
      await Promise.resolve();
    });
    expect(mounted[1]!.scrollToOffset).not.toHaveBeenCalled();
    expect(jumpButtons(tree)).toHaveLength(1);
    act(() => tree.unmount());
  });

  // Taken down on the tap, the reader can be back in history before their
  // message is drawn, and so before the server confirms it, which leaves it
  // newest under a key they never saw. It is still their own.
  it("lights no dot for the viewer's own message when it is confirmed", () => {
    const { send } = heldSend();
    channel = channelState({ draft: "running late", send });
    const tree = renderMeasured();
    scrollTo(tree, 200);
    act(() => tree.root.findByType(ChatComposer).props.onSend());
    // Back up the thread before their row is even drawn.
    scrollTo(tree, 200);

    const mine = message("mine", {
      sender_id: VIEWER,
      created_at: new Date(2026, 8, 28, 17, 2).toISOString(),
      _status: "pending",
    });
    channel = { ...channel, messages: [...channel.messages, mine] };
    rerender(tree);
    expect(jumpButtons(tree)).toHaveLength(0);
    channel = {
      ...channel,
      messages: [
        ...channelState().messages,
        // Re-keyed under the server's id, its client key unchanged.
        { ...mine, id: "srv-mine", _status: "confirmed" },
      ],
    };
    rerender(tree);

    expect(jumpButtons(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  // Queued offline, the viewer's message comes back from the server newest,
  // under the same key, after everything backfilled from the outage.
  it("says so when rows are backfilled beneath the viewer's own message", () => {
    const own = message("own", {
      sender_id: VIEWER,
      created_at: new Date(2026, 8, 28, 17, 2).toISOString(),
      _status: "pending",
    });
    channel = channelState({
      messages: [...channelState().messages, own],
    });
    const tree = renderMeasured();
    scrollTo(tree, 200);
    expect(jumpButtons(tree)).toHaveLength(0);

    channel = {
      ...channel,
      messages: [
        ...channelState().messages,
        message("b1", {
          created_at: new Date(2026, 8, 28, 17, 3).toISOString(),
        }),
        message("b2", {
          created_at: new Date(2026, 8, 28, 17, 4).toISOString(),
        }),
        {
          ...own,
          created_at: new Date(2026, 8, 28, 17, 5).toISOString(),
          _status: "confirmed",
        },
      ],
    };
    rerender(tree);

    expect(jumpButtons(tree)[0]!.props.accessibilityLabel).toBe(
      jumpToLatestLabel(true),
    );
    act(() => tree.unmount());
  });

  // The viewer's own message is not news to them, before it is confirmed or
  // after.
  it("lights no dot for the viewer's own unconfirmed message", () => {
    const tree = renderMeasured();
    scrollTo(tree, 200);

    channel = {
      ...channel,
      messages: [
        ...channel.messages,
        message("mine", {
          sender_id: VIEWER,
          created_at: new Date(2026, 8, 28, 17, 2).toISOString(),
          _status: "pending",
        }),
      ],
    };
    rerender(tree);

    expect(jumpButtons(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  // Thread rows the viewer has nothing to read in: a blocked member's message
  // is drawn as a tombstone, and a deleted one as a placeholder.
  it("lights no dot for a message from a member the viewer blocked, or one deleted", () => {
    const tree = renderMeasured();
    scrollTo(tree, 200);

    channel = {
      ...channel,
      messages: [
        ...channel.messages,
        message("b1", {
          sender_id: BLOCKED,
          created_at: new Date(2026, 8, 28, 17, 2).toISOString(),
        }),
        message("d1", {
          is_deleted: true,
          content: "",
          created_at: new Date(2026, 8, 28, 17, 3).toISOString(),
        }),
      ],
    };
    rerender(tree);
    expect(rows(tree)).toHaveLength(4);
    expect(jumpButtons(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("leaves the reader where they are when the send saves an edit", () => {
    channel = channelState({
      messages: [message("m1", { sender_id: VIEWER, content: "first" })],
    });
    const scrollToOffset = vi.fn();
    const tree = renderMeasured(scrollToOffset);
    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    act(() => (sheet.props.onEdit as (id: string) => void)("m1"));
    expect(tree.root.findByType(ChatComposer).props.context?.kind).toBe("edit");

    act(() => tree.root.findByType(ChatComposer).props.onSend());

    expect(scrollToOffset).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("chat thread reactions from the actions sheet", () => {
  it("opens the sheet knowing the viewer's reactions, and wires its picks", () => {
    channel = channelState({
      messages: [
        message("m1", {
          reactions: {
            [reactionActionType("🔥")]: [VIEWER, MEMBER],
            [reactionActionType("👍")]: [MEMBER],
          },
        }),
      ],
    });
    const tree = render();
    const row = rows(tree)[0]!;
    act(() =>
      (row.props.onOpenActions as (message: ChatMessage) => void)(
        (row.props.row as ThreadRow).message,
      ),
    );

    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    expect(sheet.props.target).toMatchObject({
      messageId: "m1",
      reactedWith: ["🔥"],
    });
    act(() =>
      (sheet.props.onReact as (id: string, emoji: string) => void)("m1", "👍"),
    );
    act(() =>
      (sheet.props.onUnreact as (id: string, emoji: string) => void)(
        "m1",
        "🔥",
      ),
    );
    expect(channel.react).toHaveBeenCalledWith("m1", "👍");
    expect(channel.unreact).toHaveBeenCalledWith("m1", "🔥");
    act(() => tree.unmount());
  });

  it("follows the viewer's reactions as they change under the open sheet", () => {
    // A rollback, or the viewer's other device, can change them while the
    // sheet is up; a copy taken at the long-press would draw 🔥 selected and
    // send a second "remove" for a reaction that is already gone.
    channel = channelState({
      messages: [
        message("m1", {
          reactions: { [reactionActionType("🔥")]: [VIEWER] },
        }),
      ],
    });
    const tree = render();
    const row = rows(tree)[0]!;
    act(() =>
      (row.props.onOpenActions as (message: ChatMessage) => void)(
        (row.props.row as ThreadRow).message,
      ),
    );
    const target = () =>
      tree.root.findByType("MessageActionsSheet" as never).props.target;
    expect(target().reactedWith).toEqual(["🔥"]);

    channel = {
      ...channel,
      messages: [
        message("m1", {
          reactions: {
            [reactionActionType("🔥")]: [MEMBER],
            [reactionActionType("👍")]: [VIEWER],
          },
        }),
      ],
    };
    rerender(tree);

    expect(target()).toMatchObject({ messageId: "m1", reactedWith: ["👍"] });
    act(() => tree.unmount());
  });

  it("closes the sheet when its message is deleted while it is open", () => {
    // A deleted message offers no actions; left open, the quick row would
    // write a reaction the thread no longer draws.
    channel = channelState({ messages: [message("m1")] });
    const tree = render();
    const row = rows(tree)[0]!;
    act(() =>
      (row.props.onOpenActions as (message: ChatMessage) => void)(
        (row.props.row as ThreadRow).message,
      ),
    );
    rerender(tree);
    expect(dismissSheet).not.toHaveBeenCalled();

    channel = {
      ...channel,
      messages: [message("m1", { is_deleted: true, content: "" })],
    };
    rerender(tree);

    expect(dismissSheet).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("closes the sheet when its message leaves the cache while it is open", () => {
    // A hard delete, or a re-read that drops the older page it was on: the
    // sheet's actions would act on a message the thread no longer draws.
    channel = channelState({ messages: [message("m1"), message("m2")] });
    const tree = render();
    const row = rows(tree).find(
      (node) => (node.props.row as ThreadRow).message.id === "m1",
    )!;
    act(() =>
      (row.props.onOpenActions as (message: ChatMessage) => void)(
        (row.props.row as ThreadRow).message,
      ),
    );
    rerender(tree);
    expect(dismissSheet).not.toHaveBeenCalled();

    channel = { ...channel, messages: [message("m2")] };
    rerender(tree);

    expect(dismissSheet).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe("chat thread reaction haptic (README § Native-feel rules)", () => {
  it("ticks once per reaction a member adds or takes back, from a chip or the sheet", () => {
    const tree = render();
    const row = rows(tree)[0]!;
    const sheet = () => tree.root.findByType("MessageActionsSheet" as never);
    const call = (fn: unknown, ...args: string[]) =>
      act(() => (fn as (...a: string[]) => void)(...args));

    call(row.props.onReact, "m2", "👍");
    expect(selectionHaptic).toHaveBeenCalledTimes(1);
    expect(channel.react).toHaveBeenCalledTimes(1);
    call(row.props.onUnreact, "m2", "👍");
    expect(selectionHaptic).toHaveBeenCalledTimes(2);
    call(sheet().props.onReact, "m2", "🔥");
    call(sheet().props.onUnreact, "m2", "🔥");
    expect(selectionHaptic).toHaveBeenCalledTimes(4);

    // Not on a render: a rollback lands as new messages, not as a tap.
    channel = { ...channel, messages: [...channel.messages] };
    rerender(tree);
    expect(selectionHaptic).toHaveBeenCalledTimes(4);
    act(() => tree.unmount());
  });
});

describe("chat thread composer placeholder", () => {
  it("names the conversation, as s05 draws it", () => {
    const tree = render();
    expect(tree.root.findByType(ChatComposer).props.placeholder).toBe(
      "Message #general",
    );
    act(() => tree.unmount());
  });

  it.each([
    ["while the channel is read and the title is blank", "reading" as const],
    ["once the title falls back to Thread", "missing" as const],
  ])("says plain Message %s", (_label, row) => {
    channelRow = row;
    const tree = render();
    expect(tree.root.findByType(ChatComposer).props.placeholder).toBe(
      "Message",
    );
    const input = tree.root.find(
      (node) => node.type === ("TextInput" as never),
    );
    expect(input.props.placeholder).toBe("Message");
    expect(input.props.accessibilityLabel).toBe("Message");
    act(() => tree.unmount());
  });
});

describe("chat thread @-mentions", () => {
  it("hands the chapter roster to the composer's picker", () => {
    const tree = render();
    expect(tree.root.findByType(ChatComposer).props.mentionCandidates).toBe(
      MENTION_ROSTER,
    );
    expect(tree.root.findByType(ChatComposer).props.mentionRoles).toBe(
      MENTION_ROLES,
    );
    act(() => tree.unmount());
  });
});

describe("chat thread channel start", () => {
  it("shows the channel's description under its name in the header", () => {
    const tree = render();
    expect(screenText(tree)).toContain("The whole chapter.");
    act(() => tree.unmount());
  });

  it("starts an empty channel with its channel start, in a scrolling slot", () => {
    channel = channelState({ messages: [], hasOlder: false });
    const tree = render();

    const start = tree.root.findByType(ChannelStart);
    expect(start.props).toMatchObject({
      channelName: "general",
      description: "The whole chapter.",
    });
    const slot = start.parent!;
    expect(slot.type).toBe("ScrollView");
    // `flexGrow`, not `flex`: a content container held to the viewport's
    // height can't scroll a start taller than it.
    expect(flatStyle(slot.props.contentContainerStyle)).toMatchObject({
      flexGrow: 1,
      justifyContent: "flex-end",
    });
    expect(flatStyle(slot.props.contentContainerStyle).flex).toBeUndefined();
    act(() => tree.unmount());
  });

  it("draws nothing in an empty channel while its row is still being read", () => {
    channelRow = "reading";
    channel = channelState({ messages: [], hasOlder: false });
    const tree = render();

    expect(tree.root.findAllByType(ChannelStart)).toHaveLength(0);
    expect(screenText(tree)).not.toContain(HISTORY_START_COPY);
    act(() => tree.unmount());
  });

  it("says where the history starts when the channel's row can't be read", () => {
    channelRow = "missing";
    channel = channelState({ messages: [], hasOlder: false });
    const tree = render();

    expect(tree.root.findAllByType(ChannelStart)).toHaveLength(0);
    expect(screenText(tree)).toContain(HISTORY_START_COPY);
    act(() => tree.unmount());
  });

  it("hands the history edge the channel start for the top of a long channel", () => {
    channel = channelState({ hasOlder: false });
    const tree = render();

    const edge = lists(tree)[0]!.findByType(ThreadHistoryEdge);
    expect(edge.props.start).toBeTruthy();
    act(() => tree.unmount());
  });
});

describe("chat thread member profile", () => {
  it("opens the profile sheet for whoever a row names, from a name, photo or @ chip", () => {
    const tree = render();
    const row = rows(tree)[0]!;
    act(() => (row.props.onOpenProfile as (id: string) => void)("user-42"));
    expect(presentProfileSheet).toHaveBeenCalled();
    const sheet = tree.root.findByType("MemberDetailSheet" as never);
    expect(sheet.props.member).toEqual({ userId: "user-42" });
    expect(sheet.props.openChannelId).toBe(CHANNEL);
    // The member list opens the same sheet.
    expect(
      tree.root.findByType("ChannelMemberSheet" as never).props.onOpenProfile,
    ).toBe(row.props.onOpenProfile);
    act(() => tree.unmount());
  });
});

describe("chat thread member list (#3536)", () => {
  const membersButtons = (tree: ReactTestRenderer) =>
    header(tree).findAllByType("ChannelMembersButton" as never);

  it("opens the member sheet from the header, for the open channel", () => {
    const tree = render();

    expect(membersButtons(tree)).toHaveLength(1);
    expect(
      tree.root.findByType("ChannelMemberSheet" as never).props.channelId,
    ).toBe(CHANNEL);
    act(() => membersButtons(tree)[0]!.props.onPress());
    expect(presentMemberSheet).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("offers it on a group DM", () => {
    channelType = "GROUP_DM";
    const tree = render();
    expect(membersButtons(tree)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("offers no list on a 1:1 DM, whose two members are the header", () => {
    channelType = "DM";
    const tree = render();
    expect(membersButtons(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  // The sheet draws through the app's sheet provider, and the screen stays
  // mounted, so it would outlive the channel it lists.
  it("closes the sheet when the screen blurs", () => {
    const tree = render();
    act(() => refocus());
    expect(dismissMemberSheet).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("closes the sheet when the thread switches channel", () => {
    const tree = render();
    dismissMemberSheet.mockClear();
    params = { channelId: OTHER_CHANNEL };
    rerender(tree);
    expect(dismissMemberSheet).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("closes the sheet when the channel turns out to be a 1:1 DM", () => {
    const tree = render();
    dismissMemberSheet.mockClear();
    channelType = "DM";
    rerender(tree);
    expect(membersButtons(tree)).toHaveLength(0);
    expect(dismissMemberSheet).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("offers no list before the channel row is known", () => {
    channelRow = "reading";
    const tree = render();
    expect(membersButtons(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });
});

/*
 * The thread hands its realtime transport to the app-wide connection pill
 * (`connection-state.md` § One indicator), but only while it is focused: this
 * tab screen stays mounted after the member leaves, and a hidden thread's
 * "messages you send go out when you reconnect" must not reach Events or More.
 */
describe("chat thread reports its transport to the connection pill", () => {
  const blur = (expoRouter as unknown as { __blur: () => void }).__blur;
  const seen = vi.fn<(status: string | null) => void>();
  function Reader() {
    seen(useOpenChatTransport());
    return null;
  }
  const reported = () => seen.mock.lastCall?.[0];

  beforeEach(() => {
    channel = channelState({ connection: "polling" });
    params = { channelId: CHANNEL };
  });

  it("reports while focused and clears on blur", () => {
    const tree = render();
    let reader!: ReactTestRenderer;
    act(() => {
      reader = create(<Reader />);
    });
    expect(reported()).toBe("polling");

    act(() => blur());
    expect(reported()).toBeNull();

    act(() => refocus());
    expect(reported()).toBe("polling");

    act(() => {
      tree.unmount();
      reader.unmount();
    });
  });
});

/*
 * The thread says it is the one on screen only while focused (#3698): the
 * activity handler re-stamps the viewed channel read when a message lands in
 * it, and this screen stays mounted under one pushed over it (another thread
 * opened from the member sheet), where nothing it receives has been seen.
 */
describe("chat thread claims the viewed channel while focused (#3698)", () => {
  const blur = (expoRouter as unknown as { __blur: () => void }).__blur;

  beforeEach(() => {
    params = { channelId: CHANNEL };
  });

  it("claims on focus, releases on blur, claims again on refocus", async () => {
    const { viewedChannelId } =
      await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
    const tree = render();
    expect(viewedChannelId()).toBe(CHANNEL);

    act(() => blur());
    expect(viewedChannelId()).toBeNull();

    act(() => refocus());
    expect(viewedChannelId()).toBe(CHANNEL);

    act(() => tree.unmount());
    expect(viewedChannelId()).toBeNull();
  });
});

describe("chat thread + sheet (#3865)", () => {
  const composer = (tree: ReactTestRenderer) =>
    tree.root.findByType(ChatComposer);
  const plusSheet = (tree: ReactTestRenderer) =>
    tree.root.findByType("ComposerPlusSheet" as never);
  const rowsOf = (tree: ReactTestRenderer) =>
    (
      plusSheet(tree).props.model as {
        rows: { command: string; disabledReason: string | null }[];
      }
    ).rows;
  const footerOf = (tree: ReactTestRenderer) =>
    (plusSheet(tree).props.model as { footer: string[] }).footer;

  it("opens the sheet from the + even for a member who can only add photos", () => {
    const tree = render();
    const open = composer(tree).props.onOpenPlus as () => void;
    act(() => open());
    expect(presentPlusSheet).toHaveBeenCalledTimes(1);
    expect(rowsOf(tree)).toEqual([]);
    expect(footerOf(tree)).toEqual([
      "Your role can't create polls, events, tasks or service hours.",
    ]);
    act(() => tree.unmount());
  });

  it("offers each form the role allows, in web's order, and never Points", () => {
    permissionList = ["*"];
    const tree = render();
    expect(rowsOf(tree).map((row) => row.command)).toEqual([
      "poll",
      "event",
      "task",
      "hours",
    ]);
    act(() => tree.unmount());
  });

  it("says when the chapter turned a module off", () => {
    permissionList = ["*"];
    enabledModules = { polls: false };
    const tree = render();
    expect(rowsOf(tree).map((row) => row.command)).not.toContain("poll");
    expect(footerOf(tree)).toEqual([
      "Polls are turned off in this chapter's Settings.",
    ]);
    act(() => tree.unmount());
  });

  it("greys rather than guesses until the chapter's modules are read", () => {
    permissionList = ["polls:create"];
    chapterUnread = true;
    const tree = render();
    expect(rowsOf(tree)).toEqual([
      { command: "poll", label: "Poll", disabledReason: "Still loading" },
    ]);
    act(() => tree.unmount());
  });

  it("greys the forms while a reply is staged: a card can't be a reply", () => {
    permissionList = ["polls:create"];
    const tree = render();
    expect(rowsOf(tree)[0]!.disabledReason).toBeNull();
    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    act(() => (sheet.props.onReply as (id: string) => void)("m1"));
    expect(rowsOf(tree)[0]!.disabledReason).toBe("Not while replying");
    act(() => tree.unmount());
  });

  it("offers no + while editing", () => {
    channel = channelState({
      messages: [message("m1", { sender_id: VIEWER, content: "first" })],
    });
    const tree = render();
    expect(composer(tree).props.onOpenPlus).toBeTypeOf("function");
    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    act(() => (sheet.props.onEdit as (id: string) => void)("m1"));
    expect(composer(tree).props.context?.kind).toBe("edit");
    expect(composer(tree).props.onOpenPlus).toBeUndefined();
    act(() => tree.unmount());
  });

  it("mounts a new poll sheet per channel, so a kept draft never posts elsewhere", () => {
    permissionList = ["polls:create"];
    const tree = render();
    const first = tree.root.findByType("NewPollSheet" as never);
    params = { channelId: OTHER_CHANNEL };
    rerender(tree);
    const second = tree.root.findByType("NewPollSheet" as never);
    expect(second).not.toBe(first);
    act(() => tree.unmount());
  });

  it("posts a poll through the channel's sendPoll, so the card goes through the outbox", async () => {
    permissionList = ["polls:create"];
    const tree = render();
    const onPost = tree.root.findByType("NewPollSheet" as never).props
      .onPost as (poll: unknown) => Promise<unknown>;
    const poll = { content: "Q", payload: {} };
    await act(async () => {
      await onPost(poll);
    });
    expect(channel.sendPoll).toHaveBeenCalledWith(poll);
    act(() => tree.unmount());
  });

  it("opens the Task form on first use, posting into this channel", () => {
    permissionList = ["*"];
    const tree = render();
    expect(tree.root.findAllByType("NewTaskSheet" as never)).toHaveLength(0);
    const openForm = plusSheet(tree).props.onOpenForm as (c: string) => void;
    act(() => openForm("task"));
    const task = tree.root.findByType("NewTaskSheet" as never);
    expect(task.props.postToChannel).toBe(channel.postTask);
    expect(presentTaskSheet).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("opens Event and Service hours posting into this channel", () => {
    permissionList = ["*"];
    const tree = render();
    const openForm = plusSheet(tree).props.onOpenForm as (c: string) => void;
    act(() => openForm("event"));
    act(() => openForm("hours"));
    const event = tree.root.findByType("NewEventSheet" as never);
    expect(event.props.chat).toEqual({
      channelId: CHANNEL,
      trackCard: channel.trackEventCard,
    });
    const hours = tree.root.findByType("LogHoursSheet" as never);
    expect(hours.props.postToChannel).toBe(channel.postHours);
    act(() => tree.unmount());
  });

  it("says what a post carries: a lost task, a poll not saved, an event's missing card", async () => {
    permissionList = ["*"];
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    channel = channelState({
      sendPoll: vi.fn(async () => ({
        ok: true as const,
        warning: "Posted, but not saved on this phone.",
      })),
    });
    const tree = render();
    const openForm = plusSheet(tree).props.onOpenForm as (c: string) => void;
    act(() => openForm("task"));
    act(() => openForm("event"));
    const task = tree.root.findByType("NewTaskSheet" as never);
    act(() =>
      (task.props.onPosted as (r: unknown) => void)({
        ok: true,
        unconfirmed: true,
        warning: "Check the task board.",
      }),
    );
    expect(alert).toHaveBeenLastCalledWith(
      "Couldn't confirm the task",
      "Check the task board.",
    );
    const onPost = tree.root.findByType("NewPollSheet" as never).props
      .onPost as (poll: unknown) => Promise<unknown>;
    await act(async () => {
      await onPost({ content: "Q", payload: {} });
    });
    expect(alert).toHaveBeenLastCalledWith(
      "Poll posted",
      "Posted, but not saved on this phone.",
    );
    const event = tree.root.findByType("NewEventSheet" as never);
    act(() =>
      (event.props.onCreated as (o: unknown) => void)({
        name: "Formal",
        cardKeptOut: false,
        cardLost: true,
      }),
    );
    expect(alert).toHaveBeenLastCalledWith(
      "Event created",
      "Formal is on the calendar, but its card couldn't be posted in chat.",
    );
    alert.mockRestore();
    act(() => tree.unmount());
  });

  it("closes the sheets when the screen blurs", () => {
    permissionList = ["polls:create"];
    const tree = render();
    act(() => refocus());
    expect(dismissPollSheet).toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
