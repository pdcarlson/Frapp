/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_SENDER_ID, type BlockListStatus } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import {
  MESSAGE_CHECKING_BLOCK_LIST,
  START_DM_FAILED_BODY,
  startDmFailedTitle,
} from "@/lib/directory/start-dm";

/**
 * The member sheet's Message action (#2773), rendered: when the row shows,
 * that it opens the DM's thread, and that a request resolving after the sheet
 * moved to another member neither navigates nor alerts.
 */

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ADA = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  viewer: "11111111-1111-4111-8111-111111111111" as string | null,
  blockStatus: "ready" as BlockListStatus,
  blocked: new Set<string>(),
  blockPaused: false,
  blockRetrying: false,
  retryBlockList: vi.fn(),
  mutateAsync: vi.fn(),
  dmOptions: [] as unknown[],
}));

function profile(userId: string, name: string) {
  return {
    id: `m-${userId}`,
    user_id: userId,
    chapter_id: "c-1",
    role_ids: [],
    custom_role_ids: [],
    has_completed_onboarding: true,
    created_at: "2026-08-21T12:00:00.000Z",
    updated_at: "2026-08-21T12:00:00.000Z",
    display_name: name,
    avatar_url: null,
    email: `${name.toLowerCase()}@example.edu`,
    custom_fields: [],
  };
}

const PROFILES: Record<string, ReturnType<typeof profile>> = {
  [ADA]: profile(ADA, "Ada"),
  [BOB]: profile(BOB, "Bob"),
  [SYSTEM_SENDER_ID]: profile(SYSTEM_SENDER_ID, "Frapp"),
  [VIEWER]: profile(VIEWER, "Me"),
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMember: (id: string) => ({
    data: PROFILES[id],
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useRoles: () => ({ data: [], isPending: false }),
  useCustomRoles: () => ({ data: [], isPending: false }),
  usePermissionList: () => [],
  useViewerUserId: () => state.viewer,
  useBlockedUserIds: () => ({
    ids: state.blocked,
    unblocked: new Set<string>(),
    status: state.blockStatus,
    isPaused: state.blockPaused,
    retry: state.retryBlockList,
    isRetrying: state.blockRetrying,
  }),
  useGetOrCreateDm: (options: unknown) => {
    state.dmOptions.push(options);
    return { mutateAsync: state.mutateAsync, isPending: false };
  },
}));

vi.mock("@/lib/chat/block-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/block-actions")>()),
  useBlockActions: () => ({
    block: vi.fn(),
    unblock: vi.fn(),
    reloadMaskedCopies: vi.fn(),
    isPending: false,
  }),
}));

import { MemberDetailSheet } from "./member-detail-sheet";

const dismiss = vi.fn();

// The directory hands the sheet a ref, and the sheet dismisses itself through
// it; one ref across re-renders, as the directory's `useRef` is.
const sheetRef = React.createRef<React.ComponentRef<typeof MemberDetailSheet>>();

function sheet(userId: string | null) {
  return (
    <FrappThemeProvider>
      <MemberDetailSheet ref={sheetRef} userId={userId} />
    </FrappThemeProvider>
  );
}

function render(userId: string | null): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(sheet(userId), {
      // The sheet dismisses itself through its ref; the stand-in modal is a
      // host string, so hand it an instance that records the call.
      createNodeMock: (element) =>
        element.type === "BottomSheetModal" ? { dismiss } : null,
    });
  });
  return tree;
}

