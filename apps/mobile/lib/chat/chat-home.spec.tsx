/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

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
  sidebarPrefs,
  leaveMutateAsync,
  reopenMutate,
  setPinned,
  setCollapsed,
  setFilter,
  writeOptions,
  queryErrors,
} = vi.hoisted(() => ({
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
}));

vi.mock("@repo/hooks", async () => {
  // The pure helpers run for real: the point is to catch the screen using
  // them wrongly, and a stub would decide the answer itself.
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  const query = (data: unknown) => ({
    data,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  return {
    canHideConversation: actual.canHideConversation,
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
      ...query(levelsData.value),
      isError: queryErrors.levels,
    }),
    useNowDate: () => new Date("2026-09-25T18:00:00Z"),
    useChannels: () => query(channelsData.value),
    useCategories: () => query(categoriesData.value),
    useChannelUnreadCounts: () => ({
      ...query(unreadData.value),
      isError: queryErrors.unread,
    }),
    useEvents: () => query([]),
    useTasks: () => query([]),
    useViewerUserId: () => VIEWER,
    useMemberDisplayNames: () => ({
      byId: { [ALICE]: "Alice Chen", [BOB]: "Bob Diaz" },
    }),
    useLeaveChannel: () => ({ mutateAsync: leaveMutateAsync }),
    useGetOrCreateDm: () => ({ mutate: reopenMutate }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentFallbackApplied: false,
    accentPrimary: "#EFB63B",
    accentOnPrimary: "#131211",
    logoUrl: null,
    chapterName: null,
  }),
}));

import ChatHomeScreen from "@/app/(tabs)/index";
import { ChannelRow } from "@/components/chat/channel-row";

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
  channelsData.value = [general, dmAlice, dmBobHidden, group];
  categoriesData.value = [];
  unreadData.value = [];
  levelsData.value = [];
  queryErrors.unread = false;
  queryErrors.levels = false;
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
    .findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "header",
    )
    .map((header) => [
      // Since #2877 the header is a fold control: a chevron, then the label.
      String(
        header.findAll((node) => (node.type as unknown) === "Text")[1]!.props
          .children,
      ),
      // The rows are the fold control's siblings in the section.
      header.parent!.findAllByType(ChannelRow).map((row) => row.props.name),
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

  function pressableLabelled(tree: ReactTestRenderer, label: string) {
    return tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === label,
    );
  }

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

  it("switches each filter from its chip", () => {
    const tree = render();

    act(() => pressableLabelled(tree, "Unread only").props.onPress());
    act(() => pressableLabelled(tree, "Hide muted").props.onPress());

    expect(setFilter).toHaveBeenNthCalledWith(1, { unread_only: true });
    expect(setFilter).toHaveBeenNthCalledWith(2, { hide_muted: true });
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
    channelsData.value = [general, social];
    // The last good read had a mention in #general; the refetch since failed.
    unreadData.value = [
      { channel_id: general.id, unread_count: 2, mention_count: 1 },
    ];
    queryErrors.unread = true;
    const tree = render();

    expect(rowNamed(tree, "general").props.mentionCount).toBe(0);
    expect(rowNamed(tree, "general").props.unreadCount).toBe(0);
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
