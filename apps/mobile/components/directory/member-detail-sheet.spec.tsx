/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { ActionSheetIOS, Alert } from "react-native";
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
  permissions: [] as string[],
  roles: [] as unknown[],
  // `GET /v1/pledge-classes` and the options the sheet reads it with (#3939).
  classes: [] as { id: string; name: string }[],
  vocabulary: undefined as Record<string, string> | undefined,
  classReads: [] as ({ enabled?: boolean } | undefined)[],
  // Users whose profile read says `viewer_can_remove`.
  removable: new Set<string>(),
  removeMutate: vi.fn(),
  block: vi.fn(),
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

// Keyed by user id, the id `GET /v1/members/by-user/{userId}` takes: chat
// opens the sheet with a sender or mention id, which is never a member row id.
const PROFILES: Record<string, ReturnType<typeof profile>> = Object.fromEntries(
  [
    profile(ADA, "Ada"),
    profile(BOB, "Bob"),
    profile(SYSTEM_SENDER_ID, "Frapp"),
    profile(VIEWER, "Me"),
  ].map((p) => [p.user_id, p]),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMemberDisplayNames: () => ({ avatarTintFor: () => null }),
  useMemberByUserId: (id: string) => ({
    data: PROFILES[id] && {
      ...PROFILES[id],
      viewer_can_remove: state.removable.has(id),
    },
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useRoles: () => ({ data: state.roles, isPending: false, isSuccess: true }),
  usePermissionList: () => state.permissions,
  useCurrentChapter: () => ({
    data: state.vocabulary ? { vocabulary: state.vocabulary } : undefined,
  }),
  usePledgeClasses: (options?: { enabled?: boolean }) => {
    state.classReads.push(options);
    return options?.enabled === false
      ? { data: undefined, isPending: true, isSuccess: false }
      : { data: state.classes, isPending: false, isSuccess: true };
  },
  useUpdateMemberRoles: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveMember: () => ({ mutate: state.removeMutate, isPending: false }),
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
    block: state.block,
    unblock: vi.fn(),
    reloadMaskedCopies: vi.fn(),
    isPending: false,
  }),
}));

import { ListRow } from "@/components/list-section";
import { SheetHeader } from "@/components/sheet-scaffold";
import { MemberDetailSheet } from "./member-detail-sheet";
import {
  PRESENCE_NOT_READY,
  setChapterPresence,
} from "@/lib/presence/presence-store";

const dismiss = vi.fn();
const present = vi.fn();

// The directory hands the sheet a ref, and the sheet dismisses itself through
// it; one ref across re-renders, as the directory's `useRef` is.
const sheetRef =
  React.createRef<React.ComponentRef<typeof MemberDetailSheet>>();

