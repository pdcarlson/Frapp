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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLockedChannels,
  resetLockedChannelsForTests,
  setChannelLocked,
} from "@repo/chat-core/density";

// These screens paint with the chapter accent (`useChapterBranding`), which
// reads the current chapter through the client provider these specs don't
// mount. A purple chapter's values, deliberately not house gold, so a control
// that slips back to a `gold.*` token shows up in an assertion; the hook
// itself has its own spec.
// Chat backgrounds (#3973) read their own query; decoration, not under test here.
vi.mock("@/components/chat/chat-background", () => ({
  ChatBackground: () => null,
}));

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
import { AUDIT_LOG_COMPOSER_NOTE } from "@repo/chat-core/audit-log-copy";
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
import { jumpToLatestLabel } from "@repo/chat-core/jump-to-latest";
import { reactionActionType } from "@repo/chat-core/types";
import type { UseChatChannelResult } from "@/lib/chat/use-chat-channel";
import { FrappThemeProvider } from "@/lib/theme";
import { stackScreen } from "@/test/stack-screen";
import { flatStyle } from "@/test/flat-style";
import { screenText } from "@/test/screen-text";
import { CHANNEL_UNREAD_COUNTS_KEY } from "@repo/hooks";
import {
  CHAT_CATCH_UP_COPY,
  CHAT_CATCH_UP_OFFER_AT,
  chatCatchUpOfferLine,
} from "@repo/validation";
import { ScreenReady } from "@/lib/sentry/screen-ready";
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
// The Important strip (#4186): the hook is the server's answer, driven here.
const importantState = vi.hoisted(() => ({
  total: 0,
  next: null as null | { id: string },
  markSeen: vi.fn(),
  reportVisible: vi.fn(),
  dismiss: vi.fn(),
}));
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

// A message thread (#3785) is the same route with a root; its own spec
// (`components/chat/message-thread-screen.spec.tsx`) draws it.
vi.mock("@/components/chat/message-thread-screen", async () => {
  const { createElement } = await import("react");
  return {
    MessageThreadScreen: (props: Record<string, unknown>) =>
      createElement("MessageThreadScreen", props),
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

const presentSignupSheet = vi.fn();
vi.mock("@/components/chat/new-signup-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    NewSignupSheet: forwardRef(function NewSignupSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentSignupSheet,
        dismiss: vi.fn(),
      }));
      return createElement("NewSignupSheet", props);
    }),
  };
});

const presentFormSheet = vi.fn();
vi.mock("@/components/chat/new-form-sheet", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    NewFormSheet: forwardRef(function NewFormSheet(
      props: Record<string, unknown>,
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: presentFormSheet,
        dismiss: vi.fn(),
      }));
      return createElement("NewFormSheet", props);
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
    sendGif: vi.fn(async () => ({ ok: true as const })),
    sendSignup: vi.fn(async () => ({ ok: true as const })),
    sendForm: vi.fn(async () => ({ ok: true as const })),
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
    closeCard: vi.fn(async () => {}),
    flag: vi.fn(async () => {}),
    setPinned: vi.fn(async () => {}),
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
// The thread cards' new-reply counts have their own spec (use-thread-unread).
vi.mock("@/lib/chat/use-thread-unread", () => ({
  useThreadUnread: () => ({}),
}));

vi.mock("@/lib/chat/use-chat-channel", () => ({
  useChatChannel: () => channel,
}));

let viewerQuery = { isError: false, isFetching: false, refetch: vi.fn() };

/** What `useChannel` hands back: the channel, or no row yet. */
let channelRow: "found" | "reading" | "missing" = "found";
/** The open channel's type, for the member list's 1:1 DM rule (#3536). */
let channelType = "PUBLIC";
/** The single-channel read's Always formal flag and when it was read (#3787). */
let channelLocked = false;
let channelReadAt = 1_000;
/** A read-only channel (announcements) the viewer can only read. */
let channelIsReadOnly = false;
/** The open channel is the chapter's audit log (#3909). */
let channelIsAuditLog = false;
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
  // Only the typing specs read a name: the rest of this file draws rows by id.
  nameFor: (id: string) =>
    ({ [MEMBER]: "Winston Hewitt", "member-4": "Shawn" })[id] ?? null,
  typistLabelFor: (id: string) =>
    ({ [MEMBER]: "Winston Hewitt", "member-4": "Shawn" })[id] ?? null,
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

const NOTIFICATION_PREFS: {
  channel_id: string;
  level: "all" | "mentions" | "off";
  from_chapter_level?: boolean;
}[] = [
  { channel_id: CHANNEL, level: "all" },
  { channel_id: OTHER_CHANNEL, level: "all" },
];
const setNotificationLevel = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  variables: undefined,
};
const markRead = { mutate: vi.fn() };
const markUnread = {
  mutateAsync: vi.fn<(messageId: string) => Promise<unknown>>(async () => ({})),
};
const requestUploadUrl = { mutateAsync: vi.fn() };

const rosterCatchUp = vi.hoisted(() =>
  vi.fn<(typists: readonly string[], rows?: readonly unknown[]) => void>(),
);

