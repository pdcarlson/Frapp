/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ASK_FLAG_ENV_KEY } from "@/lib/ask/flag";
import { useRouter } from "expo-router";

/**
 * #2259 — every Ask entry point hangs off `isAskAvailable()`.
 *
 * Owner decision 2026-09-22: a build without Ask draws no ✦ pill on Chat home
 * (s04) or Events (s06), and `frapp://ask` redirects to Chat home rather than
 * drawing an Ask shell. The pill used to press through and open a sheet that
 * said Ask was off, which App Review reads as a placeholder (Guideline 2.1).
 * `spec/ui/mobile/navigation.md` § Global entries records the reversal.
 *
 * These render the real screens, because the gate lives in each host's
 * `headerAction` and in `AskSheet` itself — a unit test of the flag alone would
 * pass with every host still drawing the pill. They live here, not beside the
 * screens: a spec under `app/` is a route module and ships in the bundle
 * (`lib/routes.spec.ts`, `docs/mobile/testing.md` § Gotchas).
 */

// The member's own status (#3845) has its own spec
// (`components/chat/home-header.spec.tsx`); here it is simply unknown.
vi.mock("@/lib/account/own-status", () => ({
  useOwnStatus: () => null,
  useOwnStatusSync: () => undefined,
  useSaveOwnStatus: () => ({ save: vi.fn(), isSaving: false }),
}));
// Chat home's status sheet is a second `BottomSheetModal`; this spec counts
// Ask's alone.
vi.mock("@/components/account/status-sheet", () => ({
  StatusSheet: () => null,
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  // s06's pure series helpers (#3823), which its list runs on any data.
  const {
    collapseSeries,
    eventSeriesKey,
    seriesCadenceLabel,
    seriesHeadOf,
    splitByHorizon,
  } = await importOriginal<typeof import("@repo/hooks")>();
  const empty = {
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  const now = new Date("2026-09-25T18:00:00Z");
  return {
    collapseSeries,
    eventSeriesKey,
    seriesCadenceLabel,
    seriesHeadOf,
    splitByHorizon,
    useNowDate: () => now,
    // s06 gates its list on an active chapter (no chapter, no query).
    useActiveChapterId: () => "chapter-1",
    // A member the server can scope chat for (#4094).
    useChapterScope: () => "chapter",
    useChannels: () => empty,
    useCategories: () => empty,
    useChannelUnreadCounts: () => empty,
    useChannelLatestMessages: () => empty,
    useEvents: () => empty,
    // s06 draws its New event button for an officer; a member here.
    usePermissionList: () => [],
    useCreateEvent: () => ({ mutate: vi.fn(), isPending: false }),
    useNotifications: () => empty,
    useCurrentUser: () => empty,
    useTasks: () => empty,
    useViewerUserId: () => "viewer-1",
    useOwnAvatarTint: () => null,
    useMemberDisplayNames: () => ({
      avatarTintFor: () => null, byId: {}, nameFor: () => null }),
    useChapterRoster: () => empty,
    useMentionRoles: () => empty,
    useChapterSetupChecklist: () => ({
      checklist: null,
      hide: vi.fn(),
      refetch: vi.fn(),
    }),
    useSidebarPreferencesRefetch: () => ({ refetch: vi.fn() }),
    useLeaveChannel: () => ({ mutateAsync: vi.fn() }),
    useMarkChannelRead: () => ({ mutate: vi.fn() }),
    useSetChannelNotificationLevel: () => ({ mutate: vi.fn() }),
    useSetChannelDisplayLock: () => ({ mutateAsync: vi.fn() }),
    canSetChannelDisplayLock: () => false,
    useDeleteChannel: () => ({ mutateAsync: vi.fn() }),
    channelRowActions: () => ({ member: [], officer: [] }),
    useGetOrCreateDm: () => ({ mutate: vi.fn() }),
    canHideConversation: () => false,
    otherMemberId: () => null,
    groupChannelsByCategory: () => ({
      uncategorized: [],
      categories: [],
      direct: [],
    }),
    HIDDEN_CONVERSATIONS_LABEL: "Hidden conversations",
    // #2877: s04's sidebar arrangement. An empty list arranges to nothing.
    useSidebarPreferences: () => ({
      pinnedIds: new Set(),
      collapsed: new Set(),
      filters: { unreadOnly: false, hideMuted: false },
    }),
    useSetChannelPinned: () => ({ mutate: vi.fn() }),
    useSetSidebarSectionCollapsed: () => ({ mutate: vi.fn() }),
    useSetSidebarFilter: () => ({ mutate: vi.fn() }),
    useChannelNotificationPreferences: () => empty,
    sidebarSections: () => [],
    arrangeChannelSidebar: () => ({ sections: [], emptiedByFilters: false }),
    sidebarUnreadCounts: () => undefined,
    sidebarMutedChannelIds: () => undefined,
    foldedSectionAnnouncement: () => "",
    UNREAD_ONLY_LABEL: "Unread only",
    HIDE_MUTED_LABEL: "Hide muted",
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentPrimary: "#EFB63B",
    accentOnPrimary: "#131211",
    logoUrl: null,
    chapterName: null,
  }),
}));

