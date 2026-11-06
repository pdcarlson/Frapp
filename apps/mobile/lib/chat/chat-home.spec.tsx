/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
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
  refetches,
  setupChecklist,
  setupChecklistOptions,
} = vi.hoisted(() => ({
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
  levelsData: { value: [] as { channel_id: string; level: string }[] },
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
    useChannels: () => ({
      ...query(channelsData.value),
      ...channelsState.value,
    }),
    useCategories: () => query(categoriesData.value, refetches.categories),
    useChannelUnreadCounts: () => ({
      ...query(unreadData.value, refetches.unread),
      isError: queryErrors.unread,
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
    useMemberDisplayNames: () => ({
      byId: { [ALICE]: "Alice Chen", [BOB]: "Bob Diaz" },
      nameFor: (id: string) =>
        ({ [ALICE]: "Alice Chen", [BOB]: "Bob Diaz" })[id] ?? null,
    }),
    resolveAuthorLabel: actual.resolveAuthorLabel,
    resolveAuthorName: actual.resolveAuthorName,
    FILTER_CHANNELS_LABEL: actual.FILTER_CHANNELS_LABEL,
    FILTER_CHANNELS_ON_LABEL: actual.FILTER_CHANNELS_ON_LABEL,
    useChannelLatestMessages: () => ({
      ...query(latestData.value, refetches.latest),
      isSuccess: latestData.answered,
    }),
    useLeaveChannel: () => ({ mutateAsync: leaveMutateAsync }),
    useGetOrCreateDm: () => ({ mutate: reopenMutate }),
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

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => branding.current,
}));

import ChatHomeScreen from "@/app/(tabs)/index";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  resetChatLaunchForTests,
  settleChatLaunch,
} from "@/lib/chat/last-channel";
import { ChannelListSkeleton, ChannelRow } from "@/components/chat/channel-row";
import { ChannelFilterMenu } from "@/components/chat/channel-filter-menu";
import { Toggle } from "@/components/toggle";
import { SearchGlyph } from "@/components/search-glyph";
import { SetupChecklistView } from "@/components/chat/setup-checklist";
import { UpNextStrip } from "@/components/chat/up-next-strip";
import { ScreenShell } from "@/components/screen-shell";
import {
  EmptyState,
  EmptyStateAction,
  ErrorState,
} from "@/components/state-block";

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

/** The Hidden conversations group's toggle, told apart from the section folds. */
function hiddenToggles(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityState?.expanded !== undefined &&
      node.findAll(
        (inner) =>
          (inner.type as unknown) === "Text" &&
          String(inner.props.children).startsWith("Hidden conversations"),
      ).length > 0,
  );
}

function hiddenToggle(tree: ReactTestRenderer) {
  const [toggle] = hiddenToggles(tree);
  if (!toggle) throw new Error("no Hidden conversations toggle");
  return toggle;
}

