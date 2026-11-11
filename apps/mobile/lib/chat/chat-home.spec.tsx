/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { Alert } from "react-native";
import * as expoRouter from "expo-router";
import { useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectRoundedRipple } from "@/test/pressable-row";
import { PressableRow } from "@/components/list-section";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  drawnText as screenTextOf,
  screenText,
  textHeadings,
} from "@/test/screen-text";

/**
 * #2303 — the chat home's wiring of Hide conversation, rendered for real.
 *
 * The pieces each have their own spec (`listedChannels`, `ChannelRow`'s hide
 * affordance, the prompt), but none of those notices the screen dropping the
 * filter or offering Hide on the wrong row. This does. It lives here, not
 * beside the screen, because a spec under `app/` ships in the bundle
 * (`lib/routes.spec.ts`).
 */

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

const {
  channelsData,
  categoriesData,
  unreadData,
  levelsData,
  latestData,
  sidebarPrefs,
  leaveMutateAsync,
  reopenMutate,
  setPinned,
  setCollapsed,
  setFilter,
  writeOptions,
  queryErrors,
  notificationsData,
  channelsState,
  chapterScope,
  refetches,
  setupChecklist,
  setupChecklistOptions,
  permissionList,
  markReadMutate,
  setLevelMutate,
  setDisplayLock,
  deleteMutateAsync,
  connection,
  latestCalls,
  setChannelBackground,
  requestBackgroundPhotoUrl,
} = vi.hoisted(() => ({
  setDisplayLock: vi.fn(),
  setChannelBackground: vi.fn(),
  requestBackgroundPhotoUrl: vi.fn(),
  latestCalls: vi.fn(),
  permissionList: { value: [] as string[] },
  markReadMutate: vi.fn(),
  setLevelMutate: vi.fn(),
  deleteMutateAsync: vi.fn(),
  connection: { writeBlockedReason: null as string | null },
  // The officer setup checklist's state (#3535's hook), null for a member.
  setupChecklist: { value: null as unknown },
  setupChecklistOptions: { value: undefined as unknown },
  channelsData: { value: [] as unknown[] },
  categoriesData: { value: [] as unknown },
  unreadData: {
    value: [] as {
      channel_id: string;
      unread_count: number;
      mention_count: number;
    }[],
  },
  levelsData: {
    value: [] as {
      channel_id: string;
      level: string;
      from_chapter_level?: boolean;
    }[],
  },
  // `GET /v1/channels/latest` (2026-11-06): each channel's latest message.
  latestData: {
    answered: true,
    value: [] as {
      channel_id: string;
      message_id: string;
      sender_id: string | null;
      author_name: string | null;
      content: string;
      kind: string;
      payload: Record<string, unknown> | null;
      attachment_count: number;
      created_at: string;
    }[],
  },
  sidebarPrefs: {
    value: {
      pinnedIds: new Set<string>(),
      collapsed: new Set<string>(),
      filters: { unreadOnly: false, hideMuted: false },
    },
  },
  leaveMutateAsync: vi.fn(),
  reopenMutate: vi.fn(),
  setPinned: vi.fn(),
  setCollapsed: vi.fn(),
  setFilter: vi.fn(),
  // What s04 hands each write hook, so a failure's report is observable.
  writeOptions: {
    pin: undefined as { onError?: () => void } | undefined,
    fold: undefined as { onError?: () => void } | undefined,
    filter: undefined as { onError?: () => void } | undefined,
  },
  // Loaded-but-failed state for the two reads the filters depend on.
  queryErrors: { unread: false, levels: false },
  // The inbox rows behind the title row's bell (#3362).
  notificationsData: {
    value: [] as { id: string; read_at: string | null; data?: unknown }[],
  },
  // `useChapterScope` (#4094): `none` is a member the server can't scope
  // chat for, whose channel read never goes out.
  chapterScope: { value: "chapter" as "chapter" | "none" | "resolving" },
  // The channel list's own read state, for the loading and error branches.
  channelsState: {
    value: {
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as {
      isPending: boolean;
      isError: boolean;
      isFetching: boolean;
      isSuccess?: boolean;
      error?: unknown;
      refetch: ReturnType<typeof vi.fn>;
    },
  },
  // Each read's refetch but the channels' (in `channelsState`), so a pull is
  // observable (#3385).
  refetches: {
    setup: vi.fn(),
    categories: vi.fn(),
    unread: vi.fn(),
    events: vi.fn(),
    tasks: vi.fn(),
    levels: vi.fn(),
    sidebar: vi.fn(),
    roster: vi.fn(),
    viewer: vi.fn(),
    inbox: vi.fn(),
    latest: vi.fn(),
  },
}));

// The member's own status (#3845) has its own spec
// (`components/chat/home-header.spec.tsx`); here it is simply unknown.
vi.mock("@/lib/account/own-status", () => ({
  useOwnStatus: () => null,
  useOwnStatusSync: () => undefined,
  useSaveOwnStatus: () => ({ save: vi.fn(), isSaving: false }),
}));

vi.mock("@repo/hooks", async () => {
  // The pure helpers run for real: the point is to catch the screen using
  // them wrongly, and a stub would decide the answer itself.
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  const query = (data: unknown, refetch = vi.fn()) => ({
    data,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch,
  });
  return {
    canHideConversation: actual.canHideConversation,
    canSetChannelDisplayLock: actual.canSetChannelDisplayLock,
    useSetChannelDisplayLock: () => ({ mutateAsync: setDisplayLock }),
    // Chat backgrounds (#4031): the rule runs for real; the reads and writes
    // are the menu's own, stubbed quiet.
    canSetChannelBackground: actual.canSetChannelBackground,
    useSetChannelBackground: () => ({ mutateAsync: setChannelBackground }),
    useRequestChatBackgroundPhotoUrl: () => ({
      mutateAsync: requestBackgroundPhotoUrl,
    }),
    useChatBackground: () => query(undefined),
    useChapterChatBackground: () => query(undefined),
    lastChannelLandingId: actual.lastChannelLandingId,
    lastChannelStorageKey: actual.lastChannelStorageKey,
    useActiveChapterId: () => "chapter-1",
    groupChannelsByCategory: actual.groupChannelsByCategory,
    otherMemberId: actual.otherMemberId,
    directChannelDisplayName: actual.directChannelDisplayName,
    HIDDEN_CONVERSATIONS_LABEL: actual.HIDDEN_CONVERSATIONS_LABEL,
    HIDE_CONVERSATION_CONFIRM_ACTION: actual.HIDE_CONVERSATION_CONFIRM_ACTION,
    HIDE_CONVERSATION_CONFIRM_BODY: actual.HIDE_CONVERSATION_CONFIRM_BODY,
    HIDE_CONVERSATION_FAILED_BODY: actual.HIDE_CONVERSATION_FAILED_BODY,
    HIDE_CONVERSATION_FAILED_TITLE: actual.HIDE_CONVERSATION_FAILED_TITLE,
    HIDE_CONVERSATION_LABEL: actual.HIDE_CONVERSATION_LABEL,
    hideConversationConfirmTitle: actual.hideConversationConfirmTitle,
    // #2877: the shared arrangement runs for real; only its data is stubbed.
    arrangeChannelSidebar: actual.arrangeChannelSidebar,
    sidebarSections: actual.sidebarSections,
    countsAddressMember: actual.countsAddressMember,
    foldedSectionAnnouncement: actual.foldedSectionAnnouncement,
    sidebarMutedChannelIds: actual.sidebarMutedChannelIds,
    sidebarUnreadCounts: actual.sidebarUnreadCounts,
    HIDE_MUTED_LABEL: actual.HIDE_MUTED_LABEL,
    NO_MATCHING_CHANNELS: actual.NO_MATCHING_CHANNELS,
    PIN_TO_TOP_LABEL: actual.PIN_TO_TOP_LABEL,
    SHOW_ALL_CHANNELS_LABEL: actual.SHOW_ALL_CHANNELS_LABEL,
    SIDEBAR_SAVE_FAILED_BODY: actual.SIDEBAR_SAVE_FAILED_BODY,
    SIDEBAR_SAVE_FAILED_TITLE: actual.SIDEBAR_SAVE_FAILED_TITLE,
    UNPIN_FROM_TOP_LABEL: actual.UNPIN_FROM_TOP_LABEL,
    UNREAD_ONLY_LABEL: actual.UNREAD_ONLY_LABEL,
    useChapterRoster: () => query([], refetches.roster),
    useSidebarPreferencesRefetch: () => ({ refetch: refetches.sidebar }),
    useSidebarPreferences: () => sidebarPrefs.value,
    useSetChannelPinned: (options?: { onError?: () => void }) => {
      writeOptions.pin = options;
      return { mutate: setPinned };
    },
    useSetSidebarSectionCollapsed: (options?: { onError?: () => void }) => {
      writeOptions.fold = options;
      return { mutate: setCollapsed };
    },
    useSetSidebarFilter: (options?: { onError?: () => void }) => {
      writeOptions.filter = options;
      return { mutate: setFilter };
    },
    useChannelNotificationPreferences: () => ({
      ...query(levelsData.value, refetches.levels),
      isError: queryErrors.levels,
    }),
    useNowDate: () => new Date("2026-09-25T18:00:00Z"),
    useChapterScope: () => chapterScope.value,
    useChannels: () => ({
      ...query(channelsData.value),
      ...channelsState.value,
    }),
    useCategories: () => query(categoriesData.value, refetches.categories),
    useChannelUnreadCounts: () => ({
      ...query(unreadData.value, refetches.unread),
      isError: queryErrors.unread,
      // As TanStack reports it: 0 until a read has answered.
      dataUpdatedAt: unreadData.value === undefined ? 0 : 1,
    }),
    useChapterSetupChecklist: (options?: { omit?: readonly string[] }) => {
      setupChecklistOptions.value = options;
      return {
        checklist: setupChecklist.value,
        hide: vi.fn(),
        refetch: refetches.setup,
      };
    },
    HIDE_SETUP_CHECKLIST_LABEL: actual.HIDE_SETUP_CHECKLIST_LABEL,
    SETUP_CHECKLIST_TITLE: actual.SETUP_CHECKLIST_TITLE,
    SETUP_CHECKLIST_WEB_PATH: actual.SETUP_CHECKLIST_WEB_PATH,
    useEvents: () => query([], refetches.events),
    useNotifications: () => query(notificationsData.value, refetches.inbox),
    useCurrentUser: () => query({ id: VIEWER }, refetches.viewer),
    useTasks: () => query([], refetches.tasks),
    useViewerUserId: () => VIEWER,
    useOwnAvatarTint: () => null,
    useMemberDisplayNames: () => ({
      avatarTintFor: () => null,
      byId: { [ALICE]: "Alice Chen", [BOB]: "Bob Diaz" },
      nameFor: (id: string) =>
        ({ [ALICE]: "Alice Chen", [BOB]: "Bob Diaz" })[id] ?? null,
    }),
    resolveAuthorLabel: actual.resolveAuthorLabel,
    resolveAuthorName: actual.resolveAuthorName,
    FILTER_CHANNELS_LABEL: actual.FILTER_CHANNELS_LABEL,
    FILTER_CHANNELS_ON_LABEL: actual.FILTER_CHANNELS_ON_LABEL,
    useChannelLatestMessages: () => {
      latestCalls();
      return {
        ...query(latestData.value, refetches.latest),
        isSuccess: latestData.answered,
      };
    },
    useLeaveChannel: () => ({ mutateAsync: leaveMutateAsync }),
    useGetOrCreateDm: () => ({ mutate: reopenMutate }),
    // The row menu (owner, 2026-11-06): its rule runs for real.
    channelRowActions: actual.channelRowActions,
    deleteChannelConfirmTitle: actual.deleteChannelConfirmTitle,
    DELETE_CHANNEL_CONFIRM_BODY: actual.DELETE_CHANNEL_CONFIRM_BODY,
    DELETE_CHANNEL_LABEL: actual.DELETE_CHANNEL_LABEL,
    MARK_AS_READ_LABEL: actual.MARK_AS_READ_LABEL,
    CHANNEL_NOTIFICATIONS_LABEL: actual.CHANNEL_NOTIFICATIONS_LABEL,
    CHANNEL_LEVEL_DETAIL: actual.CHANNEL_LEVEL_DETAIL,
    usePermissionList: () => permissionList.value,
    useMarkChannelRead: () => ({ mutate: markReadMutate }),
    useSetChannelNotificationLevel: () => ({ mutateAsync: setLevelMutate }),
    useDeleteChannel: () => ({ mutateAsync: deleteMutateAsync }),
  };
});

const branding = vi.hoisted(() => {
  const unnamed = {
    accent: "#F4CB63",
    accentPrimary: "#EFB63B",
    accentOnPrimary: "#131211",
    accentSubtle: "#3A2F14",
    accentBorder: "#6E5523",
    logoUrl: null as string | null,
    chapterName: null as string | null,
    textMark: null as string | null,
  };
  return { unnamed, current: { ...unnamed } };
});

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: connection.writeBlockedReason }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => branding.current,
}));

