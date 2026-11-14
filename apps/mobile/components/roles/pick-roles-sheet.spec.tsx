/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Add roles (#4958): one switch per Non-chapter business role, each saving
 * at once, with a refusal said on its own row.
 */

const state = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: undefined }),
  useSetPickedRole: () => ({ mutateAsync: state.mutateAsync }),
}));

import { PickRolesSheet } from "./pick-roles-sheet";

const ROLES = [
  { id: "im", name: "Intramurals", held: true },
  { id: "study", name: "Study group", held: false },
].map((role) => ({
  ...role,
  color: null,
  permissions: [],
  is_system: false,
  system_key: null,
  locked: false,
  everyone: false,
  grantsBase: false,
  selfAssignable: true,
  joinable: true,
}));

function render(roles = ROLES): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <PickRolesSheet roles={roles} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function toggle(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      typeof node.props.onValueChange === "function" &&
      node.props.accessibilityLabel === label,
  );
}

beforeEach(() => {
  state.mutateAsync.mockReset().mockResolvedValue({ role_ids: [] });
});

describe("PickRolesSheet (#4958)", () => {
  it("draws a switch per role, on for the roles held", () => {
    const tree = render();
    expect(screenText(tree)).toContain("Add roles");
    expect(toggle(tree, "Leave Intramurals").props.value).toBe(true);
    expect(toggle(tree, "Join Study group").props.value).toBe(false);
  });

  it("joins and leaves on a tap", async () => {
    const tree = render();
    await act(async () => {
      toggle(tree, "Join Study group").props.onValueChange(true);
    });
    expect(state.mutateAsync).toHaveBeenCalledWith({ id: "study", join: true });
    await act(async () => {
      toggle(tree, "Leave Intramurals").props.onValueChange(false);
    });
    expect(state.mutateAsync).toHaveBeenCalledWith({ id: "im", join: false });
  });

  it("says a refusal on the role's own row", async () => {
    state.mutateAsync.mockRejectedValueOnce({
      statusCode: 409,
      code: "role.not_self_assignable",
      message: "This role changed while you were saving. Reload and try again.",
    });
    const tree = render();
    await act(async () => {
      toggle(tree, "Join Study group").props.onValueChange(true);
    });
    expect(screenText(tree)).toContain(
      "This role changed while you were saving. Reload and try again.",
    );
  });

  it("captions a held role that can't be joined again, and still leaves it", async () => {
    const tree = render([
      { ...ROLES[0]!, selfAssignable: false, joinable: false },
    ]);
    expect(screenText(tree)).toContain(
      "No longer open to join. You can leave it.",
    );
    await act(async () => {
      toggle(tree, "Leave Intramurals").props.onValueChange(false);
    });
    expect(state.mutateAsync).toHaveBeenCalledWith({
      id: "im",
      join: false,
    });
  });
});