function messageRows(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) => node.props.label === "Message" && typeof node.type === "function",
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("MemberDetailSheet Message action (#2773)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.viewer = VIEWER;
    state.blockStatus = "ready";
    state.blocked = new Set();
    state.blockPaused = false;
    state.blockRetrying = false;
    state.dmOptions = [];
  });

  it("offers Message on another member's profile", () => {
    const tree = render(ADA);
    expect(messageRows(tree)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("does not wait on the channel-list refetch", () => {
    const tree = render(ADA);
    expect(state.dmOptions.at(-1)).toEqual({ awaitRefetch: false });
    act(() => tree.unmount());
  });

  it.each([
    ["your own profile", VIEWER],
    ["the system actor's profile", SYSTEM_SENDER_ID],
  ])("withholds it on %s", (_, userId) => {
    const tree = render(userId);
    expect(messageRows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("withholds it while the viewer is unknown", () => {
    state.viewer = null;
    const tree = render(ADA);
    expect(messageRows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("withholds it for a member you blocked", () => {
    state.blocked = new Set([ADA]);
    const tree = render(ADA);
    expect(messageRows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  // The block list's ids are only a floor until it is read, so the row waits
  // rather than starting a DM, and says why instead of disappearing.
  it("waits, disabled, while the block list loads", () => {
    state.blockStatus = "loading";
    const tree = render(ADA);
    const [row] = messageRows(tree);
    expect(row.props.disabled).toBe(true);
    expect(row.props.description).toBe(MESSAGE_CHECKING_BLOCK_LIST);
    act(() => tree.unmount());
  });

  it("waits for the network while the read is paused offline", () => {
    state.blockStatus = "unavailable";
    state.blockPaused = true;
    const tree = render(ADA);
    const [row] = messageRows(tree);
    expect(row.props.disabled).toBe(true);
    expect(row.props.description).toBe(
      "Couldn't check your block list first. Retries when you're back online.",
    );
    act(() => tree.unmount());
  });

  it("offers to re-read a block list whose read failed, and starts no DM", () => {
    state.blockStatus = "unavailable";
    const tree = render(ADA);
    const [row] = messageRows(tree);
    expect(row.props.disabled).toBe(false);
    expect(row.props.description).toBe(
      "Couldn't check your block list first. Tap to try again.",
    );

    act(() => row.props.onPress());
    expect(state.retryBlockList).toHaveBeenCalledTimes(1);
    expect(state.mutateAsync).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("says it is checking, disabled, while that re-read is in flight", () => {
    state.blockStatus = "unavailable";
    state.blockRetrying = true;
    const tree = render(ADA);
    const [row] = messageRows(tree);
    expect(row.props.disabled).toBe(true);
    expect(row.props.description).toBe(MESSAGE_CHECKING_BLOCK_LIST);
    act(() => tree.unmount());
  });

  it("stays hidden for a member already on the list while it is unavailable", () => {
    state.blockStatus = "unavailable";
    state.blocked = new Set([ADA]);
    const tree = render(ADA);
    expect(messageRows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("opens the DM's thread and dismisses the sheet", async () => {
    state.mutateAsync.mockResolvedValueOnce({ id: "dm-ada" });
    const tree = render(ADA);

    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });

    expect(state.mutateAsync).toHaveBeenCalledWith({ member_id: ADA });
    expect(dismiss).toHaveBeenCalled();
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "dm-ada" },
    });
    act(() => tree.unmount());
  });

  it("sends one request for a double tap", async () => {
    const pending = deferred<unknown>();
    state.mutateAsync.mockReturnValueOnce(pending.promise);
    const tree = render(ADA);
    const row = messageRows(tree)[0];

    await act(async () => {
      row.props.onPress();
      row.props.onPress();
    });
    expect(state.mutateAsync).toHaveBeenCalledTimes(1);
    expect(messageRows(tree)[0].props.disabled).toBe(true);

    await act(async () => {
      pending.resolve({ id: "dm-ada" });
    });
    expect(messageRows(tree)[0].props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("drops a result that lands after the sheet moved to another member, and keeps that member's Message enabled", async () => {
    const pending = deferred<unknown>();
    state.mutateAsync.mockReturnValueOnce(pending.promise);
    const tree = render(ADA);

    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    act(() => tree.update(sheet(BOB)));
    expect(messageRows(tree)[0].props.disabled).toBe(false);

    await act(async () => {
      pending.resolve({ id: "dm-ada" });
    });
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("drops a failure that lands after the sheet moved on", async () => {
    const pending = deferred<unknown>();
    state.mutateAsync.mockReturnValueOnce(pending.promise);
    const tree = render(ADA);

    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    act(() => tree.update(sheet(BOB)));
    await act(async () => {
      pending.reject(new Error("offline"));
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("says the conversation couldn't be opened when the request fails", async () => {
    state.mutateAsync.mockRejectedValueOnce(new Error("offline"));
    const tree = render(ADA);

    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      startDmFailedTitle("Ada"),
      START_DM_FAILED_BODY,
    );
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("reports a response with no channel id as a failure instead of navigating", async () => {
    state.mutateAsync.mockResolvedValueOnce({});
    const tree = render(ADA);

    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      startDmFailedTitle("Ada"),
      START_DM_FAILED_BODY,
    );
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("keeps each member's own request in flight when two overlap", async () => {
    const ada = deferred<unknown>();
    const bob = deferred<unknown>();
    state.mutateAsync
      .mockReturnValueOnce(ada.promise)
      .mockReturnValueOnce(bob.promise);
    const tree = render(ADA);

    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    act(() => tree.update(sheet(BOB)));
    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });

    // Back on Ada while both are out: her row is still disabled, and a tap
    // sends nothing.
    act(() => tree.update(sheet(ADA)));
    expect(messageRows(tree)[0].props.disabled).toBe(true);
    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    expect(state.mutateAsync).toHaveBeenCalledTimes(2);

    // Ada's request settling must not release Bob's.
    act(() => tree.update(sheet(BOB)));
    await act(async () => {
      ada.resolve({ id: "dm-ada" });
    });
    expect(messageRows(tree)[0].props.disabled).toBe(true);

    await act(async () => {
      bob.resolve({ id: "dm-bob" });
    });
    expect(messageRows(tree)[0].props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});

describe("MemberDetailSheet Block row (#2257)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.viewer = VIEWER;
    state.blockStatus = "ready";
    state.blocked = new Set();
    state.blockPaused = false;
  });

  function blockRows(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        typeof node.props.label === "string" &&
        /^(Block|Unblock) /.test(node.props.label) &&
        typeof node.type === "function",
    );
  }

  it("offers Block on another member's profile", () => {
    const tree = render(ADA);
    expect(blockRows(tree).map((row) => row.props.label)).toEqual([
      "Block Ada",
    ]);
    act(() => tree.unmount());
  });

  it.each([
    ["your own profile", VIEWER],
    ["the system actor's profile", SYSTEM_SENDER_ID],
  ])("withholds Block and Unblock on %s", (_, userId) => {
    const tree = render(userId);
    expect(blockRows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("withholds them while the viewer is unknown", () => {
    state.viewer = null;
    const tree = render(ADA);
    expect(blockRows(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });
});