import ChatHomeScreen from "@/app/(app)/(tabs)/index";
import EventsScreen from "@/app/(app)/(tabs)/events";
import AskScreen from "@/app/(app)/ask";

type Node = ReactTestRenderer["root"];

/** Stands in for gorhom's modal instance, so a spec can see `present()`. */
const present = vi.fn();

function render(screen: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{screen}</FrappThemeProvider>, {
      // `vitest.setup.ts` mocks `BottomSheetModal` as a host string, so the
      // sheet's forwarded ref lands on whatever this returns for it.
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal" ? { present } : null,
    });
  });
  return tree;
}

/**
 * The host-string casts are the ones `lib/onboarding/join-screen.spec.tsx`
 * explains: `tsc` sees react-native's real types, where `node.type` is never
 * the strings `vitest.setup.ts` substitutes.
 */
function askPills(root: Node): Node[] {
  return root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Ask",
  );
}

function sheets(root: Node): Node[] {
  return root.findAll((node) => (node.type as unknown) === "BottomSheetModal");
}

beforeEach(() => {
  delete process.env[ASK_FLAG_ENV_KEY];
  present.mockClear();
  vi.mocked(vi.mocked(useRouter)().dismissTo).mockClear();
});

afterEach(() => {
  delete process.env[ASK_FLAG_ENV_KEY];
});

describe.each([
  ["Chat home (s04)", () => <ChatHomeScreen />],
  ["Events (s06)", () => <EventsScreen />],
])("%s", (_name, screen) => {
  it("draws no ✦ pill and no sheet in a build without Ask", () => {
    const tree = render(screen());

    expect(askPills(tree.root)).toHaveLength(0);
    // The sheet refuses to exist on its own account too, so the synthetic
    // corpus behind it is unreachable whatever a host does.
    expect(sheets(tree.root)).toHaveLength(0);
  });

  it("stays closed for a near-miss spelling of the flag", () => {
    process.env[ASK_FLAG_ENV_KEY] = "TRUE";
    const tree = render(screen());

    expect(askPills(tree.root)).toHaveLength(0);
  });

  it("draws the pill with Ask on, and the pill presents the sheet", () => {
    process.env[ASK_FLAG_ENV_KEY] = "1";
    const tree = render(screen());

    const pills = askPills(tree.root);
    expect(pills).toHaveLength(1);
    expect(sheets(tree.root)).toHaveLength(1);

    act(() => {
      pills[0].props.onPress();
    });
    expect(present).toHaveBeenCalledTimes(1);
  });
});

// Chat home's header pair (owner, 2026-11-07): the Messages door and the
// account avatar share the title row with the pill, and are drawn whether or
// not the build has Ask. The notification bell folded into the avatar.
describe("Chat home (s04) header controls", () => {
  const screen = () => <ChatHomeScreen />;
  const labelled = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === label,
    );

  it.each([
    ["off", undefined],
    ["on", "1"],
  ])("draws Messages and Your account with Ask %s", (_state, flag) => {
    if (flag) process.env[ASK_FLAG_ENV_KEY] = flag;
    const tree = render(screen());

    expect(labelled(tree, "Messages")).toHaveLength(1);
    expect(labelled(tree, "Your account")).toHaveLength(1);
    // The bell is gone: Notifications lives in the account menu.
    expect(labelled(tree, "Notifications")).toHaveLength(0);
  });
});

describe("the ask route (frapp://ask)", () => {
  it("redirects to Chat home in a build without Ask", () => {
    const tree = render(<AskScreen />);

    // Popped down to, not replaced: a replace would stack a second tab
    // navigator over the first.
    expect(vi.mocked(useRouter)().dismissTo).toHaveBeenCalledWith("/");
    // No Ask shell behind the redirect, and nothing presented.
    expect(askPills(tree.root)).toHaveLength(0);
    expect(sheets(tree.root)).toHaveLength(0);
    expect(present).not.toHaveBeenCalled();
  });

  it("presents the sheet on arrival with Ask on", () => {
    process.env[ASK_FLAG_ENV_KEY] = "true";
    const tree = render(<AskScreen />);

    expect(vi.mocked(useRouter)().dismissTo).not.toHaveBeenCalled();
    expect(askPills(tree.root)).toHaveLength(1);
    expect(sheets(tree.root)).toHaveLength(1);
    expect(present).toHaveBeenCalledTimes(1);
  });
});
