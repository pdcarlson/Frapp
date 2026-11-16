/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_PICKER_ROLES_MAX } from "@repo/chat-core/role-pickers";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The New role picker sheet (#4958): the chapter's Non-chapter business
 * roles, one switch each, posted as a `role_picker` card.
 */

const state = vi.hoisted(() => ({ roles: [] as unknown[] }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRoles: () => ({ data: state.roles, isLoading: false, isError: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import {
  NewRolePickerSheet,
  NO_PICKABLE_ROLES_LINE,
  type NewRolePickerSheetProps,
} from "./new-role-picker-sheet";

const role = (id: string, name: string, selfAssignable = true) => ({
  id,
  name,
  permissions: [],
  is_system: false,
  system_key: null,
  self_assignable: selfAssignable,
});

function render(onPost: NewRolePickerSheetProps["onPost"]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewRolePickerSheet onPost={onPost} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const toggle = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      typeof node.props.onValueChange === "function" &&
      node.props.accessibilityLabel === label,
  );

const toggles = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      typeof node.props.onValueChange === "function" &&
      typeof node.type === "function",
  );

const postButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label !== undefined &&
      /Post/.test(String(node.props.label)) &&
      typeof node.type === "function",
  );

const titleField = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === "Title, optional" &&
      typeof node.props.onChangeText === "function",
  );

beforeEach(() => {
  successHaptic.mockReset();
  state.roles = [
    role("study", "Study group"),
    role("im", "Intramurals"),
    role("treasurer", "Treasurer", false),
  ];
});

describe("New role picker sheet (#4958)", () => {
  it("lists only the marked roles, by name", () => {
    const tree = render(vi.fn());
    const labels = toggles(tree).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(["Intramurals", "Study group"]);
    act(() => tree.unmount());
  });

  it("holds Post until a role is picked", () => {
    const tree = render(vi.fn());
    expect(postButton(tree).props.disabled).toBe(true);
    act(() => toggle(tree, "Intramurals").props.onValueChange(true));
    expect(postButton(tree).props.disabled).toBe(false);
    act(() => toggle(tree, "Intramurals").props.onValueChange(false));
    expect(postButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("posts the built card in picking order, then clears the draft", async () => {
    const onPost = vi.fn<NewRolePickerSheetProps["onPost"]>(async () => ({
      ok: true as const,
    }));
    const tree = render(onPost);
    act(() => titleField(tree).props.onChangeText("Join a team"));
    act(() => toggle(tree, "Study group").props.onValueChange(true));
    act(() => toggle(tree, "Intramurals").props.onValueChange(true));
    await act(async () => postButton(tree).props.onPress());
    expect(onPost).toHaveBeenCalledWith({
      content: "Join a team",
      payload: { title: "Join a team", role_ids: ["study", "im"] },
    });
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(titleField(tree).props.value).toBe("");
    expect(postButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("keeps the draft and says why when nothing was queued", async () => {
    const tree = render(async () => ({
      ok: false as const,
      error: "Couldn't post that role picker. Try again.",
    }));
    act(() => toggle(tree, "Intramurals").props.onValueChange(true));
    await act(async () => postButton(tree).props.onPress());
    expect(screenText(tree)).toContain(
      "Couldn't post that role picker. Try again.",
    );
    expect(toggle(tree, "Intramurals").props.value).toBe(true);
    act(() => tree.unmount());
  });

  it(`stops at ${ROLE_PICKER_ROLES_MAX} roles`, () => {
    state.roles = Array.from({ length: ROLE_PICKER_ROLES_MAX + 1 }, (_, i) =>
      role(`r${i}`, `Role ${String(i).padStart(2, "0")}`),
    );
    const tree = render(vi.fn());
    for (let i = 0; i < ROLE_PICKER_ROLES_MAX; i++) {
      act(() =>
        toggle(tree, `Role ${String(i).padStart(2, "0")}`).props.onValueChange(
          true,
        ),
      );
    }
    const last = `Role ${ROLE_PICKER_ROLES_MAX}`;
    expect(toggle(tree, last).props.disabled).toBe(true);
    expect(screenText(tree)).toContain(
      `A role picker can list up to ${ROLE_PICKER_ROLES_MAX} roles.`,
    );
    act(() => tree.unmount());
  });

  it("tells the officer where to mark a role when none is", () => {
    state.roles = [role("treasurer", "Treasurer", false)];
    const tree = render(vi.fn());
    expect(screenText(tree)).toContain(NO_PICKABLE_ROLES_LINE);
    expect(postButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });
});