import ChatHomeScreen from "@/app/(app)/(tabs)/index";
import * as Sentry from "@sentry/react-native";
import { resetChannelsRefusedReport } from "@/lib/chat/channels-error";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  resetChatLaunchForTests,
  settleChatLaunch,
} from "@/lib/chat/last-channel";
import { ChannelListSkeleton, ChannelRow } from "@/components/chat/channel-row";
import { ChannelFilterMenu } from "@/components/chat/channel-filter-menu";
import { Toggle } from "@/components/toggle";
import { SetupChecklistView } from "@/components/chat/setup-checklist";
import { UpNextStrip } from "@/components/chat/up-next-strip";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { ScreenShell, StickyHeader } from "@/components/screen-shell";
import { ErrorState, NoChapterState } from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";
import { ScreenReady } from "@/lib/sentry/screen-ready";

const general = { id: "c-general", name: "general", type: "PUBLIC" };
const dmAlice = {
  id: "c-dm-alice",
  name: `dm-${VIEWER}-${ALICE}`,
  type: "DM",
  member_ids: [VIEWER, ALICE],
};
const dmBobHidden = {
  id: "c-dm-bob",
  name: `dm-${VIEWER}-${BOB}`,
  type: "DM",
  member_ids: [VIEWER, BOB],
  hidden: true,
};
const group = {
  id: "c-group",
  name: "Exec board",
  type: "GROUP_DM",
  member_ids: [VIEWER, ALICE, BOB],
};

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChatHomeScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function rows(tree: ReactTestRenderer) {
  return tree.root.findAllByType(ChannelRow);
}

function rowNamed(tree: ReactTestRenderer, name: string) {
  const row = rows(tree).find((node) => node.props.name === name);
  if (!row) throw new Error(`no row named ${name}`);
  return row;
}

function pressableLabelled(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );
}

beforeEach(() => {
  // No launch jump unless a test asks for one: chat home holds its list
  // behind the skeleton while one may still happen.
  settleChatLaunch();
  vi.clearAllMocks();
  chapterScope.value = "chapter";
  latestData.value = [];
  latestData.answered = true;
  setupChecklist.value = null;
  channelsData.value = [general, dmAlice, dmBobHidden, group];
  categoriesData.value = [];
  unreadData.value = [];
  levelsData.value = [];
  connection.writeBlockedReason = null;
  notificationsData.value = [];
  queryErrors.unread = false;
  queryErrors.levels = false;
  permissionList.value = [];
  channelsState.value = {
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  sidebarPrefs.value = {
    pinnedIds: new Set(),
    collapsed: new Set(),
    filters: { unreadOnly: false, hideMuted: false },
  };
});

/**
 * Chat home lists channels only (owner, 2026-11-07, option B of the round-two
 * redesign). Direct and group messages live on the Messages screen, with
 * their Hide (#2303) and Hidden conversations group; their coverage is in
 * `messages-screen.spec.tsx`.
 */
describe("Chat home lists channels only (2026-11-07)", () => {
  it("leaves every DM and group DM off the list, hidden or not", () => {
    const tree = render();

    expect(rows(tree).map((row) => row.props.name)).toEqual(["general"]);
    expect(screenText(tree)).not.toContain("DIRECT");
    expect(screenText(tree)).not.toContain("Direct");
  });

  it("draws no Hidden conversations group, whatever is hidden", () => {
    const tree = render();

    expect(screenText(tree)).not.toContain("Hidden conversations");
  });

  it("offers Hide on no row: a channel has no conversation to hide", () => {
    const tree = render();

    expect(rowNamed(tree, "general").props.onHide).toBeUndefined();
  });

  it("marks no row as a direct message", () => {
    const tree = render();

    expect(rows(tree).every((row) => !row.props.isDirect)).toBe(true);
  });

  it("says the chapter has no channels when only messages exist", () => {
    channelsData.value = [dmAlice, dmBobHidden, group];
    const tree = render();

    expect(rows(tree)).toHaveLength(0);
    expect(hiddenToggleTexts(tree)).toHaveLength(0);
  });

  it("never reads the latest messages: a channel row carries no preview", () => {
    render();

    expect(latestCalls).not.toHaveBeenCalled();
  });
});

function hiddenToggleTexts(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Text" &&
      String(node.props.children).startsWith("Hidden conversations"),
  );
}

