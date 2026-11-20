/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_PICKABLE_ROLE_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Add role under Non-chapter business (#5736): one name, and the role is
 * created outside the tiers, holding nothing, already pickable.
 */

const state = vi.hoisted(() => ({ createRole: vi.fn() }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateRole: () => ({ mutateAsync: state.createRole, isPending: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

vi.mock("@/lib/haptics", () => ({ successHaptic: vi.fn() }));

import { NewPickableRoleSheet } from "./new-pickable-role-sheet";

function render(onCreated: (roleId: string) => void): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewPickableRoleSheet onCreated={onCreated} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const nameField = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === "Role name" &&
      typeof node.props.onChangeText === "function",
  );

const addButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label === NEW_PICKABLE_ROLE_COPY.add &&
      typeof node.type === "function",
  );

beforeEach(() => {
  state.createRole.mockReset();
});

describe("New Non-chapter business role sheet (#5736)", () => {
  it("holds Add role until the role has a name", () => {
    const tree = render(vi.fn());
    expect(addButton(tree).props.disabled).toBe(true);
    act(() => nameField(tree).props.onChangeText("   "));
    expect(addButton(tree).props.disabled).toBe(true);
    act(() => nameField(tree).props.onChangeText("Intramural soccer"));
    expect(addButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("creates it outside the tiers, holding nothing, pickable, then opens it", async () => {
    state.createRole.mockResolvedValue({ id: "new-im" });
    const onCreated = vi.fn();
    const tree = render(onCreated);
    act(() => nameField(tree).props.onChangeText(" Intramural soccer "));
    await act(async () => {
      addButton(tree).props.onPress();
    });
    expect(state.createRole).toHaveBeenCalledWith({
      name: "Intramural soccer",
      permissions: [],
      tier_id: null,
      self_assignable: true,
    });
    expect(onCreated).toHaveBeenCalledWith("new-im");
    expect(nameField(tree).props.value).toBe("");
    act(() => tree.unmount());
  });

  it("keeps the name and says why when the save fails", async () => {
    state.createRole.mockRejectedValue(new Error("boom"));
    const onCreated = vi.fn();
    const tree = render(onCreated);
    act(() => nameField(tree).props.onChangeText("Intramural soccer"));
    await act(async () => {
      addButton(tree).props.onPress();
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(nameField(tree).props.value).toBe("Intramural soccer");
    expect(screenText(tree)).toContain(NEW_PICKABLE_ROLE_COPY.failed);
    act(() => tree.unmount());
  });
});