/** The viewer's saved message ids; cleared after each test that adds one. */
const SAVED: Set<string> = new Set();
const bookmarkWrites = vi.hoisted(() => ({
  save: { mutateAsync: vi.fn(async () => undefined) },
  unsave: { mutateAsync: vi.fn(async () => undefined) },
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // The roster catch-up has its own spec in `@repo/hooks`.
  useRosterCatchUp: rosterCatchUp,
  // GIFs (#4631): off here, so the + sheet offers no GIF row.
  useGifAvailability: () => ({ available: false, provider: "" }),
  useActiveChapterId: () => "chapter-1",
  // Pinned and Saved (#3723): nothing saved, no pins, writes that succeed.
  useBookmarkedMessageIds: () => SAVED,
  useBookmarkMessage: () => bookmarkWrites.save,
  useUnbookmarkMessage: () => bookmarkWrites.unsave,
  useBookmarks: () => ({ data: [], isPending: false, isError: false }),
  usePinnedMessages: () => ({ data: [], isPending: false, isError: false }),
  useChannel: (id: string) =>
    channelRow === "found"
      ? {
          data: {
            id,
            name: "general",
            type: channelType,
            description: "The whole chapter.",
            can_post: !channelIsAuditLog && !channelIsReadOnly,
            is_read_only: channelIsAuditLog || channelIsReadOnly,
            is_audit_log: channelIsAuditLog,
            display_locked: channelLocked,
          },
          dataUpdatedAt: channelReadAt,
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
  useMarkMessageUnread: () => markUnread,
  useRequestChatUploadUrl: () => requestUploadUrl,
  useChannelNotificationPreferences: () => ({ data: NOTIFICATION_PREFS }),
  useSetChannelNotificationLevel: () => setNotificationLevel,
  useImportantMessages: () => importantState,
  useBlockedUserIds: () => BLOCK_LIST,
  // The viewer reads the message's images through the row's query.
  useMessageAttachments: () => ({ data: [IMAGE] }),
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
    { onOpenPoint: (point: Record<string, unknown>) => void } | undefined,
}));
/** Whether the member has Ask, as the app knows it so far (#4713). */
const askAccess = vi.hoisted(() => ({
  value: "no" as "yes" | "no" | "unknown",
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({
    catchUp: catchUp.surface,
    askAccess: askAccess.value,
  }),
}));
vi.mock("@/components/chat/catch-up-sheet", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/chat/catch-up-sheet")
  >()),
  useCatchUp: (options: {
    onOpenPoint: (point: Record<string, unknown>) => void;
  }) => {
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

/**
 * `@Frapp` from the thread (#4713). What a channel asks with and how a turn
 * reads are `ask-in-channel.spec.tsx`'s; the screen decides when Send asks
 * instead of posting, and where the turns sit. `value` is null for a member
 * without Ask.
 */
const channelAsk = vi.hoisted(() => ({
  value: null as null | {
    busy: boolean;
    send: (question: string, after: string | null) => void;
    turns: { id: string; origin: { after?: string | null; at: string } }[];
    renderTurn: (turn: { id: string }) => unknown;
    sheets: null;
  },
  /** The channel each render asked from. */
  channels: [] as (string | null | undefined)[],
}));
vi.mock("@/components/ask/ask-in-channel", async () => {
  const { createElement } = await import("react");
  return {
    useChannelAsk: (channelId: string | null | undefined) => {
      channelAsk.channels.push(channelId);
      return channelAsk.value;
    },
    useAskTurnsPlacement: (byRow: unknown, renderTurn: unknown) => ({
      byRow,
      renderTurn,
    }),
    AskTurnsUnder: ({
      placement,
      rowKey,
    }: {
      placement: {
        byRow: Map<string, { id: string }[]>;
        renderTurn?: unknown;
      };
      rowKey: string;
    }) =>
      placement.renderTurn
        ? (placement.byRow.get(rowKey) ?? []).map((turn) =>
            createElement("AskChannelTurn", {
              key: turn.id,
              id: turn.id,
              under: rowKey,
            }),
          )
        : null,
  };
});

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ isOffline: false, writeBlockedReason: null }),
}));

vi.mock("@/lib/chat/block-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/block-actions")>()),
  useBlockActions: () => ({ unblock: vi.fn(), reloadMaskedCopies: vi.fn() }),
}));

let params: { channelId?: string; threadRootId?: string } = {
  channelId: CHANNEL,
};
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
  channelIsReadOnly = false;
  channelIsAuditLog = false;
  permissionList = [];
  enabledModules = {};
  chapterUnread = false;
  queryClient = new QueryClient();
  catchUp.surface = false;
  catchUp.waiting = false;
  catchUp.active = false;
  channelAsk.value = null;
  channelAsk.channels = [];
  askAccess.value = "no";
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