/**
 * Every section on s04, top to bottom, as `[header, row names]`.
 *
 * Read off the rendered screen as one list rather than asserted a header at a
 * time, because the order is half of what these tests pin: an assertion per
 * header would pass on a list rendered backwards.
 */
function layout(tree: ReactTestRenderer): [string, string[]][] {
  return tree.root.findAllByType(StickyHeader).flatMap((sticky) => {
    const header = sticky
      .findAllByType(PressableRow)
      .find((node) => node.props.accessibilityRole === "header");
    if (!header) return [];
    // The heading pins (owner 2026-11-07), so it is the shell's own child and
    // its rows are the next one, unless the next one is another heading
    // (a folded section).
    const siblings = sticky.parent!.children.filter(
      (child): child is ReactTestInstance => typeof child !== "string",
    );
    const next = siblings[siblings.indexOf(sticky) + 1];
    const rows =
      next && next.type !== StickyHeader
        ? next.findAllByType(ChannelRow).map((row) => row.props.name)
        : [];
    return [
      [
        // Since #2877 the header is a fold control: the label, then a drawn
        // disclosure glyph at the right edge (no typed chevron text).
        String(
          header.findAll((node) => (node.type as unknown) === "Text")[0]!.props
            .children,
        ),
        rows,
      ] as [string, string[]],
    ];
  });
}

describe("Chat home channel categories (#1684)", () => {
  // Deliberately not alphabetical: this is the server's `display_order`.
  const EXEC = { id: "cat-exec", name: "Executive", display_order: 0 };
  const COMM = { id: "cat-comm", name: "Committees", display_order: 1 };

  const execBoard = {
    id: "c-exec",
    name: "exec-board",
    type: "PRIVATE",
    category_id: "cat-exec",
  };
  const philanthropy = {
    id: "c-phil",
    name: "philanthropy",
    type: "PUBLIC",
    category_id: "cat-comm",
  };
  const orphan = {
    id: "c-orphan",
    name: "old-committee",
    type: "PUBLIC",
    category_id: "cat-deleted",
  };

  it("nests channels under their categories, after Channels, in the API's order", () => {
    categoriesData.value = [EXEC, COMM];
    channelsData.value = [philanthropy, general, execBoard, dmAlice, group];
    const tree = render();

    expect(layout(tree)).toEqual([
      ["Channels", ["general"]],
      ["Executive", ["exec-board"]],
      ["Committees", ["philanthropy"]],
    ]);
  });

  it("follows the server's category order, whatever it is", () => {
    // The same rows with the categories reversed: the sections reverse too, so
    // neither order above is a sort that happened to agree with the fixture.
    categoriesData.value = [COMM, EXEC];
    channelsData.value = [philanthropy, general, execBoard];
    const tree = render();

    expect(layout(tree).map(([label]) => label)).toEqual([
      "Channels",
      "Committees",
      "Executive",
    ]);
  });

  it("never lets a category pull a DM onto Chat home", () => {
    categoriesData.value = [EXEC, COMM];
    channelsData.value = [
      { ...dmAlice, category_id: "cat-exec" },
      { ...group, category_id: "cat-comm" },
    ];
    const tree = render();

    expect(layout(tree)).toEqual([]);
    expect(rows(tree)).toHaveLength(0);
  });

  it("keeps a channel whose category is gone, under Channels", () => {
    categoriesData.value = [EXEC];
    channelsData.value = [orphan, execBoard];
    const tree = render();

    expect(layout(tree)).toEqual([
      ["Channels", ["old-committee"]],
      ["Executive", ["exec-board"]],
    ]);
  });

  it("draws no header for an empty category, or for Channels when everything is filed", () => {
    categoriesData.value = [EXEC, COMM];
    channelsData.value = [execBoard, dmAlice];
    const tree = render();

    expect(layout(tree)).toEqual([["Executive", ["exec-board"]]]);
  });

  it("falls back to the flat layout while categories are missing or unreadable", () => {
    // `useCategories` still loading, or a failed read: no data either way.
    categoriesData.value = undefined;
    channelsData.value = [execBoard, general, dmAlice];
    const tree = render();

    expect(layout(tree)).toEqual([["Channels", ["exec-board", "general"]]]);
  });

  it("keeps a hidden DM off Chat home, even with a category on it", () => {
    categoriesData.value = [EXEC];
    channelsData.value = [general, { ...dmBobHidden, category_id: "cat-exec" }];
    const tree = render();

    expect(layout(tree)).toEqual([["Channels", ["general"]]]);
    expect(hiddenToggleTexts(tree)).toHaveLength(0);
  });
});

