/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import {
  parseRoleOptions,
  ROLES_SAVE_FAILED_TITLE,
  type RoleOption,
} from "@/lib/directory/role-editor";

/**
 * The role editor behind Directory > member > Roles: each tap saves the
 * whole set, quick taps go out one at a time with the newest set, a failure
 * puts the list back, and taking away basic access asks first.
 */

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  refetchRoles: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: undefined }),
  useRoles: () => ({ refetch: state.refetchRoles }),
  useUpdateMemberRoles: () => ({
    mutateAsync: state.mutateAsync,
    isPending: false,
  }),
}));

import { MemberRolesSheet } from "./member-roles-sheet";

const OPTIONS = parseRoleOptions([
  { id: "r-pres", name: "President", is_system: true, permissions: ["*"] },
  {
    id: "r-member",
    name: "Member",
    is_system: true,
    permissions: ["members:view"],
  },
  { id: "r-brothers", name: "Brothers", is_system: false, permissions: [] },
  { id: "r-cabinet", name: "Cabinet", is_system: false, permissions: [] },
]);

const SESSION = {
  memberId: "m-ada",
  name: "Ada",
  heldIds: ["r-brothers", "r-member"],
  // A profile fetched before any save in a test.
  fetchedAt: 0,
};

function sheet(session: typeof SESSION) {
  return (
    <FrappThemeProvider>
      <MemberRolesSheet session={session} options={OPTIONS} />
    </FrappThemeProvider>
  );
}

function render(session: typeof SESSION = SESSION): ReactTestRenderer {
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

function shownIds(tree: ReactTestRenderer): string[] {
  return (list(tree).props.data as RoleOption[]).map((o) => o.id);
}

/** The FlatList stand-in never renders rows, so draw one to read and tap it. */
function row(tree: ReactTestRenderer, id: string) {
  const item = OPTIONS.find((o) => o.id === id);
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

  it("lists held roles first, then the rest by name", () => {
    const tree = render();
    expect(shownIds(tree)).toEqual([
      "r-brothers",
      "r-member",
      "r-cabinet",
      "r-pres",
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
    // The order stays as it opened, so the tapped row doesn't move.
    expect(shownIds(tree)[2]).toBe("r-cabinet");
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
      ROLES_SAVE_FAILED_TITLE,
      expect.any(String),
    );
    act(() => tree.unmount());
  });

  it("asks before taking away the last role with basic access", async () => {
    const tree = render();
    await tap(tree, "r-member");
    expect(state.mutateAsync).not.toHaveBeenCalled();
    const [title, , buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(title).toBe("Take away Ada's access?");
    const remove = buttons!.find((b) => b.style === "destructive")!;
    await act(async () => remove.onPress!());
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
      (child) => child?.props?.accessibilityLabel === "Search roles",
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

  it("confirming Remove after a failed save put the role back never adds it", async () => {
    let fail!: (e: unknown) => void;
    state.mutateAsync.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (fail = reject)),
    );
    const tree = render({ ...SESSION, heldIds: ["r-brothers"] });
    await tap(tree, "r-member");
    await tap(tree, "r-member");
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    const remove = buttons!.find((b) => b.style === "destructive")!;
    await act(async () => fail(new Error("offline")));
    await act(async () => remove.onPress!());
    expect(state.mutateAsync).toHaveBeenCalledTimes(1);
    expect(row(tree, "r-member").props.accessibilityState.checked).toBe(false);
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
});