// #3909: only Frapp posts in the audit log, so there is no composer there.
describe("chat thread in the audit log", () => {
  it("shows the audit log line in place of the composer", () => {
    channelIsAuditLog = true;
    const tree = render();
    expect(tree.root.findAllByType(ChatComposer)).toHaveLength(0);
    const note = tree.root.findByProps({ testID: "chat-audit-log-note" });
    expect(note.props.children).toBe(AUDIT_LOG_COMPOSER_NOTE);
    act(() => tree.unmount());
  });

  it("keeps the composer in an ordinary channel", () => {
    const tree = render();
    expect(tree.root.findAllByType(ChatComposer)).toHaveLength(1);
    expect(
      tree.root.findAllByProps({ testID: "chat-audit-log-note" }),
    ).toHaveLength(0);
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

  it('marks a level from Settings → Chat messages "(your default)" (#3840)', () => {
    NOTIFICATION_PREFS[0] = {
      channel_id: CHANNEL,
      level: "mentions",
      from_chapter_level: true,
    };
    try {
      const tree = render();
      act(() =>
        byLabel(
          tree,
          "Notifications: only @mentions. Change notification level",
        ).props.onPress(),
      );
      expect(
        byLabel(
          tree,
          "Only @mentions (your default). Notify me when someone addresses me.",
        ),
      ).toBeTruthy();
    } finally {
      NOTIFICATION_PREFS[0] = { channel_id: CHANNEL, level: "all" };
    }
  });

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
  // In a two-person DM "Winston is typing…" would tell the blocker that the
  // member they blocked is writing to them. `visibleTypingUsers` is the rule;
  // this is the screen applying it to what it draws.

  it.each([
    // Named, as Discord does (2026-11-11).
    [[MEMBER], "Winston Hewitt is typing…"],
    [[BLOCKED], null],
    [[MEMBER, BLOCKED], "Winston Hewitt is typing…"],
    // The viewer's other device is not someone else typing.
    [[VIEWER], null],
    [[MEMBER, "member-4"], "Winston Hewitt and Shawn are typing…"],
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

  it("holds back a typist the roster can't name yet, hides the empty slot, and asks for a re-read (#4493)", () => {
    channel = channelState({ typingUsers: ["new-joiner"] });
    const tree = render();

    expect(screenText(tree)).not.toMatch(/typing…/);
    const [slot] = tree.root.findAll(
      (node) => node.props.testID === "typing-line",
    );
    expect(slot?.props.accessibilityElementsHidden).toBe(true);
    const [typists, rows] = rosterCatchUp.mock.lastCall ?? [];
    expect(typists).toEqual(["new-joiner"]);
    expect(rows).toBe(channel.messages);
    act(() => tree.unmount());
  });
});

describe("chat thread typing broadcasts", () => {
  it("announces typing only while the box holds text, never for the clear after a send", () => {
    const emitTyping = vi.fn();
    channel = channelState({ emitTyping });
    const tree = render();
    const composer = () => tree.root.findByType(ChatComposer);
    act(() => composer().props.onChangeText(""));
    act(() => composer().props.onChangeText("   "));
    expect(emitTyping).not.toHaveBeenCalled();
    act(() => composer().props.onChangeText("on my way"));
    expect(emitTyping).toHaveBeenCalledTimes(1);
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
    expect(line.props.children).toBe("Winston Hewitt is typing…");
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
    // The footer of an inverted list is drawn at the top: the edge, then the
    // place for a turn asked of Frapp before the oldest loaded row (#4713),
    // which draws nothing here.
    const footer = list(tree).children.slice(-2) as ReactTestInstance[];
    expect(footer[0]!.type).toBe(ThreadHistoryEdge);
    expect(footer[1]!.props.rowKey).toBe("");
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

  it("marks the channel fully shown for Sentry when the shapes give way, to rows or to a failure (#4342)", () => {
    const ready = (tree: ReactTestRenderer) =>
      tree.root.findByType(ScreenReady).props.ready as boolean;

    channel = channelState({ isLoading: true });
    const loading = render();
    expect(ready(loading)).toBe(false);
    act(() => loading.unmount());

    channel = channelState({});
    const loaded = render();
    expect(skeletons(loaded)).toHaveLength(0);
    expect(ready(loaded)).toBe(true);
    act(() => loaded.unmount());

    channel = channelState({ viewerId: null, loadError: new Error("offline") });
    const failed = render();
    expect(ready(failed)).toBe(true);
    act(() => failed.unmount());

    // Messages from cache before `/users/me` answers: still the skeleton (#2250).
    channel = channelState({ viewerId: null });
    const noViewer = render();
    expect(skeletons(noViewer)).toHaveLength(1);
    expect(ready(noViewer)).toBe(false);
    act(() => noViewer.unmount());

    // `/users/me` failed: its error state is what the member is left with.
    channel = channelState({ viewerId: null });
    viewerQuery = { ...viewerQuery, isError: true };
    const noAccount = render();
    expect(screenText(noAccount)).toContain("Couldn't load your account");
    expect(ready(noAccount)).toBe(true);
    act(() => noAccount.unmount());
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
 * Mark unread (#3723): the sheet's row moves the read cursor back, and the
 * thread stops stamping it for the rest of the visit, or leaving would read
 * the channel straight back. Then it leaves, so the list shows the badge.
 */
describe("chat thread Mark unread", () => {
  beforeEach(() => {
    params = { channelId: CHANNEL };
    markUnread.mutateAsync.mockClear();
    markUnread.mutateAsync.mockImplementation(async () => ({}));
  });

  const openSheetOn = (tree: ReturnType<typeof render>) => {
    const row = rows(tree)[0]!;
    act(() =>
      (row.props.onOpenActions as (message: ChatMessage) => void)(
        (row.props.row as ThreadRow).message,
      ),
    );
    return tree.root.findByType("MessageActionsSheet" as never);
  };

  it("offers Mark unread, moves the cursor, skips the blur's stamp and leaves", async () => {
    const { viewedChannelId } =
      await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
    channel = channelState({ messages: [message("m1")] });
    const tree = render();
    const sheet = openSheetOn(tree);
    expect(sheet.props.target.canMarkUnread).toBe(true);
    const goBack = vi.mocked(vi.mocked(expoRouter.useRouter)().dismissTo);
    goBack.mockClear();

    await act(async () => {
      (sheet.props.onMarkUnread as (id: string) => void)("m1");
      await Promise.resolve();
    });

    expect(markUnread.mutateAsync).toHaveBeenCalledWith("m1");
    // The activity handler no longer re-stamps this channel.
    expect(viewedChannelId()).toBeNull();
    // Leaving runs the focus effect's cleanup, which must not stamp it back.
    // (An unmount, not the global blur: another spec's mounted screen would
    // answer that.)
    markRead.mutate.mockClear();
    act(() => tree.unmount());
    expect(markRead.mutate).not.toHaveBeenCalled();
    // A pushed thread with nothing below goes back to Chat home.
    expect(goBack).toHaveBeenCalled();
  });

  it("reads the channel as usual on the next visit", () => {
    channel = channelState({ messages: [message("m1")] });
    markRead.mutate.mockClear();
    const tree = render();
    expect(markRead.mutate).toHaveBeenCalledWith(CHANNEL);
    act(() => tree.unmount());
  });

  it("says so when it fails, without claiming the channel back for a screen that has gone", async () => {
    const { viewedChannelId } =
      await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    markUnread.mutateAsync.mockImplementation(async () => {
      throw new Error("Couldn't reach the server");
    });
    channel = channelState({ messages: [message("m1")] });
    const tree = render();
    const sheet = openSheetOn(tree);

    await act(async () => {
      (sheet.props.onMarkUnread as (id: string) => void)("m1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(alert).toHaveBeenCalledWith(
      "Couldn't mark unread",
      expect.any(String),
    );
    expect(viewedChannelId()).toBeNull();
    alert.mockRestore();
    act(() => tree.unmount());
  });

  it("holds the channel against the activity handler's stamps until the next visit", async () => {
    const { isChannelHeldUnread } =
      await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
    channel = channelState({ messages: [message("m1")] });
    const tree = render();
    const sheet = openSheetOn(tree);
    act(() => (sheet.props.onMarkUnread as (id: string) => void)("m1"));
    expect(isChannelHeldUnread(CHANNEL)).toBe(true);
    // Back on the same screen: the hold ends and the visit reads as usual.
    markRead.mutate.mockClear();
    act(() => refocus());
    expect(isChannelHeldUnread(CHANNEL)).toBe(false);
    expect(markRead.mutate).toHaveBeenCalledWith(CHANNEL);
    act(() => tree.unmount());
  });

  it("isn't offered on the viewer's own message, which never counts as unread", () => {
    channel = channelState({
      messages: [message("m1", { sender_id: VIEWER })],
    });
    const tree = render();
    expect(openSheetOn(tree).props.target.canMarkUnread).toBe(false);
    act(() => tree.unmount());
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
    // A sign-up sheet and a form need no grant (#3926), so they are always
    // offered.
    expect(rowsOf(tree).map((row) => row.command)).toEqual(["signup", "form"]);
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
      "signup",
      "form",
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
      // It needs no module, so it waits on nothing (#3926).
      { command: "signup", label: "Sign-up sheet", disabledReason: null },
      { command: "form", label: "Form", disabledReason: null },
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

  it("opens the New sign-up sheet from its row and posts through sendSignup (#3926)", async () => {
    presentSignupSheet.mockClear();
    const tree = render();
    const openForm = plusSheet(tree).props.onOpenForm as (c: string) => void;
    act(() => openForm("signup"));
    expect(presentSignupSheet).toHaveBeenCalledTimes(1);
    const onPost = tree.root.findByType("NewSignupSheet" as never).props
      .onPost as (signup: unknown) => Promise<unknown>;
    const signup = { content: "Sober drivers", payload: {} };
    await act(async () => {
      await onPost(signup);
    });
    expect(channel.sendSignup).toHaveBeenCalledWith(signup);
    act(() => tree.unmount());
  });

  it("opens the New form sheet from its row and posts through sendForm (#3926 step 3)", async () => {
    presentFormSheet.mockClear();
    const tree = render();
    const openForm = plusSheet(tree).props.onOpenForm as (c: string) => void;
    act(() => openForm("form"));
    expect(presentFormSheet).toHaveBeenCalledTimes(1);
    const onPost = tree.root.findByType("NewFormSheet" as never).props
      .onPost as (form: unknown) => Promise<unknown>;
    const form = { content: "Formal housing", payload: {} };
    await act(async () => {
      await onPost(form);
    });
    expect(channel.sendForm).toHaveBeenCalledWith(form);
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
    act(() => openForm("hours"));
    const hours = tree.root.findByType("LogHoursSheet" as never);
    act(() =>
      (hours.props.onPosted as (r: unknown) => void)({
        ok: true,
        unconfirmed: true,
        warning: "Check the Service page.",
      }),
    );
    expect(alert).toHaveBeenLastCalledWith(
      "Couldn't confirm the hours",
      "Check the Service page.",
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

describe("chat thread keeps Always formal current (#3787)", () => {
  afterEach(() => {
    channelLocked = false;
    channelReadAt = 1_000;
    resetLockedChannelsForTests();
  });

  it("takes the lock from the channel's own read when no list has loaded", () => {
    channelLocked = true;
    render();
    expect(getLockedChannels().has(CHANNEL)).toBe(true);
  });

  it("never lets an older cached read undo a lock the list brought in", () => {
    queryClient.setQueryData(["channels"], [], { updatedAt: 5_000 });
    setChannelLocked(CHANNEL, true);
    channelLocked = false;
    channelReadAt = 1_000;
    render();
    expect(getLockedChannels().has(CHANNEL)).toBe(true);
  });

  it("applies a read newer than the list", () => {
    queryClient.setQueryData(["channels"], [], { updatedAt: 5_000 });
    setChannelLocked(CHANNEL, true);
    channelLocked = false;
    channelReadAt = 9_000;
    render();
    expect(getLockedChannels().has(CHANNEL)).toBe(false);
  });
});

describe("message threads (#3785)", () => {
  it("draws the thread when the route carries a root, and not the channel", () => {
    params = { channelId: CHANNEL, threadRootId: "m1" };
    const tree = render();
    expect(
      tree.root.findByType("MessageThreadScreen" as never).props,
    ).toMatchObject({ channelId: CHANNEL, rootId: "m1" });
    expect(rows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("pushes a parent's thread over the channel from its chip", () => {
    const tree = render();
    const onOpenThread = rows(tree)[0]!.props.onOpenThread as (
      message: ChatMessage,
    ) => void;
    act(() => onOpenThread(message("m1")));
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: CHANNEL, threadRootId: "m1" },
    });
    act(() => tree.unmount());
  });

  it("offers Start thread on a message with no thread, and hands it the same push", () => {
    const tree = render();
    act(() =>
      (rows(tree)[1]!.props.onOpenActions as (m: ChatMessage) => void)(
        message("m2", {
          created_at: new Date(2026, 8, 28, 17, 1).toISOString(),
        }),
      ),
    );
    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    expect(sheet.props.target).toMatchObject({ canStartThread: true });
    act(() => (sheet.props.onStartThread as (id: string) => void)("m2"));
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: CHANNEL, threadRootId: "m2" },
    });
    act(() => tree.unmount());
  });

  it("starts no second thread on a parent that has one", () => {
    const tree = render();
    act(() =>
      (rows(tree)[0]!.props.onOpenActions as (m: ChatMessage) => void)(
        message("m1", {
          thread: {
            reply_count: 2,
            last_reply_at: null,
            recent_sender_ids: [],
          },
        }),
      ),
    );
    expect(
      tree.root.findByType("MessageActionsSheet" as never).props.target,
    ).toMatchObject({ canStartThread: false });
    act(() => tree.unmount());
  });

  it("offers threads in a read-only channel (the pending-Paul override)", () => {
    channelIsReadOnly = true;
    const tree = render();
    expect(rows(tree)[0]!.props.onOpenThread).toBeTypeOf("function");
    act(() =>
      (rows(tree)[1]!.props.onOpenActions as (m: ChatMessage) => void)(
        message("m2"),
      ),
    );
    expect(
      tree.root.findByType("MessageActionsSheet" as never).props.target,
    ).toMatchObject({ canStartThread: true, canReply: false });
    act(() => tree.unmount());
  });

  it("offers no Start thread in a 1:1 DM", () => {
    channelType = "DM";
    const tree = render();
    act(() =>
      (rows(tree)[1]!.props.onOpenActions as (m: ChatMessage) => void)(
        message("m2"),
      ),
    );
    expect(
      tree.root.findByType("MessageActionsSheet" as never).props.target,
    ).toMatchObject({ canStartThread: false });
    act(() => tree.unmount());
  });

  it("offers no thread in a 1:1 DM or the audit log", () => {
    channelType = "DM";
    const dm = render();
    expect(rows(dm)[0]!.props.onOpenThread).toBeUndefined();
    act(() => dm.unmount());
    channelType = "PUBLIC";
    channelIsAuditLog = true;
    const audit = render();
    expect(rows(audit)[0]!.props.onOpenThread).toBeUndefined();
    act(() => audit.unmount());
  });
});

// Pin and Save (#3723): Pin only for a `channels:manage` holder, both read
// live, and the Pinned and Saved lists open what they list.
describe("chat thread Pin and Save from the actions sheet", () => {
  const openSheetOn = (tree: ReturnType<typeof render>, index = 0) => {
    const row = rows(tree)[index]!;
    act(() =>
      (row.props.onOpenActions as (message: ChatMessage) => void)(
        (row.props.row as ThreadRow).message,
      ),
    );
    return tree.root.findByType("MessageActionsSheet" as never);
  };

  it("offers Pin only to a channels:manage holder, reading the pin live", () => {
    channel = channelState({ messages: [message("m1")] });
    let tree = render();
    expect(openSheetOn(tree).props.target.pin).toBeUndefined();
    act(() => tree.unmount());

    permissionList = ["channels:manage"];
    channel = channelState({ messages: [message("m1", { is_pinned: true })] });
    tree = render();
    expect(openSheetOn(tree).props.target.pin).toEqual({ pinned: true });
    act(() => tree.unmount());
  });

  it("pins through the channel, and says so when the server refuses", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    const setPinned = vi.fn(async () => {
      throw new Error("This channel already has 50 pinned messages.");
    });
    permissionList = ["channels:manage"];
    channel = channelState({ messages: [message("m1")], setPinned });
    const tree = render();
    const sheet = openSheetOn(tree);
    await act(async () => {
      (sheet.props.onSetPinned as (id: string, p: boolean) => void)("m1", true);
      await Promise.resolve();
    });
    expect(setPinned).toHaveBeenCalledWith("m1", true);
    expect(alert).toHaveBeenCalledWith(
      "Couldn't pin message",
      expect.any(String),
    );
    alert.mockRestore();
    act(() => tree.unmount());
  });

  it("reads Save from the viewer's saved messages, and saves or unsaves", () => {
    SAVED.add("m1");
    channel = channelState({ messages: [message("m1"), message("m2")] });
    const tree = render();
    let sheet = openSheetOn(tree, 0);
    const savedTarget = sheet.props.target as {
      messageId: string;
      save: unknown;
    };
    const first = savedTarget.messageId;
    expect(savedTarget.save).toEqual({ saved: SAVED.has(first) });
    act(() =>
      (sheet.props.onSetSaved as (id: string, s: boolean) => void)("m1", false),
    );
    expect(bookmarkWrites.unsave.mutateAsync).toHaveBeenCalledWith("m1");
    sheet = openSheetOn(tree, 1);
    const other = sheet.props.target as { messageId: string; save: unknown };
    expect(other.save).toEqual({ saved: SAVED.has(other.messageId) });
    expect([first, other.messageId].sort()).toEqual(["m1", "m2"]);
    SAVED.clear();
    act(() => tree.unmount());
  });

  it("opens a listed thread reply in its thread, and another channel's message there", () => {
    channel = channelState({ messages: [message("m1")] });
    const tree = render();
    const list = tree.root.find(
      (node) =>
        typeof node.props.onOpen === "function" &&
        typeof node.props.kind === "string",
    );
    const push = vi.mocked(vi.mocked(expoRouter.useRouter)().push);
    push.mockClear();
    act(() =>
      (list.props.onOpen as (t: unknown) => void)({
        channelId: "elsewhere",
        messageId: "r1",
        threadRootId: "root",
      }),
    );
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/chat-thread",
      params: {
        channelId: "elsewhere",
        threadRootId: "root",
        focusMessageId: "r1",
      },
    });
    act(() =>
      (list.props.onOpen as (t: unknown) => void)({
        channelId: "elsewhere",
        messageId: "m9",
        threadRootId: null,
      }),
    );
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "elsewhere", focusMessageId: "m9" },
    });
    act(() => tree.unmount());
  });
});

// The sheet's Flag row (#3921): offered where the viewer may change the
// flag, reading the current flag live, and a refusal said aloud.
describe("chat thread flags from the actions sheet", () => {
  const openSheetOn = (tree: ReturnType<typeof render>, index = 0) => {
    const row = rows(tree)[index]!;
    act(() =>
      (row.props.onOpenActions as (message: ChatMessage) => void)(
        (row.props.row as ThreadRow).message,
      ),
    );
    return tree.root.findByType("MessageActionsSheet" as never);
  };

  it("offers Copy message link as the message's app.frapp.live link (#3723)", () => {
    channel = channelState({ messages: [message("m1")] });
    const tree = render();
    expect(openSheetOn(tree).props.target.link).toBe(
      `https://app.frapp.live/chat?channel=${CHANNEL}&message=m1`,
    );
    act(() => tree.unmount());
  });

  it("offers Flag on an unflagged message and sends the pick", () => {
    const flag = vi.fn(async () => {});
    channel = channelState({ messages: [message("m1")], flag });
    const tree = render();
    const sheet = openSheetOn(tree);

    expect(sheet.props.target.flag).toEqual({ current: null });
    act(() =>
      (sheet.props.onFlag as (id: string, f: string | null) => void)(
        "m1",
        "important",
      ),
    );
    expect(flag).toHaveBeenCalledWith("m1", "important");
    act(() => tree.unmount());
  });

  it("offers no Flag on someone else's flag, unless the viewer is an officer", () => {
    const flagged = message("m1", {
      flag: "important",
      flagged_by: "someone-else",
    });
    channel = channelState({ messages: [flagged] });
    let tree = render();
    expect(openSheetOn(tree).props.target.flag).toBeUndefined();
    act(() => tree.unmount());

    permissionList = ["channels:manage"];
    tree = render();
    expect(openSheetOn(tree).props.target.flag).toEqual({
      current: "important",
    });
    act(() => tree.unmount());
  });

  it("says so when the server refuses the flag", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    const flag = vi.fn(async () => {
      throw new Error("This message’s flag changed just now.");
    });
    channel = channelState({ messages: [message("m1")], flag });
    const tree = render();
    const sheet = openSheetOn(tree);

    await act(async () => {
      (sheet.props.onFlag as (id: string, f: string | null) => void)(
        "m1",
        "funny",
      );
      await Promise.resolve();
    });

    expect(alert).toHaveBeenCalledWith(
      "Couldn't flag message",
      expect.any(String),
    );
    alert.mockRestore();
    act(() => tree.unmount());
  });
});

describe("chat thread Important strip (#4186)", () => {
  afterEach(() => {
    importantState.total = 0;
    importantState.next = null;
    importantState.markSeen.mockClear();
    importantState.dismiss.mockClear();
    importantState.reportVisible.mockClear();
  });

  it("draws no strip while nothing is unseen", () => {
    const tree = render();
    expect(
      tree.root.findAll((node) => node.props.testID === "important-strip"),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("reports the rows on screen, never a tombstone, through one callback", () => {
    const tree = render();
    const [list] = lists(tree);
    const report = list!.props.onViewableItemsChanged;
    expect(list!.props.viewabilityConfig).toEqual({
      itemVisiblePercentThreshold: 50,
    });

    act(() =>
      report({
        viewableItems: [
          { item: { message: { id: "m1" }, visibility: "visible" } },
          { item: { message: { id: "m2" }, visibility: "tombstone" } },
          { item: null },
        ],
      }),
    );
    expect(importantState.reportVisible).toHaveBeenLastCalledWith(["m1"]);

    // FlatList throws when this changes after mount.
    rerender(tree);
    expect(lists(tree)[0]!.props.onViewableItemsChanged).toBe(report);
    act(() => tree.unmount());
  });

  it("shows the count, and Show marks the oldest seen", () => {
    importantState.total = 2;
    importantState.next = { id: "m1" };
    const tree = render();

    act(() =>
      byLabel(tree, "2 important messages. Jump to the oldest").props.onPress(),
    );
    expect(importantState.markSeen).toHaveBeenCalledWith(["m1"]);

    act(() => byLabel(tree, "Dismiss important messages").props.onPress());
    expect(importantState.dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe("Catch me up in a channel (#3946)", () => {
  const strips = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        typeof node.type === "string" && node.props.testID === "catch-up-strip",
    );
  /** What Chat home held when the channel was opened. */
  const arriveWith = (unread: number) =>
    queryClient.setQueryData(CHANNEL_UNREAD_COUNTS_KEY, [
      { channel_id: CHANNEL, unread_count: unread },
    ]);
  const menuActions = (tree: ReactTestRenderer) =>
    tree.root.findByType(NotificationLevelMenu).props.actions as
      { label: string; onPress: () => void }[] | undefined;

  it("offers nothing where the chapter has no summaries", () => {
    arriveWith(60);
    const tree = render();
    expect(strips(tree)).toHaveLength(0);
    openMuteMenu(tree);
    // Only the lists every channel has (#3723), no Catch me up.
    expect(menuActions(tree)?.map((action) => action.label)).toEqual([
      "Pinned messages",
      "Saved messages",
    ]);
    act(() => tree.unmount());
  });

  it("offers nothing in a direct message or the audit log", () => {
    catchUp.surface = true;
    arriveWith(60);
    channelType = "DM";
    const dm = render();
    expect(strips(dm)).toHaveLength(0);
    act(() => dm.unmount());

    channelType = "PUBLIC";
    channelIsAuditLog = true;
    const log = render();
    expect(strips(log)).toHaveLength(0);
    act(() => log.unmount());
  });

  it("offers the summary under the header on a channel opened far behind", () => {
    catchUp.surface = true;
    arriveWith(60);
    const tree = render();
    expect(screenText(tree)).toContain(chatCatchUpOfferLine(60));
    act(() =>
      byLabel(
        tree,
        `${chatCatchUpOfferLine(60)} ${CHAT_CATCH_UP_COPY.offer_action}`,
      ).props.onPress(),
    );
    // The stretch that was new at the door, by its count and that moment:
    // opening the channel already stamped it read.
    expect(catchUp.start).toHaveBeenCalledWith({
      kind: "channel",
      channelId: CHANNEL,
      channelName: "general",
      unread: { count: 60, as_of: expect.any(String) },
    });
    // Asked once: the strip does not come back over the summary.
    expect(strips(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("keeps the strip for a channel far behind, never a few messages", () => {
    catchUp.surface = true;
    arriveWith(CHAT_CATCH_UP_OFFER_AT - 1);
    const tree = render();
    expect(strips(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("takes Dismiss as the answer, and still has the header's row", () => {
    catchUp.surface = true;
    arriveWith(60);
    const tree = render();
    act(() => byLabel(tree, CHAT_CATCH_UP_COPY.offer_dismiss).props.onPress());
    expect(strips(tree)).toHaveLength(0);
    expect(catchUp.start).not.toHaveBeenCalled();

    openMuteMenu(tree);
    const actions = menuActions(tree)!;
    expect(actions.map((action) => action.label)).toEqual([
      CHAT_CATCH_UP_COPY.name,
      "Pinned messages",
      "Saved messages",
    ]);
    act(() => actions[0]!.onPress());
    expect(catchUp.start).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("asks for no unread stretch on a channel opened cold", () => {
    catchUp.surface = true;
    const tree = render();
    expect(strips(tree)).toHaveLength(0);
    openMuteMenu(tree);
    act(() => menuActions(tree)![0]!.onPress());
    expect(catchUp.start).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "channel", unread: null }),
    );
    act(() => tree.unmount());
  });

  it("opens a reply's line in its thread, on that reply", () => {
    catchUp.surface = true;
    const tree = render();
    act(() =>
      catchUp.options!.onOpenPoint({
        message_id: "r9",
        thread_root_id: "m1",
      }),
    );
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: CHANNEL, threadRootId: "m1", focusMessageId: "r9" },
    });
    act(() => tree.unmount());
  });

  it("hands a thread the reply to open on", () => {
    params = {
      channelId: CHANNEL,
      threadRootId: "m1",
      focusMessageId: "r9",
    } as typeof params;
    const tree = render();
    expect(
      tree.root.findByType("MessageThreadScreen" as never).props,
    ).toMatchObject({ rootId: "m1", focusMessageId: "r9" });
    act(() => tree.unmount());
  });

  it("opens a channel on the message it was handed, once (#3926)", () => {
    params = { channelId: CHANNEL, focusMessageId: "m1" } as typeof params;
    const scrollToIndex = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Screen />, {
        createNodeMock: (element) =>
          element.type === "FlatList"
            ? { scrollToOffset: vi.fn(), scrollToIndex }
            : null,
      });
    });
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    rerender(tree);
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("leads back to a summary left for one of its lines", () => {
    catchUp.surface = true;
    catchUp.waiting = true;
    arriveWith(60);
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain(CHAT_CATCH_UP_COPY.resume_line);
    expect(text).not.toContain(chatCatchUpOfferLine(60));
    act(() =>
      byLabel(
        tree,
        `${CHAT_CATCH_UP_COPY.resume_line} ${CHAT_CATCH_UP_COPY.resume_action}`,
      ).props.onPress(),
    );
    expect(catchUp.resume).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

/**
 * #4713: a message that names `@Frapp` is a question for Frapp, from a member
 * with Ask. It is never posted; its answer is drawn in the thread for that
 * member alone.
 */
describe("chat thread asks Frapp instead of posting (#4713)", () => {
  const composer = (tree: ReactTestRenderer) =>
    tree.root.findByType(ChatComposer);
  const typingLine = (tree: ReactTestRenderer) =>
    tree.root
      .find(
        (node) =>
          node.type === ("View" as never) &&
          node.props.testID === "typing-line",
      )
      .findByType("Text" as never).props.children as string;
  const HINT = "Only you will see this question and Frapp's answer.";

  function asking(
    draft: string,
    overrides: Partial<UseChatChannelResult> = {},
    busy = false,
  ) {
    const send = vi.fn();
    channelAsk.value = {
      busy,
      send,
      turns: [],
      renderTurn: () => null,
      sheets: null,
    };
    channel = channelState({ draft, ...overrides });
    return { send, tree: render() };
  }

  it("sends the question to Frapp under the newest message, posts nothing and clears the box", () => {
    const { send, tree } = asking("@Frapp when is formal?");
    act(() => composer(tree).props.onSend());
    expect(send).toHaveBeenCalledWith("when is formal?", "c-m2");
    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.setDraft).toHaveBeenCalledWith("");
    expect(composer(tree).props.disabledHint).toBeNull();
    act(() => tree.unmount());
  });

  it("says above the composer that only the member will see it, in the typing line's place", () => {
    const { tree } = asking("@Frapp when is formal?");
    expect(composer(tree).props.ask).toEqual({ naming: true });
    expect(typingLine(tree)).toBe(HINT);
    act(() => tree.unmount());

    const plain = asking("when is formal?").tree;
    expect(composer(plain).props.ask).toEqual({ naming: false });
    expect(typingLine(plain)).not.toBe(HINT);
    act(() => plain.unmount());
  });

  it("posts the same text as an ordinary message for a member without Ask", () => {
    channel = channelState({ draft: "@Frapp when is formal?" });
    const tree = render();
    expect(composer(tree).props.ask).toBeNull();
    expect(typingLine(tree)).not.toBe(HINT);
    act(() => composer(tree).props.onSend());
    expect(channel.send).toHaveBeenCalledWith(
      "@Frapp when is formal?",
      expect.anything(),
    );
    act(() => tree.unmount());
  });

  it("tells nobody the member is typing while the draft is a question for Frapp", () => {
    const emitTyping = vi.fn();
    const { tree } = asking("", { emitTyping });
    act(() => composer(tree).props.onChangeText("@Frapp when is"));
    expect(emitTyping).not.toHaveBeenCalled();
    act(() => composer(tree).props.onChangeText("see you at formal"));
    expect(emitTyping).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it.each([
    [
      "nothing but the handle",
      "@Frapp",
      {},
      false,
      "Type your question after @Frapp.",
    ],
    [
      "a question over the limit",
      `@Frapp ${"a".repeat(1001)}`,
      {},
      false,
      "That's too long for a question. Keep it under 1,000 characters.",
    ],
    [
      "a second question while the first is being answered",
      "@Frapp and the one after?",
      {},
      true,
      "Frapp is still answering your last question.",
    ],
    [
      "a question with a photo staged",
      "@Frapp what is this?",
      {
        photos: [
          {
            key: "p1",
            previewUri: "file:///a.jpg",
            width: 10,
            height: 10,
            status: "ready",
            attachment: null,
            reason: null,
          },
        ],
      } as unknown as Partial<UseChatChannelResult>,
      false,
      "Frapp can't read attachments. Remove them, or take @Frapp out to post this.",
    ],
  ])(
    "refuses %s, says why above the box, and keeps the member's text",
    (_, draft, overrides, busy, line) => {
      const { send, tree } = asking(draft, overrides, busy);
      act(() => composer(tree).props.onSend());
      expect(send).not.toHaveBeenCalled();
      expect(channel.send).not.toHaveBeenCalled();
      expect(channel.setDraft).not.toHaveBeenCalled();
      expect(composer(tree).props.disabledHint).toBe(line);
      expect(composer(tree).props.hintTone).toBe("error");
      // Changing the text takes the line away.
      act(() => composer(tree).props.onChangeText(`${draft} `));
      expect(composer(tree).props.disabledHint).toBeNull();
      act(() => tree.unmount());
    },
  );

  it("asks from the channel that is open, and from the next one once it is", () => {
    // A stale or wrong id here would draw the answer in another channel.
    const { tree } = asking("");
    expect(channelAsk.channels.at(-1)).toBe(CHANNEL);
    params = { channelId: OTHER_CHANNEL };
    rerender(tree);
    expect(channelAsk.channels.at(-1)).toBe(OTHER_CHANNEL);
    act(() => tree.unmount());
  });

  it("never asks while a message is being edited: Save saves the edit", () => {
    // Send reads the channel's draft, not the edit's text. Without the
    // guard a saved draft naming `@Frapp` would be asked and cleared, and
    // the edit never saved.
    const { send, tree } = asking("@Frapp when is formal?", {
      messages: [message("m1", { sender_id: VIEWER, content: "first" })],
    });
    expect(composer(tree).props.ask).toEqual({ naming: true });
    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    act(() => (sheet.props.onEdit as (id: string) => void)("m1"));
    expect(composer(tree).props.context?.kind).toBe("edit");
    // No Frapp in the `@` list, and no promise the edit will be private.
    expect(composer(tree).props.ask).toBeNull();
    expect(typingLine(tree)).not.toBe(HINT);
    act(() => composer(tree).props.onSend());
    expect(send).not.toHaveBeenCalled();
    expect(channel.setDraft).not.toHaveBeenCalledWith("");
    expect(composer(tree).props.disabledHint).toBeNull();
    act(() => tree.unmount());
  });

  it("drops a staged reply, which was context for a message that is not sent", () => {
    const { send, tree } = asking("@Frapp what did he mean?");
    const sheet = tree.root.findByType("MessageActionsSheet" as never);
    act(() => (sheet.props.onReply as (id: string) => void)("m1"));
    expect(composer(tree).props.context?.kind).toBe("reply");
    act(() => composer(tree).props.onSend());
    expect(send).toHaveBeenCalledWith("what did he mean?", "c-m2");
    // Or the next ordinary message would post as a reply to it.
    expect(composer(tree).props.context ?? null).toBeNull();
    act(() => tree.unmount());
  });

  it("holds the message while it is not yet known whether the member has Ask", () => {
    // Posting it could put a question meant for Frapp in front of the
    // channel, and that can't be taken back.
    askAccess.value = "unknown";
    channel = channelState({ draft: "@Frapp what do I owe?" });
    const tree = render();
    // Nothing is promised: no Frapp row, no "only you" line.
    expect(composer(tree).props.ask).toBeNull();
    expect(typingLine(tree)).not.toBe(HINT);
    act(() => composer(tree).props.onSend());
    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.setDraft).not.toHaveBeenCalled();
    expect(composer(tree).props.disabledHint).toBe(
      "Still checking Ask Frapp. Try again in a moment, or take @Frapp out to post this.",
    );
    expect(composer(tree).props.hintTone).toBe("error");
    // The answer arrives: this member has no Ask. The line is no longer
    // true, so it goes, and the same text posts as ordinary text.
    askAccess.value = "no";
    rerender(tree);
    expect(composer(tree).props.disabledHint).toBeNull();
    act(() => composer(tree).props.onSend());
    expect(channel.send).toHaveBeenCalledWith(
      "@Frapp what do I owe?",
      expect.anything(),
    );
    act(() => tree.unmount());
  });

  it("tells nobody the member is typing a question while Ask is not yet known", () => {
    askAccess.value = "unknown";
    const emitTyping = vi.fn();
    channel = channelState({ draft: "", emitTyping });
    const tree = render();
    act(() => composer(tree).props.onChangeText("@Frapp what do"));
    expect(emitTyping).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("takes a refusal away once what it was about is no longer so", () => {
    // "Still answering" must not sit over the box after the answer landed.
    const { tree } = asking("@Frapp and the one after?", {}, true);
    act(() => composer(tree).props.onSend());
    expect(composer(tree).props.disabledHint).toBe(
      "Frapp is still answering your last question.",
    );
    channelAsk.value = { ...channelAsk.value!, busy: false };
    rerender(tree);
    expect(composer(tree).props.disabledHint).toBeNull();
    act(() => tree.unmount());
  });

  it("draws each turn under the message it was asked under, and adds no row", () => {
    asking("");
    channelAsk.value!.turns = [
      {
        id: "t1",
        origin: {
          after: "c-m1",
          at: new Date(2026, 8, 28, 17, 0, 30).toISOString(),
        },
      },
      {
        id: "t0",
        origin: {
          after: null,
          at: new Date(2026, 8, 28, 16, 0).toISOString(),
        },
      },
    ];
    const tree = render();
    expect(rows(tree)).toHaveLength(2);
    const drawn = tree.root
      .findAllByType("AskChannelTurn" as never)
      .map((node) => [node.props.id, node.props.under]);
    expect(drawn).toContainEqual(["t1", "c-m1"]);
    // Older than every loaded message: above them all.
    expect(drawn).toContainEqual(["t0", ""]);
    expect(drawn).toHaveLength(2);
    // In one view with its message, and that message alone. An inverted
    // list lays a cell's children out bottom-up, so a turn that was the
    // cell's second child would be drawn above the message, not under it.
    let cell = tree.root
      .findAllByType("AskChannelTurn" as never)
      .find((node) => node.props.id === "t1")!.parent;
    while (cell && typeof cell.type !== "string") cell = cell.parent;
    expect(cell?.type).toBe("View");
    expect(
      cell
        ?.findAllByType("ThreadMessageRow" as never)
        .map((node) => node.props.row.message.client_message_id),
    ).toEqual(["c-m1"]);
    act(() => tree.unmount());
  });
});