describe("Chat home sidebar arrangement (#2877)", () => {
  const social = { id: "c-social", name: "social", type: "PUBLIC" };

  it("draws Pinned on top with the pinned rows moved into it", () => {
    channelsData.value = [general, social, dmAlice];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      // A pinned DM stays off Chat home: it lives on Messages now.
      pinnedIds: new Set([social.id, dmAlice.id]),
    };
    const tree = render();

    expect(layout(tree)).toEqual([
      ["Pinned", ["social"]],
      ["Channels", ["general"]],
    ]);
    expect(rowNamed(tree, "social").props.isPinned).toBe(true);
    expect(rowNamed(tree, "general").props.isPinned).toBe(false);
  });

  it("sorts every section A–Z by the title the row shows", () => {
    channelsData.value = [social, general];
    const tree = render();

    expect(layout(tree)).toEqual([["Channels", ["general", "social"]]]);
  });

  it("folds a section from its header, keeping its total on the header", () => {
    channelsData.value = [general, social];
    unreadData.value = [
      { channel_id: general.id, unread_count: 2, mention_count: 1 },
    ];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      collapsed: new Set(["channels"]),
    };
    const tree = render();

    // The label carries the folded total, since the badge is not read alone.
    // The label says it is folded and carries the total, since iOS announces
    // neither the collapsed state nor the badge; the hint says what a
    // double-tap does, since a header has no button trait.
    const header = pressableLabelled(
      tree,
      "Channels, folded, 1 mention, 2 unread",
    );
    expect(header.props.accessibilityRole).toBe("header");
    expect(header.props.accessibilityHint).toBe(
      "Double-tap to show its channels.",
    );
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(rows(tree)).toHaveLength(0);
    expect(
      header.findAll(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === "@ 1",
      ),
    ).toHaveLength(1);

    act(() => header.props.onPress());
    expect(setCollapsed).toHaveBeenCalledWith({
      sectionKey: "channels",
      collapsed: false,
    });
  });

  it("keeps the filters behind the first heading's button, and switches each from its menu", () => {
    const tree = render();
    // No chips above the list any more (2026-11-06 redesign).
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Unread only",
      ),
    ).toHaveLength(0);

    act(() => pressableLabelled(tree, "Filter channels").props.onPress());
    const toggle = (label: string) =>
      tree.root
        .findByType(ChannelFilterMenu)
        .findAllByType(Toggle)
        .find((node) => node.props.accessibilityLabel === label)!;
    act(() => toggle("Unread only").props.onValueChange(true));
    act(() => toggle("Hide muted").props.onValueChange(true));

    expect(setFilter).toHaveBeenNthCalledWith(1, { unread_only: true });
    expect(setFilter).toHaveBeenNthCalledWith(2, { hide_muted: true });
  });

  it("says a filter is on, on the button and under the heading, and Show all clears both", () => {
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: true, hideMuted: false },
    };
    unreadData.value = [
      { channel_id: general.id, unread_count: 2, mention_count: 0 },
    ];
    const tree = render();

    pressableLabelled(tree, "Filter channels, filters on");
    expect(screenText(tree)).toContain("Showing unread only.");
    act(() =>
      tree.root
        .find(
          (node) =>
            (node.type as unknown) === "Pressable" &&
            node.findAll(
              (child) =>
                (child.type as unknown) === "Text" &&
                child.props.children === "Show all",
            ).length > 0,
        )
        .props.onPress(),
    );
    expect(setFilter).toHaveBeenCalledWith({
      unread_only: false,
      hide_muted: false,
    });
  });

  it("hides muted rows but keeps one that mentions the member", () => {
    channelsData.value = [general, social, dmAlice];
    levelsData.value = [
      { channel_id: general.id, level: "off" },
      { channel_id: social.id, level: "off" },
    ];
    unreadData.value = [
      { channel_id: general.id, unread_count: 1, mention_count: 1 },
    ];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: false, hideMuted: true },
    };
    const tree = render();

    expect(rows(tree).map((row) => row.props.name)).toEqual(["general"]);
  });

  it("says the filters emptied the list and offers to clear them", () => {
    channelsData.value = [general];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: true, hideMuted: false },
    };
    const tree = render();

    // One line where the rows go, with Show all channels as its way out.
    const empty = tree.root.findByType(InlineNote);
    expect(empty.props.children).toBe("No channels match your filters.");
    expect(empty.props.action?.label).toBe("Show all channels");
    act(() => empty.props.action?.onPress());
    expect(setFilter).toHaveBeenCalledWith({
      unread_only: false,
      hide_muted: false,
    });
  });

  /** The open long-press menu's ChannelActionsMenu node. */
  function menu(tree: ReactTestRenderer) {
    return tree.root.find(
      (node) =>
        typeof node.type === "function" &&
        node.type.name === "ChannelActionsMenu",
    );
  }
  /** The labels the open menu offers, in order. */
  function menuLabels(tree: ReactTestRenderer): string[] {
    return menu(tree)
      .findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "menuitem",
      )
      .map((node) => node.props.accessibilityLabel as string);
  }
  function pressItem(tree: ReactTestRenderer, label: string) {
    const item = menu(tree).find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === label,
    );
    act(() => item.props.onPress());
  }
  const longPress = (tree: ReactTestRenderer, name: string) =>
    act(() =>
      rowNamed(tree, name).props.onLongPress({ nativeEvent: { pageY: 300 } }),
    );

  it("opens our own menu on a long press, not the system alert, with a tap", async () => {
    const haptics = await import("expo-haptics");
    channelsData.value = [general];
    const tree = render();

    longPress(tree, "general");
    expect(vi.mocked(Alert.alert)).not.toHaveBeenCalled();
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    // A channel row has no Hide: that is a conversation's action.
    expect(menuLabels(tree)).toEqual([
      "Pin to top",
      "Notifications",
      "Display, Default",
    ]);
    pressItem(tree, "Pin to top");
    expect(setPinned).toHaveBeenCalledWith({
      channelId: general.id,
      pinned: true,
    });
    expect(menu(tree).props.target).toBeNull();
  });

  it("pins this channel to a display on this phone from the menu (#3787)", () => {
    channelsData.value = [general];
    const tree = render();

    longPress(tree, "general");
    pressItem(tree, "Display, Default");
    expect(menuLabels(tree)).toEqual([
      "Your default (Cozy)",
      "Cozy here",
      "Compact here",
      "Bubbles here",
    ]);
    pressItem(tree, "Bubbles here");
    expect(menu(tree).props.target).toBeNull();

    longPress(tree, "general");
    expect(menuLabels(tree)).toContain("Display, Bubbles");
    pressItem(tree, "Display, Bubbles");
    pressItem(tree, "Your default (Cozy)");
    longPress(tree, "general");
    expect(menuLabels(tree)).toContain("Display, Default");
  });

  it("gives an officer Always formal in Display, and locks a formal channel's choices (#3787)", async () => {
    const { resetLockedChannelsForTests } =
      await import("@repo/chat-core/density");
    permissionList.value = ["channels:manage"];
    setDisplayLock.mockResolvedValue(undefined);
    channelsData.value = [general];
    const tree = render();

    longPress(tree, "general");
    pressItem(tree, "Display, Default");
    const toggle = menu(tree).find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "switch",
    );
    expect(toggle.props.accessibilityLabel).toBe("Always formal");
    expect(toggle.props.accessibilityState).toEqual({ checked: false });
    await act(async () => {
      toggle.props.onPress();
    });
    expect(setDisplayLock).toHaveBeenCalledWith({
      id: general.id,
      locked: true,
    });

    // The list now says the channel is locked. The store is cleared first, so
    // only chat home's sync from the list can lock it again.
    resetLockedChannelsForTests();
    channelsData.value = [{ ...general, display_locked: true }];
    const locked = render();
    longPress(locked, "general");
    expect(menuLabels(locked)).toContain("Display, Formal");
    pressItem(locked, "Display, Formal");
    const bubbles = menu(locked).find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Bubbles here",
    );
    expect(bubbles.props.disabled).toBe(true);
    resetLockedChannelsForTests();
  });

  it("gives a member no Always formal switch on a channel they didn't create", () => {
    channelsData.value = [{ ...general, created_by: "someone-else" }];
    const tree = render();

    longPress(tree, "general");
    pressItem(tree, "Display, Default");
    expect(
      menu(tree).findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "switch",
      ),
    ).toHaveLength(0);
  });

  it("says Unpin from top on a pinned row", () => {
    channelsData.value = [general];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      pinnedIds: new Set([general.id]),
    };
    const tree = render();

    longPress(tree, "general");
    expect(menuLabels(tree)[0]).toBe("Unpin from top");
    pressItem(tree, "Unpin from top");
    expect(setPinned).toHaveBeenCalledWith({
      channelId: general.id,
      pinned: false,
    });
  });

  it("offers Mark as read on an unread row, and shows the row's level", () => {
    channelsData.value = [general];
    unreadData.value = [
      { channel_id: general.id, unread_count: 3, mention_count: 0 },
    ];
    levelsData.value = [{ channel_id: general.id, level: "off" }];
    const tree = render();

    longPress(tree, "general");
    expect(menuLabels(tree)).toEqual([
      "Mark as read",
      "Pin to top",
      "Notifications, Muted",
      "Display, Default",
    ]);
    pressItem(tree, "Mark as read");
    expect(markReadMutate).toHaveBeenCalledWith(general.id);
  });

  it("sets a level from the menu's Notifications view", () => {
    channelsData.value = [general];
    levelsData.value = [{ channel_id: general.id, level: "all" }];
    setLevelMutate.mockResolvedValue(undefined);
    const tree = render();

    longPress(tree, "general");
    pressItem(tree, "Notifications, All");
    expect(menuLabels(tree)).toEqual([
      "Every message. Notify me whenever anyone posts here.",
      "Only @mentions. Notify me when someone addresses me.",
      "Mute. No notifications — but @mentions still reach you.",
    ]);
    pressItem(tree, "Mute. No notifications — but @mentions still reach you.");
    expect(setLevelMutate).toHaveBeenCalledWith({
      channelId: general.id,
      level: "off",
    });
  });

  it('marks a level from Settings → Chat messages "(your default)" (#3840)', () => {
    channelsData.value = [general];
    levelsData.value = [
      { channel_id: general.id, level: "mentions", from_chapter_level: true },
    ];
    const tree = render();

    longPress(tree, "general");
    pressItem(tree, "Notifications, Mentions");
    expect(menuLabels(tree)).toContain(
      "Only @mentions (your default). Notify me when someone addresses me.",
    );
  });

  it("locks Notifications while the level is unknown, and while offline", () => {
    channelsData.value = [general];
    const notificationsRow = (tree: ReactTestRenderer) =>
      menu(tree).find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          String(node.props.accessibilityLabel).startsWith("Notifications"),
      );

    // No levels yet: a pick would overwrite a level the member can't see.
    levelsData.value = [];
    const loading = render();
    longPress(loading, "general");
    expect(notificationsRow(loading).props.disabled).toBe(true);

    levelsData.value = [{ channel_id: general.id, level: "all" }];
    connection.writeBlockedReason = "Reconnect to make changes.";
    const offline = render();
    longPress(offline, "general");
    const row = notificationsRow(offline);
    expect(row.props.disabled).toBe(true);
    expect(row.props.accessibilityHint).toBe("Reconnect to make changes.");
    act(() => row.props.onPress());
    expect(menuLabels(offline)).toContain("Notifications, All");
  });

  it("opens the menu from the screen reader's Channel actions", () => {
    channelsData.value = [general];
    const tree = render();
    const row = rowNamed(tree, "general");
    const actionsAction = row
      .findAll(
        (node) =>
          Array.isArray(node.props.accessibilityActions) &&
          typeof node.props.onAccessibilityAction === "function",
      )
      .at(0)!;
    expect(
      actionsAction.props.accessibilityActions.map(
        (action: { label: string }) => action.label,
      ),
    ).toContain("Channel actions");
    act(() =>
      actionsAction.props.onAccessibilityAction({
        nativeEvent: { actionName: "actions" },
      }),
    );
    expect(menu(tree).props.target?.channelId).toBe(general.id);
  });

  it("gives a channel manager Background beside Display, and sets it once the menu has closed (#4031)", async () => {
    permissionList.value = ["channels:manage"];
    setChannelBackground.mockResolvedValue(undefined);
    channelsData.value = [general];
    const tree = render();

    longPress(tree, "general");
    const labels = menuLabels(tree);
    expect(labels.indexOf("Background")).toBe(
      labels.indexOf("Display, Default") + 1,
    );
    pressItem(tree, "Background");
    const midnight = menu(tree).find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.testID === "chat-background-swatch-midnight",
    );
    expect(midnight.props.accessibilityRole).toBe("radio");
    act(() => midnight.props.onPress());
    expect(menu(tree).props.target).toBeNull();
    // iOS: nothing is written until the modal reports it has gone.
    expect(setChannelBackground).not.toHaveBeenCalled();
    const modal = menu(tree).find(
      (node) => (node.type as unknown) === "Modal",
    );
    await act(async () => {
      modal.props.onDismiss();
    });
    expect(setChannelBackground).toHaveBeenCalledWith({
      channelId: general.id,
      background: "midnight",
      storagePath: undefined,
    });
  });

  it("sets a channel photo through the channel's own photo route, and says why a refused one failed (#4031)", async () => {
    const photo = await import("@/lib/chat/chat-background-photo");
    const save = vi
      .spyOn(photo, "saveChatBackgroundPick")
      .mockResolvedValue({ status: "refused", reason: "Not allowed here." });
    permissionList.value = ["channels:manage"];
    setChannelBackground.mockResolvedValue(undefined);
    channelsData.value = [general];
    const tree = render();

    longPress(tree, "general");
    pressItem(tree, "Background");
    const photoSwatch = menu(tree).find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.testID === "chat-background-swatch-photo",
    );
    act(() => photoSwatch.props.onPress());
    const modal = menu(tree).find(
      (node) => (node.type as unknown) === "Modal",
    );
    await act(async () => {
      modal.props.onDismiss();
    });

    const [pick, deps] = save.mock.calls[0]!;
    expect(pick).toBe("photo");
    await deps.requestPhotoUrl({ filename: "a.jpg", contentType: "image/jpeg" });
    expect(requestBackgroundPhotoUrl).toHaveBeenCalledWith({
      scope: "channel",
      filename: "a.jpg",
      contentType: "image/jpeg",
    });
    await deps.save({ background: "photo", storagePath: "p" });
    expect(setChannelBackground).toHaveBeenCalledWith({
      channelId: general.id,
      background: "photo",
      storagePath: "p",
    });
    expect(vi.mocked(Alert.alert)).toHaveBeenCalledWith(
      "Couldn't change the background",
      "Not allowed here.",
    );
    save.mockRestore();
  });

  it("runs a background pick on the close itself where the modal reports no dismiss (Android) (#4031)", async () => {
    const { Platform } = await import("react-native");
    const os = Platform.OS;
    (Platform as { OS: string }).OS = "android";
    try {
      permissionList.value = ["channels:manage"];
      setChannelBackground.mockResolvedValue(undefined);
      channelsData.value = [general];
      const tree = render();
      longPress(tree, "general");
      pressItem(tree, "Background");
      const letters = menu(tree).find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.testID === "chat-background-swatch-letters",
      );
      await act(async () => {
        letters.props.onPress();
      });
      expect(setChannelBackground).toHaveBeenCalledWith({
        channelId: general.id,
        background: "letters",
        storagePath: undefined,
      });
    } finally {
      (Platform as { OS: string }).OS = os;
    }
  });

  it("offers Background to no one without channels:manage, and never on the audit log (#4031)", () => {
    const audit = {
      id: "c-audit",
      name: "chapter-audit",
      type: "PUBLIC",
      is_audit_log: true,
    };
    channelsData.value = [general, audit];
    permissionList.value = [];
    const member = render();
    longPress(member, "general");
    expect(menuLabels(member)).not.toContain("Background");

    permissionList.value = ["channels:manage"];
    const officer = render();
    longPress(officer, "general");
    expect(menuLabels(officer)).toContain("Background");
    longPress(officer, "chapter-audit");
    expect(menuLabels(officer)).not.toContain("Background");
  });

  it("offers Delete channel only with channels:manage, and asks first", () => {
    channelsData.value = [general];
    const tree = render();
    longPress(tree, "general");
    expect(menuLabels(tree)).not.toContain("Delete channel");

    permissionList.value = ["channels:manage"];
    const officer = render();
    longPress(officer, "general");
    expect(menuLabels(officer).at(-1)).toBe("Delete channel");
    longPress(officer, "general");
    pressItem(officer, "Delete channel");
    const [title, , buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(title).toBe("Delete #general?");
    expect(deleteMutateAsync).not.toHaveBeenCalled();
    deleteMutateAsync.mockResolvedValue(undefined);
    act(() => buttons!.at(-1)!.onPress?.());
    expect(deleteMutateAsync).toHaveBeenCalledWith(general.id);
  });

  it.each(["pin", "fold", "filter"] as const)(
    "tells the member when a %s write fails, through the hook's own onError",
    (hook) => {
      channelsData.value = [general];
      render();

      // A hook option rather than `mutate`'s per-call option, which TanStack
      // fires only for the latest write on the hook.
      writeOptions[hook]?.onError?.();
      expect(vi.mocked(Alert.alert)).toHaveBeenLastCalledWith(
        "Couldn't save your channel list",
        "Nothing changed. Check your connection and try again.",
      );
    },
  );
});

