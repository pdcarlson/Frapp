/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The Messages screen (owner, 2026-11-07), rendered for real: the DM and
 * group-DM rows that left Chat home, with the Hide (#2303) and Hidden
 * conversations wiring that moved with them. It lives here, not beside the
 * screen, because a spec under `app/` ships in the bundle
 * (`lib/routes.spec.ts`).
 */

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

const {
  channelsData,
  channelsState,
  unreadData,
  levelsData,
  latestData,
  pinnedIds,
  leaveMutateAsync,
  reopenMutate,
  refetches,
} = vi.hoisted(() => ({
  channelsData: { value: [] as unknown[] },
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
      error?: unknown;
      data?: unknown;
      refetch: ReturnType<typeof vi.fn>;
    },
  },
  unreadData: {
    value: [] as {
      channel_id: string;
      unread_count: number;
      mention_count: number;
    }[],
  },
  levelsData: { value: [] as { channel_id: string; level: string }[] },
  pinnedIds: { value: new Set<string>() },
  latestData: {
    failed: false,
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
  leaveMutateAsync: vi.fn(),
  reopenMutate: vi.fn(),
  refetches: {
    unread: vi.fn(),
    levels: vi.fn(),
    latest: vi.fn(),
  },
}));

vi.mock("@repo/hooks", async () => {
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
    // The pure helpers run for real; only the data hooks are stubbed.
    ...actual,
    useViewerUserId: () => VIEWER,
    useOwnAvatarTint: () => null,
    useMemberDisplayNames: () => ({
      avatarTintFor: () => null,
      byId: { [ALICE]: "Alice Chen", [BOB]: "Bob Diaz" },
      nameFor: (id: string) =>
        ({ [ALICE]: "Alice Chen", [BOB]: "Bob Diaz" })[id] ?? null,
      avatarFor: (id: string) =>
        id === ALICE ? "https://storage.test/alice.jpg?token=t" : null,
    }),
    useChannels: () => ({
      ...query(channelsData.value),
      ...channelsState.value,
    }),
    useChannelUnreadCounts: () => query(unreadData.value, refetches.unread),
    useChannelNotificationPreferences: () =>
      query(levelsData.value, refetches.levels),
    useChannelLatestMessages: () => ({
      ...query(latestData.value, refetches.latest),
      isPending: !latestData.answered && !latestData.failed,
      isError: latestData.failed,
      isSuccess: latestData.answered,
    }),
    useSidebarPreferences: () => ({
      pinnedIds: pinnedIds.value,
      collapsed: new Set<string>(),
      filters: { unreadOnly: false, hideMuted: false },
    }),
    useLeaveChannel: () => ({ mutateAsync: leaveMutateAsync }),
    useGetOrCreateDm: () => ({ mutate: reopenMutate }),
  };
});

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: null }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentPrimary: "#EFB63B",
    accentOnPrimary: "#131211",
    accentSubtle: "#3A2F14",
    accentBorder: "#6E5523",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));

import MessagesScreen from "@/app/(app)/messages";
import { ChannelListSkeleton, ChannelRow } from "@/components/chat/channel-row";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState } from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";

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
const general = { id: "c-general", name: "general", type: "PUBLIC" };

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

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessagesScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const rows = (tree: ReactTestRenderer) => tree.root.findAllByType(ChannelRow);

function rowNamed(tree: ReactTestRenderer, name: string) {
  const row = rows(tree).find((node) => node.props.name === name);
  if (!row) throw new Error(`no row named ${name}`);
  return row;
}

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
  latestData.failed = false;
  pinnedIds.value = new Set();
  channelsData.value = [general, dmAlice, dmBobHidden, group];
  unreadData.value = [];
  levelsData.value = [];
  channelsState.value = {
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
});

describe("Messages lists direct messages only", () => {
  it("draws DMs and group DMs, never a channel, and leaves a hidden DM out", () => {
    const tree = render();

    expect(
      rows(tree)
        .map((row) => row.props.name)
        .sort(),
    ).toEqual(["Alice Chen", "Exec board"]);
    expect(rows(tree).every((row) => row.props.isDirect === true)).toBe(true);
  });

  it("orders conversations newest first by their latest message", () => {
    latestData.value = [
      latest(dmAlice.id, "2026-09-25T10:00:00Z"),
      latest(group.id, "2026-09-25T17:00:00Z"),
    ];
    expect(rows(render()).map((row) => row.props.name)).toEqual([
      "Exec board",
      "Alice Chen",
    ]);

    latestData.value = [
      latest(dmAlice.id, "2026-09-25T18:00:00Z"),
      latest(group.id, "2026-09-25T17:00:00Z"),
    ];
    expect(rows(render()).map((row) => row.props.name)).toEqual([
      "Alice Chen",
      "Exec board",
    ]);
  });

  it("sorts a conversation with no message yet last, by name", () => {
    latestData.value = [latest(group.id, "2026-09-25T17:00:00Z")];
    expect(rows(render()).map((row) => row.props.name)).toEqual([
      "Exec board",
      "Alice Chen",
    ]);
  });

  it("carries unread and mention counts, and muted state, on the rows", () => {
    unreadData.value = [
      { channel_id: dmAlice.id, unread_count: 3, mention_count: 1 },
    ];
    levelsData.value = [{ channel_id: group.id, level: "off" }];
    const tree = render();

    expect(rowNamed(tree, "Alice Chen").props.unreadCount).toBe(3);
    expect(rowNamed(tree, "Alice Chen").props.mentionCount).toBe(1);
    expect(rowNamed(tree, "Exec board").props.isMuted).toBe(true);
    expect(rowNamed(tree, "Alice Chen").props.isMuted).toBe(false);
  });

  it("opens the thread on a tap", () => {
    const tree = render();
    act(() => rowNamed(tree, "Alice Chen").props.onPress());

    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: dmAlice.id },
    });
  });
});

