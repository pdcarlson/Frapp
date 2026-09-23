/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockedUserIds } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";

const BLAKE = "22222222-2222-4222-8222-222222222222";
const GONE = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  blockList: null as unknown as BlockedUserIds,
  unblock: vi.fn(),
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useBlockedUserIds: () => state.blockList,
    useMemberDisplayNames: () => ({
      nameFor: (id: string) => (id === BLAKE ? "Blake" : null),
    }),
  };
});

vi.mock("@/lib/chat/block-actions", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/chat/block-actions")
  >("@/lib/chat/block-actions");
  return {
    ...actual,
    useBlockActions: () => ({
      block: vi.fn(),
      unblock: state.unblock,
      isPending: false,
    }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentFallbackApplied: false,
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { BLOCK_LIST_WAITING_FOR_NETWORK } from "@/lib/chat/blocks";
import {
  BLOCKED_MEMBERS_EMPTY_BODY,
  BLOCKED_MEMBERS_EMPTY_TITLE,
  BLOCKED_MEMBERS_ERROR_BODY,
  BLOCKED_MEMBERS_ERROR_TITLE,
  BLOCKED_MEMBERS_OFFLINE_BODY,
  BLOCKED_MEMBERS_SCOPE,
  BLOCKED_MEMBERS_STALE,
  BlockedMembersSheet,
} from "./blocked-members-sheet";

function list(
  status: BlockedUserIds["status"],
  ids: string[] = [],
  extras: Partial<Pick<BlockedUserIds, "isPaused" | "isRetrying">> = {},
): BlockedUserIds {
  return {
    status,
    ids: new Set(ids),
    unblocked: new Set(),
    retry: vi.fn(),
    isRetrying: false,
    isPaused: false,
    ...extras,
  };
}

function retryButtons(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      /^Retry/.test(String(node.props.accessibilityLabel ?? "")),
  );
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <BlockedMembersSheet />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

beforeEach(() => {
  vi.mocked(Alert.alert).mockClear();
  state.unblock.mockReset();
});

describe("BlockedMembersSheet", () => {
  it("never reports an unreadable list as 'nobody blocked'", () => {
    state.blockList = list("unavailable");
    const flat = text(render());
    expect(flat).toContain(BLOCKED_MEMBERS_ERROR_TITLE);
    expect(flat).toContain(BLOCKED_MEMBERS_ERROR_BODY);
    expect(flat).not.toContain("You haven't blocked anyone");
  });

  it("says the list is empty only off a confirmed read, and only for this chapter", () => {
    state.blockList = list("ready");
    expect(text(render())).toContain(BLOCKED_MEMBERS_EMPTY_TITLE);
    // A member can have blocks in another chapter, so "anyone" alone is false.
    expect(BLOCKED_MEMBERS_EMPTY_TITLE).toBe(
      "You haven't blocked anyone in this chapter",
    );
    expect(BLOCKED_MEMBERS_EMPTY_BODY).toMatch(/this chapter's chat/);
  });

  it("offers Retry on a failed first read", () => {
    state.blockList = list("unavailable");
    const tree = render();
    const [button] = retryButtons(tree);
    act(() => button!.props.onPress());
    expect(state.blockList.retry).toHaveBeenCalledTimes(1);
  });

  it("says a parked first read loads once online, instead of a Retry that cannot help", () => {
    state.blockList = list("unavailable", [], { isPaused: true });
    const tree = render();
    expect(text(tree)).toContain(BLOCKED_MEMBERS_OFFLINE_BODY);
    expect(retryButtons(tree)).toHaveLength(0);
  });

  it("says the list is this chapter's — a member can be in several", () => {
    state.blockList = list("ready", [BLAKE]);
    expect(text(render())).toContain(BLOCKED_MEMBERS_SCOPE);
  });

  it("lists blocked members by name, falling back for one who left the chapter", () => {
    state.blockList = list("ready", [BLAKE, GONE]);
    const flat = text(render());
    expect(flat).toContain("Blake");
    expect(flat).toContain("Member 444444");
  });

  it("keeps showing a cached list when a refresh failed, says so, and offers Retry", () => {
    state.blockList = list("unavailable", [BLAKE]);
    const tree = render();
    const flat = text(tree);
    expect(flat).toContain("Blake");
    expect(flat).toContain(BLOCKED_MEMBERS_STALE);

    const [button] = retryButtons(tree);
    act(() => button!.props.onPress());
    expect(state.blockList.retry).toHaveBeenCalledTimes(1);
  });

  it("over a cached list, says it retries once online while the read is parked", () => {
    state.blockList = list("unavailable", [BLAKE], { isPaused: true });
    const tree = render();
    expect(text(tree)).toContain(BLOCK_LIST_WAITING_FOR_NETWORK);
    expect(retryButtons(tree)).toHaveLength(0);
  });

  it("unblocks only after the member confirms", async () => {
    state.blockList = list("ready", [BLAKE]);
    state.unblock.mockResolvedValue(undefined);
    const tree = render();

    const button = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Unblock Blake" &&
        typeof node.props.onPress === "function",
    );
    act(() => button.props.onPress());
    expect(state.unblock).not.toHaveBeenCalled();

    const [, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    act(() => buttons!.find((b) => b.text === "Unblock")!.onPress!());
    await act(async () => {
      await Promise.resolve();
    });
    expect(state.unblock).toHaveBeenCalledWith(BLAKE);
  });
});