describe("Chat home filters on unknown data (#2877)", () => {
  const social = { id: "c-social", name: "social", type: "PUBLIC" };

  it("hides nothing under Unread only while the counts' last read failed", () => {
    channelsData.value = [general, social];
    // Stale rows from an earlier read say nothing is unread; the refetch failed.
    unreadData.value = [];
    queryErrors.unread = true;
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: true, hideMuted: false },
    };
    const tree = render();

    expect(rows(tree).map((row) => row.props.name)).toEqual([
      "general",
      "social",
    ]);
  });

  it("hides nothing under Unread only on counts the phone saved, and marks from them (#4006)", async () => {
    const { holdUnreadFirstPaint, resetUnreadFirstPaintForTests } =
      await import("@/lib/chat/unread-first-paint");
    channelsData.value = [general, social];
    // The request hasn't answered; the last launch's answer says social has
    // nothing unread, and a push for general is in the tray.
    unreadData.value = undefined as never;
    holdUnreadFirstPaint({
      saved: [
        { channel_id: general.id, unread_count: 0, mention_count: 0 },
        { channel_id: social.id, unread_count: 0, mention_count: 0 },
      ],
      tray: { channelIds: new Set([general.id]), since: Date.now() },
    });
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: true, hideMuted: false },
    };
    try {
      const tree = render();

      expect(
        rows(tree).map((row) => [row.props.name, row.props.unreadCount]),
      ).toEqual([
        ["general", 1],
        ["social", 0],
      ]);
    } finally {
      resetUnreadFirstPaintForTests();
    }
  });

  it("hides nothing under Hide muted while the levels' last read failed", () => {
    channelsData.value = [general, social];
    levelsData.value = [{ channel_id: general.id, level: "off" }];
    queryErrors.levels = true;
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: false, hideMuted: true },
    };
    const tree = render();

    expect(rows(tree).map((row) => row.props.name)).toEqual([
      "general",
      "social",
    ]);
  });

  it("draws no stale badge on a row or a folded header after a failed refetch", () => {
    const exec = {
      id: "c-exec",
      name: "exec-board",
      type: "PRIVATE",
      category_id: "cat-exec",
    };
    categoriesData.value = [{ id: "cat-exec", name: "Executive" }];
    channelsData.value = [general, exec];
    // The last good read had mentions in both; the refetch since failed.
    unreadData.value = [
      { channel_id: general.id, unread_count: 2, mention_count: 1 },
      { channel_id: exec.id, unread_count: 3, mention_count: 1 },
    ];
    queryErrors.unread = true;
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      collapsed: new Set(["category:cat-exec"]),
    };
    const tree = render();

    expect(rowNamed(tree, "general").props.mentionCount).toBe(0);
    expect(rowNamed(tree, "general").props.unreadCount).toBe(0);
    // The folded header carries no stale total either.
    expect(
      pressableLabelled(tree, "Executive, folded").props.accessibilityRole,
    ).toBe("header");
    // The screen says so instead.
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          String(node.props.children).startsWith(
            "Unread counts are unavailable",
          ),
      ),
    ).toHaveLength(1);
  });

  it("names a quiet folded section as folded, and says what a double-tap does", () => {
    channelsData.value = [general, social];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      collapsed: new Set(["channels"]),
    };
    const folded = render();
    expect(
      pressableLabelled(folded, "Channels, folded").props.accessibilityHint,
    ).toBe("Double-tap to show its channels.");

    sidebarPrefs.value = { ...sidebarPrefs.value, collapsed: new Set() };
    const open = render();
    expect(pressableLabelled(open, "Channels").props.accessibilityHint).toBe(
      "Double-tap to fold this section.",
    );
  });

  it("filters once the reads are healthy", () => {
    channelsData.value = [general, social];
    levelsData.value = [{ channel_id: general.id, level: "off" }];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: false, hideMuted: true },
    };
    const tree = render();

    expect(rows(tree).map((row) => row.props.name)).toEqual(["social"]);
  });
});