function sheet(userId: string | null) {
  return (
    <FrappThemeProvider>
      <MemberDetailSheet
        ref={sheetRef}
        member={userId ? { userId } : null}
      />
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
        element.type === "BottomSheetModal" ? { dismiss, present } : null,
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

// components.md § Surface size: a tall sheet, closed with an icon X, headed by
// the member's own name rather than a "Member" title and a Done button.
describe("MemberDetailSheet as a tall sheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.viewer = VIEWER;
  });

  it("opens full height, with no Member title or Done, and closes from its X", () => {
    const tree = render(ADA);
    // The first modal is the profile; the role editor stacks after it.
    const modal = tree.root.findAllByType("BottomSheetModal" as never)[0];
    expect(modal.props.snapPoints).toEqual(["100%"]);
    expect(modal.props.enableDynamicSizing).toBe(false);
    // Stops under the status bar, so the X is never in the unsafe area.
    expect(modal.props.topInset).toBeGreaterThan(0);
    // The header (and its X) stays put while the profile scrolls under it.
    const scroll = tree.root.findByType("BottomSheetScrollView" as never);
    expect(scroll.props.stickyHeaderIndices).toEqual([0]);

    const texts = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children);
    expect(texts).not.toContain("Member");
    expect(texts).not.toContain("Done");

    const close = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Close" &&
        typeof node.props.onPress === "function",
    );
    act(() => close.props.onPress());
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

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

  it("draws no title row or Done over the name", () => {
    const tree = render(ADA);
    // The member's name heads the sheet (components.md § Chrome weight).
    expect(tree.root.findAllByType(SheetHeader)).toHaveLength(0);
    // The role editor's list header is a React element prop, which links
    // back to its fiber; skip those links.
    expect(
      JSON.stringify(tree.toJSON(), (key, value) =>
        key === "_owner" || key === "_store" ? undefined : value,
      ),
    ).not.toContain('"Done"');
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
    expect(row.props.accessibilityHint).toBe(MESSAGE_CHECKING_BLOCK_LIST);
    act(() => tree.unmount());
  });

  it("waits for the network while the read is paused offline", () => {
    state.blockStatus = "unavailable";
    state.blockPaused = true;
    const tree = render(ADA);
    const [row] = messageRows(tree);
    expect(row.props.disabled).toBe(true);
    expect(row.props.accessibilityHint).toBe(
      "Couldn't check your block list first. Retries when you're back online.",
    );
    act(() => tree.unmount());
  });

  it("offers to re-read a block list whose read failed, and starts no DM", () => {
    state.blockStatus = "unavailable";
    const tree = render(ADA);
    const [row] = messageRows(tree);
    expect(row.props.disabled).toBe(false);
    expect(row.props.accessibilityHint).toBe(
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
    expect(row.props.accessibilityHint).toBe(MESSAGE_CHECKING_BLOCK_LIST);
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
    // Working, not unavailable: a spinner in the chevron's place, and the
    // label keeps its colour (`ListRow`'s `busy`, not `disabled`).
    expect(messageRows(tree)[0].props.busy).toBe(true);
    expect(messageRows(tree)[0].props.disabled).toBe(false);

    await act(async () => {
      pending.resolve({ id: "dm-ada" });
    });
    expect(messageRows(tree)[0].props.busy).toBe(false);
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
    expect(messageRows(tree)[0].props.busy).toBe(false);

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

    // Back on Ada while both are out: her row is still busy, and a tap
    // sends nothing.
    act(() => tree.update(sheet(ADA)));
    expect(messageRows(tree)[0].props.busy).toBe(true);
    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    expect(state.mutateAsync).toHaveBeenCalledTimes(2);

    // Ada's request settling must not release Bob's.
    act(() => tree.update(sheet(BOB)));
    await act(async () => {
      ada.resolve({ id: "dm-ada" });
    });
    expect(messageRows(tree)[0].props.busy).toBe(true);

    await act(async () => {
      bob.resolve({ id: "dm-bob" });
    });
    expect(messageRows(tree)[0].props.busy).toBe(false);
    act(() => tree.unmount());
  });
});