describe("Messages previews", () => {
  it("previews each row with the sender, You, or nothing in a 1:1 DM, and draws no time", () => {
    latestData.value = [
      latest(dmAlice.id, "2026-09-25T15:00:00Z", {
        content: "minutes doc is up",
      }),
    ];
    const tree = render();

    expect(rowNamed(tree, "Alice Chen").props.preview).toBe(
      "minutes doc is up",
    );
    // No message yet: still two lines, so every row is the same height.
    expect(rowNamed(tree, "Exec board").props.preview).toBe("No messages yet");
    expect(rows(tree).every((row) => row.props.timestamp === undefined)).toBe(
      true,
    );
  });

  it("says You for the member's own last line in a DM", () => {
    latestData.value = [
      latest(dmAlice.id, "2026-09-25T15:00:00Z", { sender_id: VIEWER }),
    ];
    expect(rowNamed(render(), "Alice Chen").props.preview).toBe(
      "You: see you at 6",
    );
  });

  it("names the sender in a group DM, whose row names several people", () => {
    channelsData.value = [group];
    latestData.value = [latest(group.id, "2026-09-25T17:00:00Z")];
    expect(rows(render())[0]!.props.preview).toBe("Alice: see you at 6");
  });

  it("names an unnamed sender by the thread's whole fallback label", () => {
    channelsData.value = [group];
    latestData.value = [
      latest(group.id, "2026-09-25T17:00:00Z", {
        sender_id: "99999999-9999-4999-8999-999999999999",
      }),
    ];
    expect(rows(render())[0]!.props.preview).toMatch(
      /^Member \S+: see you at 6$/,
    );
  });

  // The order comes from the previews, so the list waits for them rather
  // than reordering under a thumb.
  it("loads on the skeleton until the previews answer", () => {
    latestData.answered = false;
    const tree = render();
    expect(rows(tree)).toHaveLength(0);
    expect(tree.root.findAllByType(ChannelListSkeleton)).toHaveLength(1);
  });

  it("holds each preview line blank if the previews fail, so no row grows", () => {
    latestData.answered = false;
    latestData.failed = true;
    expect(rows(render()).map((row) => row.props.preview)).toEqual(["", ""]);
  });

  it("puts a DM the member pinned first", () => {
    latestData.value = [
      latest(dmAlice.id, "2026-09-25T10:00:00Z"),
      latest(group.id, "2026-09-25T17:00:00Z"),
    ];
    pinnedIds.value = new Set([dmAlice.id]);
    expect(rows(render()).map((row) => row.props.name)).toEqual([
      "Alice Chen",
      "Exec board",
    ]);
  });
});

describe("Messages hide conversation (#2303)", () => {
  it("offers Hide on a 1:1 DM only, never on a Group DM", () => {
    const tree = render();

    expect(rowNamed(tree, "Alice Chen").props.onHide).toBeTypeOf("function");
    expect(rowNamed(tree, "Exec board").props.onHide).toBeUndefined();
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
    expect(screenText(tree)).toContain("Hidden conversations (1)");
    expect(rows(tree).map((row) => row.props.name)).not.toContain("Bob Diaz");
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

  it("keeps the way back when every conversation is hidden", () => {
    channelsData.value = [dmBobHidden];
    const tree = render();

    expect(screenText(tree)).not.toContain("No messages yet.");
    expect(hiddenToggle(tree).props.accessibilityState).toEqual({
      expanded: false,
    });
  });

  it("draws no group when nothing is hidden", () => {
    channelsData.value = [general, dmAlice];
    expect(hiddenToggles(render())).toHaveLength(0);
  });
});

describe("Messages header, empty and error states", () => {
  it("offers New message, which opens the Directory", () => {
    const tree = render();
    const button = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "New message",
    );
    act(() => button.props.onPress());

    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/directory");
  });

  it("says there are no messages, and where to start one", () => {
    channelsData.value = [general];
    const empty = render().root.findByType(InlineNote);

    expect(empty.props.children).toBe(
      "No messages yet. Tap the pencil to pick someone from the Directory.",
    );
  });

  it("loads on skeletons", () => {
    channelsState.value = { ...channelsState.value, isPending: true };
    const tree = render();

    expect(tree.root.findAllByType(ChannelListSkeleton)).toHaveLength(1);
    expect(rows(tree)).toHaveLength(0);
  });

  it("fails on the shared error state, whose retry refetches", () => {
    const refetch = vi.fn();
    channelsState.value = {
      ...channelsState.value,
      data: undefined,
      isError: true,
      refetch,
    };
    const tree = render();

    const error = tree.root.findByType(ErrorState);
    expect(error.props.retryLabel).toBe("Try loading messages again");
    act(() => error.props.onRetry());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes channels, counts, previews and levels on a pull", async () => {
    const tree = render();
    await act(async () => {
      await tree.root.findByType(ScreenShell).props.refresh();
    });

    for (const refetch of [
      channelsState.value.refetch,
      ...Object.values(refetches),
    ]) {
      expect(refetch).toHaveBeenCalledWith({ cancelRefetch: true });
    }
  });
});
