/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { parseChapterRoles } from "@repo/hooks/chapter-roles";
import { ASSIGN_COPY, type ChapterGroup } from "@repo/hooks";

/**
 * The roles-and-groups editor behind Directory > member > "+ Add role" or
 * "+ Add to group": each tap saves, quick role taps go out one at a time with
 * the newest set, a failure puts the list back, and taking away basic access
 * asks first.
 */

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  setMembership: vi.fn(),
  refetchRoles: vi.fn(),
}));

const { RAW_ROLES } = vi.hoisted(() => ({
  RAW_ROLES: [
    { id: "r-pres", name: "President", is_system: true, permissions: ["*"] },
    {
      id: "r-member",
      name: "Member",
      is_system: true,
      permissions: ["members:view"],
    },
    { id: "r-brothers", name: "Brothers", is_system: false, permissions: [] },
    { id: "r-cabinet", name: "Cabinet", is_system: false, permissions: [] },
  ],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: undefined }),
  useRoles: () => ({ refetch: state.refetchRoles }),
  useUpdateMemberRoles: () => ({
    mutateAsync: state.mutateAsync,
    isPending: false,
  }),
  useSetGroupMembership: () => ({ mutateAsync: state.setMembership }),
}));

vi.mock("@/lib/roles/use-roles-data", async () => {
  const { normalizeTieredRoles } = await import("@repo/hooks/role-tiers");
  const roles = normalizeTieredRoles(RAW_ROLES);
  const reach = {
    wildcard: true,
    known: true,
    rank: 0,
    held: new Set(["*"]),
  };
  return {
    useRolesData: () => ({ roles, tiers: [], reach, canManage: true }),
  };
});

import {
  MemberRolesSheet,
  type MemberRolesSession,
} from "./member-roles-sheet";

const OPTIONS = parseChapterRoles(RAW_ROLES);

const GROUPS = [
  {
    id: "g-house",
    name: "In house",
    kind: "manual",
    color: null,
    member_ids: ["u-ada"],
  },
  {
    id: "g-campus",
    name: "On campus",
    kind: "manual",
    color: null,
    member_ids: [],
  },
  {
    id: "g-class",
    name: "Fall 2025",
    kind: "pledge_class",
    color: null,
    member_ids: ["u-ada"],
  },
] as unknown as ChapterGroup[];

const SESSION: MemberRolesSession = {
  memberId: "m-ada",
  userId: "u-ada",
  focus: "roles",
  canManageRoles: true,
  canManageGroups: true,
  name: "Ada",
  heldIds: ["r-brothers", "r-member"],
  // A profile fetched before any save in a test.
  fetchedAt: 0,
};

function sheet(session: MemberRolesSession) {
  return (
    <FrappThemeProvider>
      <MemberRolesSheet session={session} options={OPTIONS} groups={GROUPS} />
    </FrappThemeProvider>
  );
}

function render(session: MemberRolesSession = SESSION): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(sheet(session));
  });
  return tree;
}

function list(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) => (node.type as unknown) === "BottomSheetFlatList",
  );
}

type Item = { type: string; key: string; title?: string; row?: { id: string } };

function items(tree: ReactTestRenderer): Item[] {
  return list(tree).props.data as Item[];
}

/** The rows' ids, headings left out. */
function shownIds(tree: ReactTestRenderer): string[] {
  return items(tree)
    .filter((item) => item.type !== "heading")
    .map((item) => item.row!.id);
}

function headings(tree: ReactTestRenderer): string[] {
  return items(tree)
    .filter((item) => item.type === "heading")
    .map((item) => item.title!);
}

/** The FlatList stand-in never renders rows, so draw one to read and tap it. */
function row(tree: ReactTestRenderer, id: string) {
  const item = items(tree).find((i) => i.row?.id === id);
  return list(tree).props.renderItem({ item }) as React.ReactElement<{
    onPress: () => void;
    disabled: boolean;
    accessibilityState: { checked: boolean };
  }>;
}

async function tap(tree: ReactTestRenderer, id: string) {
  await act(async () => {
    row(tree, id).props.onPress();
  });
}