// Block and Remove from chapter sit behind the header's ⋯, never on the
// profile's face (Paul, 2026-11-11), and neither is offered on your own.
describe("MemberDetailSheet ⋯ menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.viewer = VIEWER;
    state.blockStatus = "ready";
    state.blocked = new Set();
    state.blockPaused = false;
    state.removable = new Set();
  });

  function moreButton(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        typeof node.props.label === "string" &&
        node.props.label.startsWith("More for ") &&
        typeof node.type === "function",
    );
  }

  /** Opens the ⋯ and answers the action sheet's options, minus Cancel. */
  function openMenu(tree: ReactTestRenderer) {
    const [button] = moreButton(tree);
    act(() => button!.props.onPress());
    const show = vi.mocked(ActionSheetIOS.showActionSheetWithOptions);
    const [options, pick] = show.mock.calls.at(-1)!;
    return {
      labels: options.options.slice(0, -1),
      options,
      pick: (label: string) =>
        act(() => pick(options.options.indexOf(label))),
    };
  }

  /** Presses the alert button labelled `text` on the last alert shown. */
  function pressAlert(text: string) {
    const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
    act(() => buttons.find((b) => b.text === text)!.onPress!());
  }

  it("draws no Block row or Remove button on the profile's face", () => {
    state.removable = new Set([ADA]);
    const tree = render(ADA);
    const faceRows = tree.root.findAll(
      (node) =>
        typeof node.props.label === "string" &&
        /^(Block|Unblock|Remove)/.test(node.props.label) &&
        typeof node.type === "function",
    );
    expect(faceRows).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("offers Block, and no removal, to a viewer who may not remove", () => {
    const tree = render(ADA);
    expect(openMenu(tree).labels).toEqual(["Block Ada"]);
    act(() => tree.unmount());
  });

  it("offers Unblock for a member you blocked", () => {
    state.blocked = new Set([ADA]);
    const tree = render(ADA);
    expect(openMenu(tree).labels).toEqual(["Unblock Ada"]);
    act(() => tree.unmount());
  });

  it("offers Remove from chapter where the API says this viewer may, marked destructive", () => {
    state.removable = new Set([ADA]);
    const tree = render(ADA);
    const menu = openMenu(tree);
    expect(menu.labels).toEqual(["Block Ada", "Remove from chapter"]);
    expect(menu.options.destructiveButtonIndex).toEqual([0, 1]);
    act(() => tree.unmount());
  });

  it("blocks only after confirming", () => {
    const tree = render(ADA);
    openMenu(tree).pick("Block Ada");
    expect(state.block).not.toHaveBeenCalled();
    pressAlert("Block");
    expect(state.block).toHaveBeenCalledWith(ADA);
    act(() => tree.unmount());
  });

  it("removes only after confirming, then closes the sheet", () => {
    state.removable = new Set([ADA]);
    state.removeMutate.mockImplementation(
      (_id: string, handlers: { onSuccess: () => void }) =>
        handlers.onSuccess(),
    );
    const tree = render(ADA);
    openMenu(tree).pick("Remove from chapter");
    expect(state.removeMutate).not.toHaveBeenCalled();
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)![0]).toBe(
      "Remove Ada from the chapter?",
    );
    pressAlert("Remove from chapter");
    expect(state.removeMutate).toHaveBeenCalledWith(
      `m-${ADA}`,
      expect.anything(),
    );
    expect(dismiss).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("says the removal failed when the API refuses it", () => {
    state.removable = new Set([ADA]);
    state.removeMutate.mockImplementation(
      (_id: string, handlers: { onError: (e: unknown) => void }) =>
        handlers.onError(new Error("403")),
    );
    const tree = render(ADA);
    openMenu(tree).pick("Remove from chapter");
    pressAlert("Remove from chapter");
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)![0]).toBe(
      "Couldn't remove Ada",
    );
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it.each([
    ["your own profile", VIEWER],
    ["the system actor's profile", SYSTEM_SENDER_ID],
  ])("draws no ⋯ on %s, even if a read says you may remove", (_, userId) => {
    state.removable = new Set([userId]);
    const tree = render(userId);
    expect(moreButton(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("draws no ⋯ while the viewer is unknown", () => {
    state.viewer = null;
    const tree = render(ADA);
    expect(moreButton(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });
});

/**
 * The sheet's facts are `ListRow`'s detail rows, as s15's are: the label the
 * quiet half and the value the one a member reads (the owner's design review,
 * 2026-11-04). A chapter's custom field, whose label can run long, too.
 */
describe("MemberDetailSheet fact rows", () => {
  const CARA = "44444444-4444-4444-8444-444444444444";
  const LONG_LABEL = "Emergency contact name and phone number";

  beforeEach(() => {
    vi.clearAllMocks();
    state.viewer = VIEWER;
    state.blockStatus = "ready";
    state.blocked = new Set();
    state.blockPaused = false;
    PROFILES[CARA] = {
      ...profile(CARA, "Cara"),
      custom_fields: [
        {
          field_id: "f-1",
          label: LONG_LABEL,
          type: "text",
          value: "Jordan Lee, 555-0100",
        },
      ] as never[],
    };
  });

  it("draws Email, Member since and each custom field as detail rows", () => {
    const tree = render(CARA);
    const rows = tree.root.findAllByType(ListRow);
    const rowOf = (label: string) =>
      rows.find((row) => row.props.label === label);

    expect(rowOf("Email")?.props.variant).toBe("detail");
    // Tapping the address starts an email to them.
    expect(rowOf("Email")?.props.onPress).toBeTypeOf("function");
    expect(rowOf("Member since")?.props.variant).toBe("detail");
    // Written out: no abbreviated month in the UI.
    expect(rowOf("Member since")?.props.value).toMatch(/August/);
    expect(rowOf(LONG_LABEL)?.props.variant).toBe("detail");
    expect(rowOf(LONG_LABEL)?.props.value).toBe("Jordan Lee, 555-0100");
    act(() => tree.unmount());
  });

  // #3939, read-only on mobile: each row only when an officer has set it.
  it("draws the member's pledge class and order number between Email and Member since", () => {
    PROFILES[CARA] = {
      ...profile(CARA, "Cara"),
      pledge_class_id: "pc-1",
      order_number: 9,
    } as never;
    state.classes = [{ id: "pc-1", name: "Alpha" }];
    const tree = render(CARA);

    expect(
      tree.root
        .findAllByType(ListRow)
        .map((row) => [row.props.label, row.props.value])
        .slice(0, 4),
    ).toEqual([
      ["Email", "cara@example.edu"],
      ["Pledge class", "Alpha"],
      ["Fraternal order", "9"],
      ["Member since", "August 21, 2026"],
    ]);
    act(() => tree.unmount());
  });

  it("labels both rows with the chapter's own words, as typed", () => {
    PROFILES[CARA] = {
      ...profile(CARA, "Cara"),
      pledge_class_id: "pc-1",
      order_number: 9,
    } as never;
    state.classes = [{ id: "pc-1", name: "Alpha" }];
    state.vocabulary = { class: "Line", order: "line number" };
    const tree = render(CARA);
    const rows = tree.root
      .findAllByType(ListRow)
      .map((row) => [row.props.label, row.props.value]);
    state.vocabulary = undefined;

    expect(rows.slice(1, 3)).toEqual([
      ["Line", "Alpha"],
      ["line number", "9"],
    ]);
    act(() => tree.unmount());
  });

  it("says Not available for a class the chapter's list no longer holds", () => {
    PROFILES[CARA] = {
      ...profile(CARA, "Cara"),
      pledge_class_id: "pc-gone",
    } as never;
    state.classes = [{ id: "pc-1", name: "Alpha" }];
    const tree = render(CARA);

    expect(
      tree.root.findAllByType(ListRow).find((r) => r.props.label === "Pledge class")
        ?.props.value,
    ).toBe("Not available");
    act(() => tree.unmount());
  });

  it("draws neither row, and reads no class list, for a member with none set", () => {
    state.classReads = [];
    const tree = render(CARA);
    const labels = tree.root
      .findAllByType(ListRow)
      .map((row) => row.props.label);

    expect(labels).not.toContain("Pledge class");
    expect(labels).not.toContain("Fraternal order");
    expect(state.classReads.every((read) => read?.enabled === false)).toBe(
      true,
    );
    act(() => tree.unmount());
  });
});

describe("MemberDetailSheet roles", () => {
  beforeEach(() => {
    state.viewer = VIEWER;
    state.blockStatus = "ready";
    state.blocked = new Set();
    state.roles = [
      { id: "r-member", name: "Member", is_system: true, permissions: [] },
    ];
  });

  function editButton(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Edit Ada's roles" &&
        typeof node.props.onPress === "function",
    )[0];
  }

  it("draws the member's roles as chips, top-ranked first", () => {
    state.roles = [
      { id: "r-b", name: "Brothers", color: "#5CC8F0", display_order: 5 },
      { id: "r-p", name: "President", color: "#F2994A", display_order: 1 },
    ];
    PROFILES[ADA] = { ...profile(ADA, "Ada"), role_ids: ["r-b", "r-p"] as never[] };
    const tree = render(ADA);
    const text = tree.root
      .findAllByType("Text" as never)
      .map((node) => node.props.children)
      .filter((child) => child === "President" || child === "Brothers");
    expect(text).toEqual(["President", "Brothers"]);
    act(() => tree.unmount());
    PROFILES[ADA] = profile(ADA, "Ada");
  });

  it("offers no Edit to a viewer without roles:manage", () => {
    state.permissions = ["members:view"];
    const tree = render(ADA);
    expect(editButton(tree)).toBeUndefined();
    act(() => tree.unmount());
  });

  it("opens the role editor for this member when the viewer holds roles:manage", () => {
    state.permissions = ["members:view", "roles:manage"];
    const tree = render(ADA);
    const button = editButton(tree);
    expect(button?.props.onPress).toBeTypeOf("function");
    act(() => button?.props.onPress());
    const editor = tree.root.find(
      (node) =>
        typeof node.type !== "string" && node.props.session !== undefined,
    );
    expect(present).toHaveBeenCalled();
    expect(editor.props.session).toEqual({
      memberId: `m-${ADA}`,
      name: "Ada",
      heldIds: [],
    });
    act(() => tree.unmount());
    state.permissions = [];
  });

  // The editor stacks over the profile (#3790), so a DM landing under it
  // would close the profile and open the thread with the editor still on top.
  it("holds Edit while a DM with this member opens", async () => {
    state.permissions = ["members:view", "roles:manage"];
    const pending = deferred<unknown>();
    state.mutateAsync.mockReturnValueOnce(pending.promise);
    const tree = render(ADA);
    expect(editButton(tree)?.props.disabled).toBe(false);

    await act(async () => {
      messageRows(tree)[0].props.onPress();
    });
    expect(editButton(tree)?.props.disabled).toBe(true);
    expect(editButton(tree)?.props.accessibilityState).toEqual({
      disabled: true,
    });

    await act(async () => {
      pending.resolve({ id: "dm-ada" });
    });
    expect(editButton(tree)?.props.disabled).toBe(false);
    act(() => tree.unmount());
    state.permissions = [];
  });
});

// #3917: the member's presence dot on their avatar, their custom line under
// the name, and the status in the name heading's accessible name.
describe("MemberDetailSheet presence (#3917)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.viewer = VIEWER;
    state.blockStatus = "ready";
    state.blocked = new Set();
    state.blockPaused = false;
    setChapterPresence(PRESENCE_NOT_READY);
  });

  // The name heading: the header whose text is the member's name (the sheet
  // has other headers, such as Roles).
  const heading = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Text" as never) &&
        node.props.accessibilityRole === "header" &&
        node.props.children === "Ada",
    );
  const dots = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        node.type === ("View" as never) &&
        typeof node.props.testID === "string" &&
        node.props.testID.startsWith("member-presence-"),
    );

  it("draws no dot and names no status before presence has synced", () => {
    const tree = render(ADA);
    expect(dots(tree)).toHaveLength(0);
    expect(heading(tree).props.accessibilityLabel).toBeUndefined();
  });

  it("draws the member's dot, names the status and shows their line", () => {
    setChapterPresence({
      statusOf: (id) => (id === ADA ? "dnd" : "offline"),
      lineOf: (id) => (id === ADA ? "In lab until 6" : null),
      isReady: true,
    });
    const tree = render(ADA);
    expect(dots(tree).map((dot) => dot.props.testID)).toEqual([
      "member-presence-dnd",
    ]);
    expect(heading(tree).props.accessibilityLabel).toBe("Ada, Do Not Disturb");
    expect(
      tree.root.findAll(
        (node) =>
          node.type === ("Text" as never) &&
          node.props.children === "In lab until 6",
      ),
    ).toHaveLength(1);
  });
});