describe("Chat home's title (#2485)", () => {
  beforeEach(() => {
    branding.current = { ...branding.unnamed };
  });

  /** The title row's heading Text; ScreenShell draws exactly one. */
  function heading(tree: ReactTestRenderer) {
    const headings = textHeadings(tree);
    expect(headings).toHaveLength(1);
    return headings[0]!;
  }

  it("is the chapter's name with its mark beside it, not the word Chat", () => {
    branding.current = {
      ...branding.unnamed,
      chapterName: "Tau Nu",
      textMark: "TN",
    };
    const tree = render();

    const title = heading(tree);
    expect(title.props.children).toBe("Tau Nu");
    // The mark shares the title's row, which is the one mobile surface of
    // the chapter mark (spec/behavior/branding.md § Chapter mark).
    const row = title.parent!;
    expect(
      row.findAllByProps({ testID: "chapter-mark-text" }).length,
    ).toBeGreaterThan(0);
  });

  it("falls back to Frapp while the chapter's name is unknown", () => {
    const tree = render();
    expect(heading(tree).props.children).toBe("Frapp");
  });
});

/**
 * The header's right-hand pair (owner, 2026-11-07, option B): a door to
 * Messages and the member's avatar, which opens Profile / Notifications /
 * Settings. The notification bell (#3362) folded into the avatar: its unread
 * dot moved there and the menu's Notifications row carries the count.
 */
describe("Chat home header: Messages and the account menu", () => {
  const push = () => vi.mocked(useRouter)().push;
  const byTestId = (tree: ReactTestRenderer, testID: string) =>
    tree.root.findAllByProps({ testID });
  const unreadNotification = (id: string, data?: unknown) =>
    ({ id, read_at: null, data }) as (typeof notificationsData.value)[number];

  it("draws no bell any more", () => {
    const tree = render();

    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Notifications",
      ),
    ).toHaveLength(0);
  });

  describe("Messages door", () => {
    it("opens Messages", () => {
      const tree = render();
      act(() => pressableLabelled(tree, "Messages").props.onPress());

      expect(push()).toHaveBeenCalledWith("/messages");
    });

    it("draws no badge while no conversation is unread", () => {
      const tree = render();

      expect(byTestId(tree, "messages-badge")).toHaveLength(0);
      expect(
        pressableLabelled(tree, "Messages").props.accessibilityValue,
      ).toBeUndefined();
    });

    it("counts conversations with anything unread, in mention red, and reads it out", () => {
      channelsData.value = [general, dmAlice, dmBobHidden, group];
      unreadData.value = [
        { channel_id: dmAlice.id, unread_count: 4, mention_count: 0 },
        { channel_id: group.id, unread_count: 1, mention_count: 0 },
        // A channel's unread belongs to its own row, not to Messages.
        { channel_id: general.id, unread_count: 9, mention_count: 2 },
      ];
      const tree = render();
      const [pill] = byTestId(tree, "messages-badge").filter(
        (node) => (node.type as unknown) === "View",
      );

      // Two conversations, not five messages.
      expect(screenTextOf(pill!)).toBe("2");
      expect(JSON.stringify(pill!.props.style)).toContain(
        signetDarkTokens.color.semantic.mention,
      );
      expect(
        pressableLabelled(tree, "Messages").props.accessibilityValue,
      ).toEqual({ text: "2 unread conversations" });
    });

    it("says one conversation in the singular", () => {
      unreadData.value = [
        { channel_id: dmAlice.id, unread_count: 1, mention_count: 0 },
      ];
      const tree = render();

      expect(
        pressableLabelled(tree, "Messages").props.accessibilityValue,
      ).toEqual({ text: "1 unread conversation" });
    });

    it("counts nothing for a hidden conversation", () => {
      unreadData.value = [
        { channel_id: dmBobHidden.id, unread_count: 3, mention_count: 0 },
      ];
      const tree = render();

      expect(byTestId(tree, "messages-badge")).toHaveLength(0);
    });
  });

  describe("account dot", () => {
    it("draws no dot while nothing is unread", () => {
      const tree = render();
      const account = pressableLabelled(tree, "Your account");

      expect(byTestId(tree, "account-inbox-dot")).toHaveLength(0);
      expect(account.props.accessibilityValue).toBeUndefined();
    });

    it("draws the dot in house gold, never the chapter accent, and reads the count out", () => {
      // A red accent, the case the fixed gold exists for: beside the channel
      // rows' mention-red badges, an accent-filled dot would read as a mention.
      branding.current = { ...branding.unnamed, accentPrimary: "#D75748" };
      notificationsData.value = [
        unreadNotification("n-1"),
        unreadNotification("n-2"),
        { id: "n-3", read_at: "2026-09-25T10:00:00Z" },
      ];
      const tree = render();
      const [dot] = byTestId(tree, "account-inbox-dot").filter(
        (node) => (node.type as unknown) === "View",
      );

      expect(dot).toBeDefined();
      const style = JSON.stringify(dot!.props.style);
      expect(style).toContain(signetDarkTokens.color.gold.house);
      expect(style).not.toContain("#D75748");
      expect(
        pressableLabelled(tree, "Your account").props.accessibilityValue,
      ).toEqual({ text: "2 unread notifications" });
    });

    it("leaves chat-sourced rows to the channel badges", () => {
      notificationsData.value = [
        unreadNotification("n-1", { target: { screen: "chat" } }),
        unreadNotification("n-2", { target: { screen: "events" } }),
      ];
      const tree = render();

      expect(
        pressableLabelled(tree, "Your account").props.accessibilityValue,
      ).toEqual({ text: "1 unread notifications" });
    });

    it("draws no dot when only chat notifications are unread", () => {
      notificationsData.value = [
        unreadNotification("n-1", { target: { screen: "chat" } }),
      ];
      const tree = render();

      expect(byTestId(tree, "account-inbox-dot")).toHaveLength(0);
    });
  });

  describe("account menu", () => {
    const openMenu = (tree: ReactTestRenderer) =>
      act(() => pressableLabelled(tree, "Your account").props.onPress());
    const menuRow = (tree: ReactTestRenderer, label: string) =>
      tree.root.findByType(ScreenShell).props.overlay.content.props.menu.visible
        ? tree.root.find(
            (node) =>
              (node.type as unknown) === "Pressable" &&
              node.props.accessibilityRole === "button" &&
              node.findAll(
                (inner) =>
                  (inner.type as unknown) === "Text" &&
                  inner.props.children === label,
              ).length > 0,
          )
        : (() => {
            throw new Error("menu closed");
          })();

    it("is closed until the avatar is pressed", () => {
      const tree = render();

      expect(tree.root.findByType(ScreenShell).props.overlay.open).toBe(false);
      expect(
        pressableLabelled(tree, "Your account").props.accessibilityState,
      ).toEqual({ expanded: false });
    });

    it("opens through the shell's overlay with Profile, Notifications and Settings", () => {
      const tree = render();
      openMenu(tree);

      const shell = tree.root.findByType(ScreenShell);
      expect(shell.props.overlay.open).toBe(true);
      expect(
        pressableLabelled(tree, "Your account").props.accessibilityState,
      ).toEqual({ expanded: true });
      for (const label of ["Profile", "Notifications", "Settings"]) {
        expect(menuRow(tree, label)).toBeDefined();
      }
    });

    it.each([
      ["Profile", "/profile"],
      ["Notifications", "/notifications"],
      ["Settings", "/preferences"],
    ])("opens %s at %s and closes", (label, href) => {
      const tree = render();
      openMenu(tree);
      act(() => menuRow(tree, label).props.onPress());

      expect(push()).toHaveBeenCalledWith(href);
      expect(tree.root.findByType(ScreenShell).props.overlay.open).toBe(false);
    });

    it("carries the inbox's unread count on the Notifications row", () => {
      notificationsData.value = [
        unreadNotification("n-1"),
        unreadNotification("n-2"),
      ];
      const tree = render();
      openMenu(tree);
      const row = menuRow(tree, "Notifications");

      expect(row.props.accessibilityValue).toEqual({ text: "2 unread" });
      expect(screenTextOf(row)).toContain("2");
      expect(screenTextOf(menuRow(tree, "Profile"))).not.toMatch(/\d/);
    });

    it("closes from the backdrop", () => {
      const tree = render();
      openMenu(tree);
      act(() =>
        tree.root
          .findByProps({ testID: "account-menu-backdrop" })
          .props.onPress(),
      );

      expect(tree.root.findByType(ScreenShell).props.overlay.open).toBe(false);
    });
  });
});