beforeEach(() => {
  vi.clearAllMocks();
  latestData.value = [];
  latestData.answered = true;
  setupChecklist.value = null;
  channelsData.value = [general, dmAlice, dmBobHidden, group];
  categoriesData.value = [];
  unreadData.value = [];
  levelsData.value = [];
  notificationsData.value = [];
  queryErrors.unread = false;
  queryErrors.levels = false;
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

describe("Chat home hide conversation (#2303)", () => {
  it("leaves a hidden DM out of the list", () => {
    const tree = render();

    expect(rows(tree).map((row) => row.props.name)).toEqual([
      "general",
      "Alice Chen",
      "Exec board",
    ]);
  });

  it("offers Hide on a 1:1 DM only, never on a Group DM or a channel", () => {
    const tree = render();

    expect(rowNamed(tree, "Alice Chen").props.onHide).toBeTypeOf("function");
    expect(rowNamed(tree, "Exec board").props.onHide).toBeUndefined();
    expect(rowNamed(tree, "general").props.onHide).toBeUndefined();
  });

  it("confirms before hiding, then hides that DM", async () => {
    leaveMutateAsync.mockResolvedValue(undefined);
    const tree = render();

    act(() => rowNamed(tree, "Alice Chen").props.onHide());
    expect(leaveMutateAsync).not.toHaveBeenCalled();
    const [title, , buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(title).toBe("Hide your conversation with Alice Chen?");

    await act(async () => {
      buttons!.find((button) => button.text === "Hide")?.onPress?.();
    });
    expect(leaveMutateAsync).toHaveBeenCalledWith(dmAlice.id);
  });

  it("keeps hidden DMs behind a collapsed group that reopens them", () => {
    const tree = render();

    const toggle = hiddenToggle(tree);
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    act(() => toggle.props.onPress());

    const bob = rowNamed(tree, "Bob Diaz");
    expect(bob.props.onHide).toBeUndefined();
    act(() => bob.props.onPress());

    // Reopening is what clears the hide, so it goes through the DM route with
    // the other member, and the thread opens either way.
    expect(reopenMutate).toHaveBeenCalledWith({ member_id: BOB });
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: dmBobHidden.id },
    });
  });

  it("keeps the way back when every row the member can read is hidden", () => {
    channelsData.value = [dmBobHidden];
    const tree = render();

    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          node.props.children === "No channels yet",
      ),
    ).toHaveLength(0);
    expect(hiddenToggle(tree).props.accessibilityState).toEqual({
      expanded: false,
    });
  });

  it("draws no group when nothing is hidden", () => {
    channelsData.value = [general, dmAlice];
    const tree = render();

    expect(hiddenToggles(tree)).toHaveLength(0);
  });
});

/**
 * Every section on s04, top to bottom, as `[header, row names]`.
 *
 * Read off the rendered screen as one list rather than asserted a header at a
 * time, because the order is half of what these tests pin: an assertion per
 * header would pass on a list rendered backwards.
 */
function layout(tree: ReactTestRenderer): [string, string[]][] {
  return tree.root
    .findAllByType(PressableRow)
    .filter((header) => header.props.accessibilityRole === "header")
    .map((header) => [
      // Since #2877 the header is a fold control: a chevron, then the label.
      String(
        header.findAll((node) => (node.type as unknown) === "Text")[1]!.props
          .children,
      ),
      // The rows are siblings of the heading row (the fold control and, on
      // the first, the filter button) in the section.
      header
        .parent!.parent!.findAllByType(ChannelRow)
        .map((row) => row.props.name),
    ]);
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

  it("nests channels under their categories, between CHANNELS and DIRECT, in the API's order", () => {
    categoriesData.value = [EXEC, COMM];
    channelsData.value = [philanthropy, general, execBoard, dmAlice, group];
    const tree = render();

    expect(layout(tree)).toEqual([
      ["CHANNELS", ["general"]],
      ["Executive", ["exec-board"]],
      ["Committees", ["philanthropy"]],
      ["DIRECT", ["Alice Chen", "Exec board"]],
    ]);
  });

  it("follows the server's category order, whatever it is", () => {
    // The same rows with the categories reversed: the sections reverse too, so
    // neither order above is a sort that happened to agree with the fixture.
    categoriesData.value = [COMM, EXEC];
    channelsData.value = [philanthropy, general, execBoard];
    const tree = render();

    expect(layout(tree).map(([label]) => label)).toEqual([
      "CHANNELS",
      "Committees",
      "Executive",
    ]);
  });

  it("never lets a category pull a DM out of DIRECT", () => {
    categoriesData.value = [EXEC, COMM];
    channelsData.value = [
      { ...dmAlice, category_id: "cat-exec" },
      { ...group, category_id: "cat-comm" },
    ];
    const tree = render();

    expect(layout(tree)).toEqual([["DIRECT", ["Alice Chen", "Exec board"]]]);
  });

  it("keeps a channel whose category is gone, under CHANNELS", () => {
    categoriesData.value = [EXEC];
    channelsData.value = [orphan, execBoard];
    const tree = render();

    expect(layout(tree)).toEqual([
      ["CHANNELS", ["old-committee"]],
      ["Executive", ["exec-board"]],
    ]);
  });

  it("draws no header for an empty category, or for CHANNELS when everything is filed", () => {
    categoriesData.value = [EXEC, COMM];
    channelsData.value = [execBoard, dmAlice];
    const tree = render();

    expect(layout(tree)).toEqual([
      ["Executive", ["exec-board"]],
      ["DIRECT", ["Alice Chen"]],
    ]);
  });

  it("falls back to the flat layout while categories are missing or unreadable", () => {
    // `useCategories` still loading, or a failed read: no data either way.
    categoriesData.value = undefined;
    channelsData.value = [execBoard, general, dmAlice];
    const tree = render();

    expect(layout(tree)).toEqual([
      ["CHANNELS", ["exec-board", "general"]],
      ["DIRECT", ["Alice Chen"]],
    ]);
  });

  it("keeps a hidden DM hidden, even with a category on it", () => {
    categoriesData.value = [EXEC];
    channelsData.value = [general, { ...dmBobHidden, category_id: "cat-exec" }];
    const tree = render();

    expect(layout(tree)).toEqual([["CHANNELS", ["general"]]]);
    expect(hiddenToggle(tree).props.accessibilityState).toEqual({
      expanded: false,
    });
  });
});

