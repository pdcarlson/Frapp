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

const { channelsData, leaveMutateAsync, reopenMutate } = vi.hoisted(() => ({
  channelsData: { value: [] as unknown[] },
  leaveMutateAsync: vi.fn(),
  reopenMutate: vi.fn(),
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
    otherMemberId: actual.otherMemberId,
    directChannelDisplayName: actual.directChannelDisplayName,
    HIDDEN_CONVERSATIONS_LABEL: actual.HIDDEN_CONVERSATIONS_LABEL,
    HIDE_CONVERSATION_CONFIRM_ACTION: actual.HIDE_CONVERSATION_CONFIRM_ACTION,
    HIDE_CONVERSATION_CONFIRM_BODY: actual.HIDE_CONVERSATION_CONFIRM_BODY,
    HIDE_CONVERSATION_FAILED_BODY: actual.HIDE_CONVERSATION_FAILED_BODY,
    HIDE_CONVERSATION_FAILED_TITLE: actual.HIDE_CONVERSATION_FAILED_TITLE,
    HIDE_CONVERSATION_LABEL: actual.HIDE_CONVERSATION_LABEL,
    hideConversationConfirmTitle: actual.hideConversationConfirmTitle,
    useNowDate: () => new Date("2026-09-25T18:00:00Z"),
    useChannels: () => query(channelsData.value),
    useChannelUnreadCounts: () => query([]),
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

function hiddenToggle(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityState?.expanded !== undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  channelsData.value = [general, dmAlice, dmBobHidden, group];
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

    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityState?.expanded !== undefined,
      ),
    ).toHaveLength(0);
  });
});