/**
 * Chat home is the first screen after launch, so its loading and error states
 * are the state family's (components.md §10), not a spinner over "Loading
 * channels…" and a hand-rolled retry.
 */
describe("Chat home loading and error states", () => {
  it("says to pick a chapter, not a skeleton that never ends, when chat can't be scoped (#4094)", () => {
    // The channel read never goes out, so its query stays pending for good.
    chapterScope.value = "none";
    channelsState.value = { ...channelsState.value, isPending: true };
    const tree = render();

    expect(tree.root.findAllByType(ChannelListSkeleton)).toHaveLength(0);
    expect(tree.root.findAllByType(NoChapterState)).toHaveLength(1);
    // Nothing more is coming, so the screen counts as shown (#4342).
    expect(tree.root.findByType(ScreenReady).props.ready).toBe(true);
  });

  it("marks the screen fully shown for Sentry only once the skeleton gives way (#4342)", () => {
    channelsState.value = { ...channelsState.value, isPending: true };
    const tree = render();
    expect(tree.root.findByType(ScreenReady).props.ready).toBe(false);

    channelsState.value = { ...channelsState.value, isPending: false };
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <ChatHomeScreen />
        </FrappThemeProvider>,
      ),
    );
    expect(tree.root.findAllByType(ChannelListSkeleton)).toHaveLength(0);
    expect(tree.root.findByType(ScreenReady).props.ready).toBe(true);
  });

  it("loads on channel-shaped skeletons, with no spinner or loading copy", () => {
    channelsState.value = { ...channelsState.value, isPending: true };
    const tree = render();

    expect(tree.root.findAllByType(ChannelListSkeleton)).toHaveLength(1);
    expect(
      tree.root.findAll(
        (node) => (node.type as unknown) === "ActivityIndicator",
      ),
    ).toHaveLength(0);
    expect(screenText(tree)).not.toContain("Loading channels");
    expect(rows(tree)).toHaveLength(0);
  });

  it("fails on the shared error state, whose retry refetches the channels", () => {
    const refetch = vi.fn();
    channelsState.value = { ...channelsState.value, isError: true, refetch };
    const tree = render();

    const error = tree.root.findByType(ErrorState);
    expect(error.props.title).toBe("Couldn't load channels");
    // The retry names what it retries, so it still makes sense heard on its
    // own, away from the card's title.
    const retry = pressableLabelled(tree, "Try loading channels again");
    expect(screenTextOf(retry)).toBe("Try loading channels again");
    act(() => {
      retry.props.onPress();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says a refused list is about the member's role, not the network", () => {
    channelsState.value = {
      ...channelsState.value,
      isError: true,
      error: Object.assign(new Error("Forbidden"), { status: 403 }),
    };
    const tree = render();

    const error = tree.root.findByType(ErrorState);
    expect(error.props.title).toBe("Chat isn't open to you yet");
    expect(error.props.body).toContain(
      "Ask an officer to give you the Member role",
    );
    expect(error.props.body).not.toContain("reach the server");
  });

  it("reports a refusal by role to Sentry", () => {
    resetChannelsRefusedReport();
    vi.mocked(Sentry.captureMessage).mockClear();
    channelsState.value = {
      ...channelsState.value,
      isError: true,
      error: Object.assign(new Error("Forbidden"), { status: 403 }),
    };
    render();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "Chat home: channel list refused by role (403)",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("says Retrying… and holds the control while a retry is in flight", () => {
    channelsState.value = {
      ...channelsState.value,
      isError: true,
      isFetching: true,
    };
    const tree = render();

    const retry = pressableLabelled(tree, "Try loading channels again");
    expect(retry.props.disabled).toBe(true);
    expect(screenTextOf(retry)).toBe("Retrying…");
  });

  // writing.md §4, as amended 2026-11-05: no line saying channels appear
  // here, which would only restate what Chat is for, but the next step.
  it("says a chapter has no channels, and what to do about it", () => {
    channelsData.value = [];
    const tree = render();

    const empty = tree.root.findByType(InlineNote);
    expect(empty.props.children).toBe(
      "No channels yet. Ask an admin to add one.",
    );
  });
});

describe("Chat home pull-to-refresh (#3385)", () => {
  it("refreshes everything the screen draws on a pull (#3385)", async () => {
    const tree = render();

    // The scroll view is a host stand-in, so its control is never mounted;
    // the pull is the control's own `refresh`, called directly.
    const scroll = tree.root.find(
      (node) =>
        (node.type as unknown) === "ScrollView" &&
        node.props.refreshControl !== undefined,
    );
    await act(async () => {
      await scroll.props.refreshControl.props.refresh();
    });

    // Chat home no longer reads the latest messages (Messages does).
    const { latest, ...drawn } = refetches;
    for (const refetch of [
      channelsState.value.refetch,
      ...Object.values(drawn),
    ]) {
      expect(refetch).toHaveBeenCalledWith({ cancelRefetch: true });
    }
    expect(latest).not.toHaveBeenCalled();
  });
});

describe("Chat home press feedback", () => {
  it("gives section headers the rows' feedback, not a fade", () => {
    const tree = render();
    const headers = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "header",
    );
    expect(headers.length).toBeGreaterThan(0);

    for (const control of headers) {
      expect(control.props.android_ripple?.color).toMatch(/^rgba\(/);
      // The suite's react-native stub runs as iOS.
      const held = control.props.style({ pressed: true });
      expect(held).toContainEqual({
        backgroundColor: signetDarkTokens.color.surface.card,
      });
      expect(JSON.stringify(held)).not.toContain("opacity");
    }
  });

  // Like the channel rows, the fold headers pad by `sm`
  // and bleed it into the gutter, so their captions line up with the rows'
  // sigils. The bleed sits on the clip that rounds the ripple
  // (`PressableRow`), so each control is where it was.
  it("bleeds section headers into the gutter, inside a rounded clip", () => {
    const tree = render();
    const headers = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "header",
    );
    expect(headers.length).toBeGreaterThan(0);

    for (const control of headers) {
      const { clip, resting } = expectRoundedRipple(
        control,
        signetDarkTokens.radius.control,
      );
      expect(resting.paddingHorizontal).toBe(signetDarkTokens.spacing.sm);
      expect(clip.marginHorizontal).toBe(-signetDarkTokens.spacing.sm);
      expect(resting).not.toHaveProperty("marginHorizontal");
    }
  });
});

/**
 * Launch opens the last channel the member was in, like Discord (owner,
 * 2026-11-05), once per app process and only once the list has answered.
 */
describe("Chat home opens the last channel on launch", () => {
  const answered = () => {
    channelsState.value = { ...channelsState.value, isSuccess: true };
  };
  beforeEach(() => resetChatLaunchForTests());

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("opens the remembered channel, once", async () => {
    answered();
    vi.mocked(AsyncStorage.getItem).mockResolvedValue("c-general");
    render();
    await settle();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(
      `frapp.chat.last-channel.${VIEWER}.chapter-1`,
    );
    // `landing` opens it with no slide, over a list held behind the skeleton.
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "c-general", landing: "1" },
    });

    // Back from the thread lands here again; nothing re-opens.
    vi.mocked(vi.mocked(useRouter)().push).mockClear();
    render();
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });

  it("stays on the list when the remembered channel is gone, hidden, or a DM", async () => {
    answered();
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(dmBobHidden.id);
    const tree = render();
    // Held behind the skeleton while the jump may still happen, so the list
    // never flashes before a channel opens over it (2026-11-07)…
    expect(rows(tree)).toHaveLength(0);
    // …which is still loading as far as the member can tell (#4342)…
    expect(tree.root.findByType(ScreenReady).props.ready).toBe(false);
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
    // …and shown once the launch settles with nowhere to go.
    expect(rows(tree).map((row) => row.props.name)).toEqual(["general"]);
    expect(tree.root.findByType(ScreenReady).props.ready).toBe(true);
  });

  it("stands aside for a notification tap", async () => {
    answered();
    settleChatLaunch();
    vi.mocked(AsyncStorage.getItem).mockResolvedValue("c-general");
    render();
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });

  it("does not jump when the list only answers after launch", async () => {
    // Offline or a failed first fetch: the member has moved on by now.
    resetChatLaunchForTests(Date.now() - 60_000);
    answered();
    vi.mocked(AsyncStorage.getItem).mockResolvedValue("c-general");
    render();
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });

  it("does not jump over a screen a link launched onto", async () => {
    // A cold `frapp://dues` mounts chat home under Dues, never focused: the
    // list answering there must not push a channel over the linked screen,
    // nor later, when the member swipes back to chat home.
    const { __blur, __refocus } = expoRouter as unknown as {
      __blur: () => void;
      __refocus: () => void;
    };
    vi.mocked(AsyncStorage.getItem).mockResolvedValue("c-general");
    act(() => __blur());
    // Earlier tests' screens are still mounted, and blurring them settled the
    // launch; start it afresh so only this screen's focus decides.
    resetChatLaunchForTests();
    answered();
    render();
    await settle();
    act(() => __refocus());
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });

  it("does not jump once the member has left chat home", async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue("c-general");
    render();
    await settle();
    act(() => {
      (expoRouter as unknown as { __blur: () => void }).__blur();
    });
    answered();
    render();
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });
});