describe("Chat home sidebar arrangement (#2877)", () => {
  const social = { id: "c-social", name: "social", type: "PUBLIC" };

  it("draws PINNED on top with the pinned rows moved into it", () => {
    channelsData.value = [general, social, dmAlice];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      pinnedIds: new Set([social.id, dmAlice.id]),
    };
    const tree = render();

    expect(layout(tree)).toEqual([
      ["Pinned", ["Alice Chen", "social"]],
      ["CHANNELS", ["general"]],
    ]);
    expect(rowNamed(tree, "social").props.isPinned).toBe(true);
    expect(rowNamed(tree, "general").props.isPinned).toBe(false);
  });

  it("sorts every section A–Z by the title the row shows", () => {
    channelsData.value = [social, general];
    const tree = render();

    expect(layout(tree)).toEqual([["CHANNELS", ["general", "social"]]]);
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
      "CHANNELS, folded, 1 mention, 2 unread",
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

    expect(rows(tree).map((row) => row.props.name)).toEqual([
      "general",
      "Alice Chen",
    ]);
  });

  it("says the filters emptied the list and offers to clear them", () => {
    channelsData.value = [general];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      filters: { unreadOnly: true, hideMuted: false },
    };
    const tree = render();

    // The state family's empty card, with its CTA, not a hand-rolled block.
    const empty = tree.root.findByType(EmptyState);
    expect(empty.findAllByType(EmptyStateAction)).toHaveLength(1);
    // writing.md § Arrange the channel list gives this state no title, and
    // every string it shows lives in `@repo/hooks`; web shows none either.
    expect(empty.props.title).toBeUndefined();
    // The search glyph, not the "⌕" character Figtree doesn't carry.
    expect(empty.props.glyph).toBe(SearchGlyph);
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          node.props.children === "No channels match your filters.",
      ),
    ).toHaveLength(1);
    const clear = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.findAll(
          (inner) =>
            (inner.type as unknown) === "Text" &&
            inner.props.children === "Show all channels",
        ).length > 0,
    );
    act(() => clear.props.onPress());
    expect(setFilter).toHaveBeenCalledWith({
      unread_only: false,
      hide_muted: false,
    });
  });

  it("offers Pin and Hide on a DM's long press, and Pin alone on a channel", () => {
    channelsData.value = [general, dmAlice];
    const tree = render();

    act(() => rowNamed(tree, "Alice Chen").props.onLongPress());
    const [title, , dmButtons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(title).toBe("Alice Chen");
    expect(dmButtons!.map((b) => b.text)).toEqual([
      "Pin to top",
      "Hide conversation",
      "Cancel",
    ]);
    act(() => dmButtons![0]!.onPress?.());
    expect(setPinned).toHaveBeenCalledWith({
      channelId: dmAlice.id,
      pinned: true,
    });

    act(() => rowNamed(tree, "general").props.onLongPress());
    const [, , channelButtons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(channelButtons!.map((b) => b.text)).toEqual([
      "Pin to top",
      "Cancel",
    ]);
  });

  it("says Unpin from top on a pinned row", () => {
    channelsData.value = [general];
    sidebarPrefs.value = {
      ...sidebarPrefs.value,
      pinnedIds: new Set([general.id]),
    };
    const tree = render();

    act(() => rowNamed(tree, "general").props.onLongPress());
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(buttons![0]!.text).toBe("Unpin from top");
    act(() => buttons![0]!.onPress?.());
    expect(setPinned).toHaveBeenCalledWith({
      channelId: general.id,
      pinned: false,
    });
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
      pressableLabelled(folded, "CHANNELS, folded").props.accessibilityHint,
    ).toBe("Double-tap to show its channels.");

    sidebarPrefs.value = { ...sidebarPrefs.value, collapsed: new Set() };
    const open = render();
    expect(pressableLabelled(open, "CHANNELS").props.accessibilityHint).toBe(
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
 * #3362 — the notification inbox moved off More onto a bell on this screen's
 * title row (owner decision 2026-11-04), where the web keeps it too.
 */
describe("Chat home notifications bell (#3362)", () => {
  function badge(tree: ReactTestRenderer) {
    return pressableLabelled(tree, "Notifications").findAllByProps({
      testID: "notifications-badge",
    });
  }

  it("draws the bell with Ask off, with no badge while nothing is unread", () => {
    const tree = render();
    const bell = pressableLabelled(tree, "Notifications");

    expect(bell.props.accessibilityValue).toBeUndefined();
    expect(badge(tree)).toHaveLength(0);
  });

  it("badges the unread count in house gold, never the chapter accent, and reads it out", () => {
    // A red accent, the case the fixed gold exists for: beside the channel
    // rows' mention-red badges, an accent-filled count would read as a mention.
    branding.current = { ...branding.unnamed, accentPrimary: "#D75748" };
    notificationsData.value = [
      { id: "n-1", read_at: null },
      { id: "n-2", read_at: null },
      { id: "n-3", read_at: "2026-09-25T10:00:00Z" },
    ];
    const tree = render();
    const bell = pressableLabelled(tree, "Notifications");
    const [pill] = badge(tree).filter(
      (node) => (node.type as unknown) === "View",
    );

    expect(bell.props.accessibilityValue).toEqual({ text: "2 unread" });
    const style = JSON.stringify(pill!.props.style);
    expect(style).toContain("#EFB63B");
    expect(style).not.toContain("#D75748");
    expect(screenTextOf(pill!)).toBe("2");
  });

  it("leaves chat-sourced rows to the channel badges below it", () => {
    notificationsData.value = [
      { id: "n-1", read_at: null, data: { target: { screen: "chat" } } },
      { id: "n-2", read_at: null, data: { target: { screen: "events" } } },
    ] as typeof notificationsData.value;
    const tree = render();

    expect(
      pressableLabelled(tree, "Notifications").props.accessibilityValue,
    ).toEqual({ text: "1 unread" });
  });

  it("opens the inbox", () => {
    const tree = render();
    act(() => {
      pressableLabelled(tree, "Notifications").props.onPress();
    });

    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/notifications");
  });
});

/**
 * Chat home is the first screen after launch, so its loading and error states
 * are the state family's (components.md §10), not a spinner over "Loading
 * channels…" and a hand-rolled retry.
 */
describe("Chat home loading and error states", () => {
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

    const empty = tree.root.findByType(EmptyState);
    expect(empty.props.title).toBe("No channels yet");
    expect(empty.props.body).toBe("Ask an admin to add one.");
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

    for (const refetch of [
      channelsState.value.refetch,
      ...Object.values(refetches),
    ]) {
      expect(refetch).toHaveBeenCalledWith({ cancelRefetch: true });
    }
  });
});

describe("Chat home press feedback", () => {
  it("gives section headers and the Hidden toggle the rows' feedback, not a fade", () => {
    const tree = render();
    const headers = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "header",
    );
    expect(headers.length).toBeGreaterThan(0);

    for (const control of [...headers, hiddenToggle(tree)]) {
      expect(control.props.android_ripple?.color).toMatch(/^rgba\(/);
      // The suite's react-native stub runs as iOS.
      const held = control.props.style({ pressed: true });
      expect(held).toContainEqual({
        backgroundColor: signetDarkTokens.color.surface.card,
      });
      expect(JSON.stringify(held)).not.toContain("opacity");
    }
  });

  // Like the channel rows, the fold headers and the Hidden toggle pad by `sm`
  // and bleed it into the gutter, so their captions line up with the rows'
  // sigils. The bleed sits on the clip that rounds the ripple
  // (`PressableRow`), so each control is where it was.
  it("bleeds section headers and the Hidden toggle into the gutter, inside a rounded clip", () => {
    const tree = render();
    const headers = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "header",
    );
    expect(headers.length).toBeGreaterThan(0);

    for (const control of [...headers, hiddenToggle(tree)]) {
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
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "c-general" },
    });

    // Back from the thread lands here again; nothing re-opens.
    vi.mocked(vi.mocked(useRouter)().push).mockClear();
    render();
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });

  it("stays on the list when the remembered channel is gone or hidden", async () => {
    answered();
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(dmBobHidden.id);
    render();
    await settle();
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
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

describe("Chat home previews (2026-11-06 redesign)", () => {
  const social = { id: "c-social", name: "social", type: "PUBLIC" };
  const latest = (
    channelId: string,
    createdAt: string,
    over: Partial<(typeof latestData.value)[number]> = {},
  ) => ({
    channel_id: channelId,
    message_id: `m-${channelId}`,
    sender_id: ALICE,
    author_name: null,
    content: "see you at 6",
    kind: "text",
    payload: null,
    attachment_count: 0,
    created_at: createdAt,
    ...over,
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
      "Alice Chen",
    ]);
    expect(screenText(tree)).toContain("CHANNELS");
    expect(screenText(tree)).toContain("DIRECT");
  });

  it("previews each row with the sender, You, or nothing in a DM, and its time", () => {
    channelsData.value = [general, social, dmAlice, group];
    latestData.value = [
      latest(general.id, "2026-09-25T17:00:00Z", {
        content: "**van** has 3 seats",
      }),
      latest(social.id, "2026-09-25T16:00:00Z", { sender_id: VIEWER }),
      latest(dmAlice.id, "2026-09-25T15:00:00Z", {
        content: "minutes doc is up",
      }),
    ];
    const tree = render();
    const byName = Object.fromEntries(
      rows(tree).map((row) => [row.props.name, row.props]),
    );

    expect(byName.general.preview).toBe("Alice: van has 3 seats");
    expect(byName.social.preview).toBe("You: see you at 6");
    expect(byName["Alice Chen"].preview).toBe("minutes doc is up");
    expect(byName.general.timestamp).toEqual(expect.any(String));
    // No message yet: still two lines, so every row is the same height.
    const quiet = rows(tree).find(
      (row) => !["general", "social", "Alice Chen"].includes(row.props.name),
    )!;
    expect(quiet.props.preview).toBe("No messages yet");
    expect(quiet.props.timestamp).toBeNull();
  });

  it("names the sender in a group DM, whose row names several people", () => {
    channelsData.value = [group];
    latestData.value = [latest(group.id, "2026-09-25T17:00:00Z")];
    expect(rows(render())[0]!.props.preview).toBe("Alice: see you at 6");
  });

  it("names an unnamed sender by the thread's whole fallback label", () => {
    channelsData.value = [general];
    latestData.value = [
      latest(general.id, "2026-09-25T17:00:00Z", {
        sender_id: "99999999-9999-4999-8999-999999999999",
      }),
    ];
    expect(rows(render())[0]!.props.preview).toMatch(
      /^Member \S+: see you at 6$/,
    );
  });

  it("holds each preview line blank until the previews answer, so no row grows", () => {
    channelsData.value = [general, dmAlice];
    latestData.answered = false;
    expect(
      rows(render()).map((row) => [row.props.preview, row.props.timestamp]),
    ).toEqual([
      ["", null],
      ["", null],
    ]);
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