describe("MemberRolesSheet", () => {
  beforeEach(() => {
    state.mutateAsync.mockReset();
    state.mutateAsync.mockResolvedValue({});
    vi.mocked(Alert.alert).mockClear?.();
  });

  it("lists the roles, then the chapter's own groups, as web's card does", () => {
    const tree = render();
    expect(headings(tree)).toEqual(["Other roles", "Groups"]);
    expect(shownIds(tree)).toEqual([
      "r-brothers",
      "r-cabinet",
      "r-member",
      "r-pres",
      "g-house",
      "g-campus",
    ]);
    expect(row(tree, "r-brothers").props.accessibilityState.checked).toBe(true);
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(false);
    act(() => tree.unmount());
  });

  it("saves the whole set on a tap", async () => {
    const tree = render();
    await tap(tree, "r-cabinet");
    expect(state.mutateAsync).toHaveBeenCalledWith({
      id: "m-ada",
      role_ids: ["r-brothers", "r-member", "r-cabinet"],
    });
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(true);
    // The order is by rank and name, so the tapped row doesn't move.
    expect(shownIds(tree)[1]).toBe("r-cabinet");
    act(() => tree.unmount());
  });

  it("sends quick taps one at a time, the newest set last", async () => {
    let release!: () => void;
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const tree = render();
    await tap(tree, "r-cabinet");
    await tap(tree, "r-brothers");
    expect(state.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(state.mutateAsync).toHaveBeenCalledTimes(2);
    expect(state.mutateAsync).toHaveBeenLastCalledWith({
      id: "m-ada",
      role_ids: ["r-member", "r-cabinet"],
    });
    act(() => tree.unmount());
  });

  it("puts the list back and says so when a save fails", async () => {
    state.mutateAsync.mockRejectedValueOnce(new Error("offline"));
    const tree = render();
    await tap(tree, "r-cabinet");
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      ASSIGN_COPY.rolesFailed,
      expect.any(String),
    );
    act(() => tree.unmount());
  });

  it("takes a role away on a tap, without asking first", async () => {
    const tree = render();
    await tap(tree, "r-member");
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(state.mutateAsync).toHaveBeenCalledWith({
      id: "m-ada",
      role_ids: ["r-brothers"],
    });
    act(() => tree.unmount());
  });

  it("locks President, which moves only with Transfer presidency", async () => {
    const tree = render();
    expect(row(tree, "r-pres").props.disabled).toBe(true);
    await tap(tree, "r-pres");
    expect(state.mutateAsync).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("filters by search", () => {
    const tree = render();
    // The header is a prop element the FlatList stand-in doesn't render.
    const header = list(tree).props.ListHeaderComponent as React.ReactElement<{
      children: React.ReactElement<{
        accessibilityLabel?: string;
        onChangeText?: (text: string) => void;
      }>[];
    }>;
    const input = header.props.children.find(
      (child) => child?.props?.accessibilityLabel === "Search roles and groups",
    )!;
    act(() => input.props.onChangeText?.("cab"));
    expect(shownIds(tree)).toEqual(["r-cabinet"]);
    act(() => tree.unmount());
  });

  it("reopened on the same member, starts from what it last sent, not the stale profile", async () => {
    const tree = render();
    await tap(tree, "r-cabinet");
    // The profile still shows the roles from before the save.
    act(() => tree.update(sheet({ ...SESSION })));
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(true);
    await tap(tree, "r-brothers");
    expect(state.mutateAsync).toHaveBeenLastCalledWith({
      id: "m-ada",
      role_ids: ["r-member", "r-cabinet"],
    });
    act(() => tree.unmount());
  });

  it("says a deleted role, not a network problem, on a 400, and re-reads the roles", async () => {
    state.mutateAsync.mockRejectedValueOnce({ status: 400 });
    const tree = render();
    await tap(tree, "r-cabinet");
    expect(state.refetchRoles).toHaveBeenCalled();
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain(
      "just deleted",
    );
    act(() => tree.unmount());
  });

  it("reopened after the profile caught up, starts from the profile, not an old draft", async () => {
    const tree = render();
    await tap(tree, "r-cabinet");
    // Since then someone else changed Ada's roles, and the profile refetched.
    act(() =>
      tree.update(
        sheet({ ...SESSION, heldIds: ["r-member"], fetchedAt: Date.now() + 1 }),
      ),
    );
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(false);
    expect(row(tree, "r-brothers").props.accessibilityState.checked).toBe(
      false,
    );
    act(() => tree.unmount());
  });

  it("finishes a member's queued save after moving on, and says whose change failed", async () => {
    let fail!: (e: unknown) => void;
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((resolve) => resolve()),
    );
    const tree = render();
    // First save lands; the second stays out.
    await tap(tree, "r-cabinet");
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (fail = reject)),
    );
    await tap(tree, "r-brothers");
    act(() =>
      tree.update(
        sheet({ ...SESSION, memberId: "m-ben", name: "Ben", heldIds: [] }),
      ),
    );
    await act(async () => fail(new Error("offline")));
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain(
      "Your change to Ada's roles",
    );
    // Ben's sheet is untouched by Ada's failure.
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(false);
    act(() => tree.unmount());
  });

  it("coming back to a member mid-save joins that save rather than starting a second", async () => {
    let release!: () => void;
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const tree = render();
    await tap(tree, "r-cabinet");
    act(() =>
      tree.update(
        sheet({ ...SESSION, memberId: "m-ben", name: "Ben", heldIds: [] }),
      ),
    );
    act(() => tree.update(sheet({ ...SESSION })));
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(true);
    await tap(tree, "r-brothers");
    expect(state.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(state.mutateAsync).toHaveBeenCalledTimes(2);
    expect(state.mutateAsync).toHaveBeenLastCalledWith({
      id: "m-ada",
      role_ids: ["r-member", "r-cabinet"],
    });
    act(() => tree.unmount());
  });

  it("sends only the newest of several queued taps", async () => {
    let release!: () => void;
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const tree = render();
    await tap(tree, "r-cabinet");
    await tap(tree, "r-brothers");
    await tap(tree, "r-brothers");
    await act(async () => release());
    expect(state.mutateAsync).toHaveBeenCalledTimes(2);
    expect(state.mutateAsync).toHaveBeenLastCalledWith({
      id: "m-ada",
      role_ids: ["r-member", "r-cabinet", "r-brothers"],
    });
    act(() => tree.unmount());
  });

  it("puts back to the last saved set, not the opening one, and drops the queue", async () => {
    const tree = render();
    await tap(tree, "r-cabinet");
    let fail!: (e: unknown) => void;
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (fail = reject)),
    );
    await tap(tree, "r-brothers");
    await tap(tree, "r-brothers");
    await act(async () => fail(new Error("offline")));
    expect(state.mutateAsync).toHaveBeenCalledTimes(2);
    expect(row(tree, "r-cabinet").props.accessibilityState.checked).toBe(true);
    expect(row(tree, "r-brothers").props.accessibilityState.checked).toBe(true);
    act(() => tree.unmount());
  });

  it("opened for a group, lists the groups first, and saves a tick at once", async () => {
    state.setMembership.mockResolvedValue({});
    const tree = render({ ...SESSION, focus: "groups" });
    expect(headings(tree)).toEqual(["Groups", "Other roles"]);
    // A pledge class's group follows the member's details and is never listed.
    expect(shownIds(tree)).not.toContain("g-class");
    expect(row(tree, "g-house").props.accessibilityState.checked).toBe(true);
    await tap(tree, "g-campus");
    expect(state.setMembership).toHaveBeenCalledWith({
      groupId: "g-campus",
      userId: "u-ada",
      in: true,
    });
    act(() => tree.unmount());
  });

  it("says the API's reason when a group save is refused", async () => {
    state.setMembership.mockRejectedValueOnce({
      statusCode: 403,
      message:
        "A channel uses this group to decide who can see or post in it. Only someone who can manage channels can change who is in it.",
    });
    const tree = render({ ...SESSION, focus: "groups" });
    await tap(tree, "g-campus");
    const [title, body] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(title).toBe(ASSIGN_COPY.groupAddFailed);
    expect(body).toContain("Only someone who can manage channels");
    act(() => tree.unmount());
  });

  it("keeps Saving… while a role save is out, whatever a group tap does", async () => {
    let release!: () => void;
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    state.setMembership.mockResolvedValueOnce({});
    const tree = render();
    await tap(tree, "r-cabinet");
    await tap(tree, "g-campus");
    // The header is a prop element the FlatList stand-in doesn't render.
    const header = list(tree).props.ListHeaderComponent as React.ReactElement<{
      children: React.ReactElement<{
        accessibilityLiveRegion?: string;
        children?: unknown;
      }>[];
    }>;
    const statusLine = header.props.children.find(
      (child) => child?.props?.accessibilityLiveRegion === "polite",
    );
    expect(statusLine?.props.children).toBe("Saving…");
    await act(async () => release());
    act(() => tree.unmount());
  });

  it("says why a group can't be ticked by someone without groups:manage", () => {
    const tree = render({ ...SESSION, canManageGroups: false });
    const house = row(tree, "g-house").props as unknown as {
      disabled: boolean;
      accessibilityHint?: string;
    };
    expect(house.disabled).toBe(true);
    expect(house.accessibilityHint).toBe("Your role can't change groups");
    act(() => tree.unmount());
  });
});