describe("Chat home setup checklist (spec/product/modules.md § Setup checklist)", () => {
  const ONE_LINE = {
    doneCount: 0,
    lines: [{ key: "event", label: "Schedule the first event", done: false }],
  };

  it("draws the officer's list under UP NEXT and above the channels", () => {
    setupChecklist.value = ONE_LINE;
    const tree = render();

    const order = tree.root
      .findAll(
        (node) =>
          node.type === UpNextStrip ||
          node.type === SetupChecklistView ||
          node.type === ChannelRow,
      )
      .map((node) => node.type);
    expect(order.slice(0, 3)).toEqual([
      UpNextStrip,
      SetupChecklistView,
      ChannelRow,
    ]);
  });

  it("asks the shared hook to leave dues off the phone", () => {
    render();
    expect(setupChecklistOptions.value).toEqual({ omit: ["dues"] });
  });

  it("re-reads the checklist's lists on a pull", async () => {
    const tree = render();
    await act(async () => {
      await tree.root.findByType(ScreenShell).props.refresh();
    });
    expect(refetches.setup).toHaveBeenCalled();
  });

  it("draws nothing for a member, and nothing over the skeleton", () => {
    expect(render().root.findAllByType(SetupChecklistView)).toHaveLength(0);

    setupChecklist.value = ONE_LINE;
    channelsState.value = { ...channelsState.value, isPending: true };
    expect(render().root.findAllByType(SetupChecklistView)).toHaveLength(0);
  });

  it("draws nothing over the channels' error", () => {
    setupChecklist.value = ONE_LINE;
    channelsState.value = { ...channelsState.value, isError: true };
    expect(render().root.findAllByType(SetupChecklistView)).toHaveLength(0);
  });
});

describe("Chat home rows (2026-11-07 redesign)", () => {
  const social = { id: "c-social", name: "social", type: "PUBLIC" };
  const latest = (channelId: string, createdAt: string) => ({
    channel_id: channelId,
    message_id: `m-${channelId}`,
    sender_id: ALICE,
    author_name: null,
    content: "see you at 6",
    kind: "text",
    payload: null,
    attachment_count: 0,
    created_at: createdAt,
  });

  it("keeps the sections, A to Z, whatever spoke last", () => {
    channelsData.value = [general, social, dmAlice];
    latestData.value = [
      latest(social.id, "2026-09-25T17:00:00Z"),
      latest(general.id, "2026-09-25T16:00:00Z"),
    ];
    const tree = render();

    expect(rows(tree).map((row) => row.props.name)).toEqual([
      "general",
      "social",
    ]);
    expect(screenText(tree)).toContain("Channels");
    expect(screenText(tree)).not.toContain("DIRECT");
  });

  it("draws the section label in sentence case", () => {
    const tree = render();

    expect(layout(tree).map(([label]) => label)).toEqual(["Channels"]);
    expect(screenText(tree)).not.toContain("CHANNELS");
  });

  it("draws a preview line on no row", () => {
    channelsData.value = [general, social];
    latestData.value = [
      latest(general.id, "2026-09-25T17:00:00Z"),
      latest(social.id, "2026-09-25T16:00:00Z"),
    ];
    const tree = render();

    for (const row of rows(tree)) {
      expect(row.props.preview).toBeUndefined();
    }
    expect(screenText(tree)).not.toContain("see you at 6");
  });

  it("draws a muted row quiet, in place", () => {
    channelsData.value = [general, social];
    levelsData.value = [{ channel_id: social.id, level: "off" }];
    const tree = render();

    expect(
      rows(tree).map((row) => [row.props.name, row.props.isMuted]),
    ).toEqual([
      ["general", false],
      ["social", true],
    ]);
  });
});

describe("Chat home section headings draw a disclosure glyph", () => {
  it("draws the glyph in the fold control, down while open and right while folded", () => {
    const open = render();
    const [openHeader] = open.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "header",
    );
    expect(
      openHeader!.findAllByType(DisclosureGlyph).map((n) => n.props.direction),
    ).toEqual(["down"]);
    // Drawn, not typed.
    expect(screenTextOf(openHeader!)).toBe("Channels");

    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      collapsed: new Set(["channels"]),
    };
    const folded = render();
    expect(
      folded.root.findAllByType(DisclosureGlyph).map((n) => n.props.direction),
    ).toEqual(["right"]);
  });

  it("keeps the filter button outside the fold control, at the end of the first heading's row", () => {
    const tree = render();
    const header = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "header",
    );
    const filter = pressableLabelled(tree, "Filter channels");

    expect(header.findAll((n) => n === filter)).toHaveLength(0);
    // They share one heading row, the filter button last.
    let row = filter.parent!;
    while (row.findAll((n) => n === header).length === 0) row = row.parent!;
    const kids = row.children.filter(
      (c): c is ReactTestInstance => typeof c !== "string",
    );
    expect(kids.at(0)!.findAll((n) => n === header)).toHaveLength(1);
    expect(kids.at(-1)!.findAll((n) => n === filter)).toHaveLength(1);
  });
});

describe("Chat home pinned section headings (owner 2026-11-07)", () => {
  it("pins every section heading, so the one in view names the rows under it", () => {
    categoriesData.value = [{ id: "cat-exec", name: "Executive" }];
    channelsData.value = [
      general,
      {
        id: "c-exec",
        name: "exec-board",
        type: "PRIVATE",
        category_id: "cat-exec",
      },
    ];
    const tree = render();
    const scroll = tree.root.find(
      (node) =>
        (node.type as unknown) === "ScrollView" &&
        node.props.refreshControl !== undefined,
    );
    const children = scroll.children.filter(
      (child): child is ReactTestInstance => typeof child !== "string",
    );
    const pinned = (scroll.props.stickyHeaderIndices as number[]).map(
      (index) => children[index]!.type,
    );

    expect(layout(tree).length).toBeGreaterThan(1);
    expect(pinned).toHaveLength(tree.root.findAllByType(StickyHeader).length);
    expect(pinned.length).toBeGreaterThanOrEqual(layout(tree).length);
    expect(pinned.every((type) => type === StickyHeader)).toBe(true);
  });
});
